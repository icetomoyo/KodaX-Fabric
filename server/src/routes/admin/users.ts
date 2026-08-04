import type { FastifyInstance, FastifyReply } from "fastify";
import { and, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { employeeApiKeys, employees, opsAuditLogs } from "../../db/schema/index.js";
import {
  decryptEmployeeApiKey,
  encryptEmployeeApiKey,
  generateApiKey,
} from "../../lib/api-key.js";
import { hashPassword, validateNewPassword, verifyPassword } from "../../lib/password.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  DEFAULT_RELAY_PROTOCOL,
  RELAY_PROTOCOLS,
  type RelayProtocol,
} from "../../lib/relay/protocol.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(5).max(20),
  password: z.string().min(8).max(128),
  dept: z.string().max(100).optional().nullable(),
  role: z.enum(["employee", "admin", "auditor"]).default("employee"),
});

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    phone: z.string().trim().min(5).max(20).optional(),
    dept: z.string().trim().max(100).nullable().optional(),
    role: z.enum(["employee", "admin", "auditor"]).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0);

const userIdSchema = z.object({ id: z.coerce.number().int().positive() });

const adminApiKeySchema = z.object({
  createNew: z.boolean().default(false),
  name: z.string().trim().min(1).max(100).default("admin-managed"),
  protocol: z.enum(RELAY_PROTOCOLS).default(DEFAULT_RELAY_PROTOCOL),
});

const activeApiKeyFilter = (employeeId: number) =>
  and(
    eq(employeeApiKeys.employeeId, employeeId),
    eq(employeeApiKeys.status, "active"),
    or(isNull(employeeApiKeys.expiresAt), gt(employeeApiKeys.expiresAt, new Date())),
  );

async function findAdminCopyableApiKey(employeeId: number, protocol?: RelayProtocol) {
  const [row] = await db
    .select({
      id: employeeApiKeys.id,
      name: employeeApiKeys.name,
      keyPrefix: employeeApiKeys.keyPrefix,
      keyHash: employeeApiKeys.keyHash,
      keyEncrypted: employeeApiKeys.keyEncrypted,
      protocol: employeeApiKeys.protocol,
    })
    .from(employeeApiKeys)
    .where(
      and(
        activeApiKeyFilter(employeeId),
        isNotNull(employeeApiKeys.keyEncrypted),
        protocol ? eq(employeeApiKeys.protocol, protocol) : undefined,
      ),
    )
    .orderBy(desc(employeeApiKeys.id))
    .limit(1);

  if (!row) return { status: "not_found" as const };

  try {
    return {
      status: "found" as const,
      data: {
        id: row.id,
        name: row.name,
        keyPrefix: row.keyPrefix,
        protocol: row.protocol,
        key: decryptEmployeeApiKey(row.keyEncrypted!, row.keyHash),
      },
    };
  } catch {
    return { status: "invalid" as const, keyId: row.id };
  }
}

function disableSecretCaching(reply: FastifyReply) {
  reply.header("Cache-Control", "no-store");
  reply.header("Pragma", "no-cache");
}

function sendApiKeyUnavailable(reply: FastifyReply) {
  return reply.code(500).send({
    success: false,
    code: "api_key_unavailable",
    message: "API Key 暂时无法读取，请稍后重试或联系管理员",
  });
}

async function requireEmployeeTarget(
  id: number,
  reply: FastifyReply,
) {
  const [target] = await db
    .select({ id: employees.id, role: employees.role })
    .from(employees)
    .where(eq(employees.id, id))
    .limit(1);

  if (!target) {
    await reply.code(404).send({ success: false, message: "用户不存在" });
    return null;
  }
  if (target.role !== "employee") {
    await reply.code(400).send({ success: false, message: "仅员工账号支持 API Key" });
    return null;
  }
  return target;
}

