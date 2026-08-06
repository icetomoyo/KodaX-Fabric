import type { FastifyInstance, FastifyReply } from "fastify";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import { quotaPolicies } from "../../db/schema/index.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import { nextQuotaResetAt } from "../../lib/quota-time.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

async function defaultPolicy() {
  const [row] = await db
    .select()
    .from(quotaPolicies)
    .where(eq(quotaPolicies.isDefault, true))
    .orderBy(asc(quotaPolicies.id))
    .limit(1);
  return row;
}

function policyPayload(dailyTokenLimit: number) {
  return {
    dailyTokenLimit,
    timezone: env.QUOTA_TIMEZONE,
    resetAt: nextQuotaResetAt(new Date(), env.QUOTA_TIMEZONE),
    description: "每名员工每日总 Token 硬上限；个人用量请在员工详情中查看。",
  };
}

function deprecatedWrite(reply: FastifyReply) {
  return reply.code(410).send({
    success: false,
    code: "quota_policy_deprecated",
    message: "多策略与员工覆盖写接口已停用，请使用 /api/admin/quota-policy",
  });
}

export async function adminQuotaRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/quota-policy", async (_req, reply) => {
    const policy = await defaultPolicy();
    if (policy?.hardTpmDay === null || policy?.hardTpmDay === undefined) {
      return reply.code(503).send({
        success: false,
        code: "quota_policy_not_initialized",
        message: "默认日 Token 配额未初始化，请先执行数据库迁移",
      });
    }
    return {
      success: true,
      data: policyPayload(policy.hardTpmDay),
    };
  });

  app.put("/api/admin/quota-policy", async (req, reply) => {
    const body = z
      .object({
        dailyTokenLimit: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      })
      .strict()
      .safeParse(req.body);

    if (!body.success) {
      return reply.code(400).send({
        success: false,
        code: "quota_policy_invalid",
        message: "dailyTokenLimit 必须是非负整数",
        errors: body.error.flatten(),
      });
    }

    const policy = await defaultPolicy();
    const [saved] = policy
      ? await db
        .update(quotaPolicies)
        .set({
          hardTpmDay: body.data.dailyTokenLimit,
          softTpmDay: null,
          softReqDay: null,
          hardReqDay: null,
          updatedAt: new Date(),
        })
        .where(eq(quotaPolicies.id, policy.id))
        .returning()
      : await db
        .insert(quotaPolicies)
        .values({
          name: "默认日 Token 配额",
          hardTpmDay: body.data.dailyTokenLimit,
          softTpmDay: null,
          softReqDay: null,
          hardReqDay: null,
          rpm: env.RELAY_SAFEGUARD_RPM,
          maxConcurrency: env.RELAY_SAFEGUARD_MAX_CONCURRENCY,
          isDefault: true,
        })
        .returning();

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "quota_policy.update",
      targetType: "quota_policy",
      targetId: String(saved.id),
      detail: { dailyTokenLimit: body.data.dailyTokenLimit },
      ip: req.ip,
    });

    return { success: true, data: policyPayload(body.data.dailyTokenLimit) };
  });

  // Compatibility view retained through v0.0.4. Legacy values no longer
  // participate in relay execution.
  app.get("/api/admin/quota-policies", async () => {
    const policy = await defaultPolicy();
    const dailyTokenLimit = policy?.hardTpmDay ?? null;
    return {
      success: true,
      deprecated: true,
      data: [{
        id: policy?.id ?? 0,
        name: policy?.name ?? "默认日 Token 配额",
        softTpmDay: null,
        hardTpmDay: dailyTokenLimit,
        rpm: env.RELAY_SAFEGUARD_RPM,
        maxConcurrency: env.RELAY_SAFEGUARD_MAX_CONCURRENCY,
        softReqDay: null,
        hardReqDay: null,
        isDefault: true,
      }],
    };
  });

  app.get("/api/admin/quota-overrides", async () => ({
    success: true,
    deprecated: true,
    data: [],
  }));

  app.post("/api/admin/quota-policies", async (_req, reply) => deprecatedWrite(reply));
  app.patch("/api/admin/quota-policies/:id", async (_req, reply) => deprecatedWrite(reply));
  app.put("/api/admin/quota-policies/:id", async (_req, reply) => deprecatedWrite(reply));
  app.delete("/api/admin/quota-policies/:id", async (_req, reply) => deprecatedWrite(reply));
  app.post("/api/admin/quota-overrides", async (_req, reply) => deprecatedWrite(reply));
  app.put("/api/admin/quota-overrides/:employeeId", async (_req, reply) => deprecatedWrite(reply));
  app.patch("/api/admin/quota-overrides/:employeeId", async (_req, reply) => deprecatedWrite(reply));
  app.delete("/api/admin/quota-overrides/:employeeId", async (_req, reply) => deprecatedWrite(reply));
}