export async function adminUserRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/users", async (req) => {
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(200).default(50),
        offset: z.coerce.number().min(0).default(0),
        q: z.string().optional(),
      })
      .parse(req.query);

    const rows = await db
      .select({
        id: employees.id,
        name: employees.name,
        phone: employees.phone,
        dept: employees.dept,
        role: employees.role,
        status: employees.status,
        mustChangePassword: employees.mustChangePassword,
        lastLoginAt: employees.lastLoginAt,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .where(
        query.q
          ? sql`(${employees.name} ilike ${"%" + query.q + "%"} or ${employees.phone} ilike ${"%" + query.q + "%"})`
          : sql`true`,
      )
      .orderBy(desc(employees.id))
      .limit(query.limit)
      .offset(query.offset);

    return { success: true, data: rows };
  });

  app.post("/api/admin/users/:id/api-key/reveal", async (req, reply) => {
    disableSecretCaching(reply);
    const params = userIdSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const target = await requireEmployeeTarget(params.data.id, reply);
    if (!target) return;

    const managedKey = await findAdminCopyableApiKey(target.id);
    if (managedKey.status === "invalid") {
      req.log.error(
        { employeeId: target.id, employeeApiKeyId: managedKey.keyId },
        "employee API key integrity check failed",
      );
      return sendApiKeyUnavailable(reply);
    }
    if (managedKey.status === "found") {
      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "employee_api_key.reveal",
        targetType: "employee_api_key",
        targetId: String(managedKey.data.id),
        detail: { employeeId: target.id, protocol: managedKey.data.protocol },
        ip: req.ip,
      });

      return {
        success: true,
        data: managedKey.data,
      };
    }

    const [activeKey] = await db
      .select({ id: employeeApiKeys.id })
      .from(employeeApiKeys)
      .where(activeApiKeyFilter(target.id))
      .orderBy(desc(employeeApiKeys.id))
      .limit(1);

    if (activeKey) {
      return reply.code(404).send({
        success: false,
        code: "key_not_recoverable",
        message: "现有有效 Key 为旧版哈希存储，无法复制，请新建 Key",
      });
    }

    return reply.code(404).send({
      success: false,
      code: "api_key_not_found",
      message: "该员工没有有效 API Key",
    });
  });

  app.post("/api/admin/users/:id/api-key", async (req, reply) => {
    disableSecretCaching(reply);
    const params = userIdSchema.safeParse(req.params);
    const body = adminApiKeySchema.safeParse(req.body ?? {});
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const target = await requireEmployeeTarget(params.data.id, reply);
    if (!target) return;

    if (!body.data.createNew) {
      const managedKey = await findAdminCopyableApiKey(target.id, body.data.protocol);
      if (managedKey.status === "invalid") {
        req.log.error(
          { employeeId: target.id, employeeApiKeyId: managedKey.keyId },
          "employee API key integrity check failed",
        );
        return sendApiKeyUnavailable(reply);
      }
      if (managedKey.status === "found") {
        await writeOpsAudit({
          actorEmployeeId: req.employeeId,
          action: "employee_api_key.reveal",
          targetType: "employee_api_key",
          targetId: String(managedKey.data.id),
          detail: { employeeId: target.id, protocol: managedKey.data.protocol },
          ip: req.ip,
        });

        return {
          success: true,
          data: {
            ...managedKey.data,
            created: false,
          },
        };
      }
    }

    const { raw, prefix, hash } = generateApiKey();
    let keyEncrypted: string;
    try {
      keyEncrypted = encryptEmployeeApiKey(raw);
    } catch (error) {
      req.log.error({ err: error, employeeId: target.id }, "failed to encrypt employee API key");
      return sendApiKeyUnavailable(reply);
    }
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(employeeApiKeys)
        .values({
          employeeId: target.id,
          name: body.data.name,
          keyPrefix: prefix,
          keyHash: hash,
          keyEncrypted,
          protocol: body.data.protocol,
        })
        .returning({
          id: employeeApiKeys.id,
          name: employeeApiKeys.name,
          keyPrefix: employeeApiKeys.keyPrefix,
          protocol: employeeApiKeys.protocol,
        });

      await tx.insert(opsAuditLogs).values({
        actorEmployeeId: req.employeeId,
        action: "employee_api_key.create_for_employee",
        targetType: "employee_api_key",
        targetId: String(created.id),
        detail: { employeeId: target.id, protocol: created.protocol },
        ip: req.ip,
      });

      return created;
    });

    return {
      success: true,
      data: {
        ...row,
        key: raw,
        created: true,
        notice: "请妥善保管 API Key",
      },
    };
  });

  app.post("/api/admin/users", async (req, reply) => {
    const body = createUserSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效", errors: body.error.flatten() });
    }
    const policy = validateNewPassword(body.data.password);
    if (policy) {
      return reply.code(400).send({ success: false, message: policy });
    }

    try {
      const passwordHash = await hashPassword(body.data.password);
      const [row] = await db
        .insert(employees)
        .values({
          name: body.data.name,
          phone: body.data.phone,
          passwordHash,
          dept: body.data.dept ?? null,
          role: body.data.role,
          mustChangePassword: true,
          createdBy: req.employeeId,
        })
        .returning({
          id: employees.id,
          name: employees.name,
          phone: employees.phone,
          role: employees.role,
          status: employees.status,
        });

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "user.create",
        targetType: "employee",
        targetId: String(row.id),
        detail: { phone: row.phone, role: row.role },
        ip: req.ip,
      });

      return { success: true, data: row };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("employees_phone_uidx") || msg.includes("unique")) {
        return reply.code(409).send({ success: false, message: "手机号已存在" });
      }
      throw e;
    }
  });

  app.post("/api/admin/users/import", async (req, reply) => {
    const body = z
      .object({
        users: z.array(createUserSchema).min(1).max(500),
      })
      .safeParse(req.body);

    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const results: Array<{ phone: string; ok: boolean; error?: string; id?: number }> = [];

    for (const u of body.data.users) {
      const policy = validateNewPassword(u.password);
      if (policy) {
        results.push({ phone: u.phone, ok: false, error: policy });
        continue;
      }
      try {
        const passwordHash = await hashPassword(u.password);
        const [row] = await db
          .insert(employees)
          .values({
            name: u.name,
            phone: u.phone,
            passwordHash,
            dept: u.dept ?? null,
            role: u.role,
            mustChangePassword: true,
            createdBy: req.employeeId,
          })
          .returning({ id: employees.id });
        results.push({ phone: u.phone, ok: true, id: row.id });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({
          phone: u.phone,
          ok: false,
          error: msg.includes("unique") ? "手机号已存在" : msg,
        });
      }
    }

    const success = results.filter((r) => r.ok).length;
    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "user.import",
      targetType: "employee",
      detail: { total: results.length, success, failed: results.length - success },
      ip: req.ip,
    });

    return {
      success: true,
      data: {
        total: results.length,
        success,
        failed: results.length - success,
        results,
      },
    };
  });

  app.patch("/api/admin/users/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = updateUserSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const [targetUser] = await db
      .select({
        id: employees.id,
        role: employees.role,
        status: employees.status,
      })
      .from(employees)
      .where(eq(employees.id, params.data.id))
      .limit(1);

    if (!targetUser) {
      return reply.code(404).send({ success: false, message: "用户不存在" });
    }

    if (
      params.data.id === req.employeeId &&
      ((body.data.status !== undefined && body.data.status !== targetUser.status) ||
        (body.data.role !== undefined && body.data.role !== targetUser.role))
    ) {
      return reply.code(400).send({ success: false, message: "不能修改自己的角色或状态" });
    }

    const values = {
      ...body.data,
      ...(body.data.dept !== undefined ? { dept: body.data.dept || null } : {}),
      updatedAt: new Date(),
    };

    try {
      const [row] = await db
        .update(employees)
        .set(values)
        .where(eq(employees.id, params.data.id))
        .returning({
          id: employees.id,
          name: employees.name,
          phone: employees.phone,
          dept: employees.dept,
          role: employees.role,
          status: employees.status,
          mustChangePassword: employees.mustChangePassword,
          lastLoginAt: employees.lastLoginAt,
        });

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "user.update",
        targetType: "employee",
        targetId: String(row.id),
        detail: { fields: Object.keys(body.data) },
        ip: req.ip,
      });

      return { success: true, data: row };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("employees_phone_uidx") || msg.includes("unique")) {
        return reply.code(409).send({ success: false, message: "手机号已存在" });
      }
      throw e;
    }
  });

  app.patch("/api/admin/users/:id/status", async (req, reply) => {
    const params = z.object({ id: z.coerce.number() }).safeParse(req.params);
    const body = z.object({ status: z.enum(["active", "disabled"]) }).safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    if (params.data.id === req.employeeId && body.data.status === "disabled") {
      return reply.code(400).send({ success: false, message: "不能停用自己" });
    }

    const [row] = await db
      .update(employees)
      .set({ status: body.data.status, updatedAt: new Date() })
      .where(eq(employees.id, params.data.id))
      .returning({ id: employees.id, status: employees.status });

    if (!row) {
      return reply.code(404).send({ success: false, message: "用户不存在" });
    }

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "user.status",
      targetType: "employee",
      targetId: String(row.id),
      detail: { status: row.status },
      ip: req.ip,
    });

    return { success: true, data: row };
  });

  app.post("/api/admin/users/:id/reset-password", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = z
      .object({ password: z.string().min(8).max(128) })
      .safeParse(req.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    if (params.data.id === req.employeeId) {
      return reply.code(400).send({ success: false, message: "请通过修改密码功能更新自己的密码" });
    }

    const policy = validateNewPassword(body.data.password);
    if (policy) {
      return reply.code(400).send({ success: false, message: policy });
    }

    const [targetUser] = await db
      .select({ id: employees.id, passwordHash: employees.passwordHash })
      .from(employees)
      .where(eq(employees.id, params.data.id))
      .limit(1);

    if (!targetUser) {
      return reply.code(404).send({ success: false, message: "用户不存在" });
    }

    if (await verifyPassword(body.data.password, targetUser.passwordHash)) {
      return reply.code(400).send({ success: false, message: "新密码不能与原密码相同" });
    }

    const passwordHash = await hashPassword(body.data.password);
    const [row] = await db
      .update(employees)
      .set({
        passwordHash,
        mustChangePassword: true,
        passwordChangedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, params.data.id))
      .returning({
        id: employees.id,
        name: employees.name,
        phone: employees.phone,
        mustChangePassword: employees.mustChangePassword,
      });

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "user.reset_password",
      targetType: "employee",
      targetId: String(row.id),
      detail: { phone: row.phone },
      ip: req.ip,
    });

    return { success: true, data: row };
  });
}
