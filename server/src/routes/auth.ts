import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { employees, enterprises } from "../db/schema/index.js";
import { isSessionRole, signSession } from "../lib/jwt.js";
import {
  hashPassword,
  isInitialRegistrationPassword,
  validateNewPassword,
  verifyPassword,
} from "../lib/password.js";
import { writeOpsAudit } from "../lib/ops-audit.js";
import { authenticateLdapUser, matchEmployeeForLdapPerson } from "../lib/ldap-auth.js";
import { provisionEmployeeFromLdapDingtalk } from "../lib/ldap-dingtalk-provision.js";
import {
  registerDingtalkJoinMessage,
  tryJoinRegisteredEmployeeFromDingtalk,
} from "../lib/dingtalk-register-join.js";
import { readDingtalkCredentials } from "../lib/dingtalk-department-tree.js";
import { resolveDingtalkLoginEmployee } from "../lib/dingtalk-login.js";
import {
  buildDingtalkAuthorizeUrl,
  createDingtalkLoginState,
  dingtalkLoginRedirectUriFromOrigin,
  isAllowedDingtalkRedirectUri,
  readDingtalkLoginState,
} from "../lib/dingtalk-oauth.js";
import {
  INITIAL_PASSWORD_DINGTALK_MESSAGE,
  INITIAL_PASSWORD_DINGTALK_REQUIRED,
} from "../lib/initial-password-gate.js";
import { env } from "../config.js";
import { requireSession } from "../middleware/auth.js";

function allowedDingtalkLoginRedirects(): string[] {
  const origin = env.CORS_ORIGIN.replace(/\/$/, "");
  const uris = [dingtalkLoginRedirectUriFromOrigin(origin)];
  if (origin.includes("127.0.0.1")) {
    uris.push(dingtalkLoginRedirectUriFromOrigin(origin.replace("127.0.0.1", "localhost")));
  } else if (origin.includes("localhost")) {
    uris.push(dingtalkLoginRedirectUriFromOrigin(origin.replace("localhost", "127.0.0.1")));
  }
  if (env.DINGTALK_LOGIN_REDIRECT_URI) uris.push(env.DINGTALK_LOGIN_REDIRECT_URI);
  return [...new Set(uris)];
}

function publicEmployee(
  row: typeof employees.$inferSelect,
  enterprise?: { id: number; name: string; code: string; status: string } | null,
  extras?: {
    role?: typeof row.role;
    enterpriseId?: number | null;
    trueRole?: typeof row.role;
    actAs?: unknown;
    mustChangePassword?: boolean;
  },
) {
  const role = extras?.role ?? row.role;
  const enterpriseId = extras?.enterpriseId ?? row.enterpriseId;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    dept: row.dept,
    role,
    status: row.status,
    enterpriseId,
    enterprise: enterprise
      ? {
          id: enterprise.id,
          name: enterprise.name,
          code: enterprise.code,
          status: enterprise.status,
        }
      : null,
    mustChangePassword: extras?.mustChangePassword ?? row.mustChangePassword,
    lastLoginAt: row.lastLoginAt,
    trueRole: extras?.trueRole ?? row.role,
    actAs: extras?.actAs ?? null,
  };
}

async function loadEnterprise(enterpriseId: number | null) {
  if (enterpriseId == null) return null;
  const [enterprise] = await db
    .select({
      id: enterprises.id,
      name: enterprises.name,
      code: enterprises.code,
      status: enterprises.status,
    })
    .from(enterprises)
    .where(eq(enterprises.id, enterpriseId))
    .limit(1);
  return enterprise ?? null;
}

async function issueLoginSession(
  req: FastifyRequest,
  reply: FastifyReply,
  user: typeof employees.$inferSelect,
  options: { action: string },
) {
  if (user.role === "org_admin" || user.role === "dept_admin") {
    const enterprise = await loadEnterprise(user.enterpriseId);
    if (!enterprise || enterprise.status !== "active") {
      return reply.code(401).send({ success: false, message: "用户不可用" });
    }
  } else if (user.role === "employee" && user.enterpriseId != null) {
    const enterprise = await loadEnterprise(user.enterpriseId);
    if (!enterprise || enterprise.status === "disabled") {
      return reply.code(401).send({ success: false, message: "用户不可用" });
    }
  }

  const mustChangePassword = await isInitialRegistrationPassword(user.passwordHash);
  await db
    .update(employees)
    .set({
      lastLoginAt: new Date(),
      mustChangePassword,
      updatedAt: new Date(),
    })
    .where(eq(employees.id, user.id));

  const token = await signSession({
    sub: String(user.id),
    role: user.role,
    phone: user.phone,
    name: user.name,
    mustChangePassword,
    enterpriseId: user.enterpriseId,
  });

  await writeOpsAudit({
    actorEmployeeId: user.id,
    action: options.action,
    targetType: "employee",
    targetId: String(user.id),
    ip: req.ip,
  });

  return {
    success: true,
    data: {
      token,
      user: publicEmployee(user, await loadEnterprise(user.enterpriseId), {
        mustChangePassword,
      }),
    },
  };
}

function initialPasswordDingtalkChallenge(reply: FastifyReply, employeeId: number) {
  const pendingState = createDingtalkLoginState(env.JWT_SECRET, Date.now(), employeeId);
  return reply.code(403).send({
    success: false,
    code: INITIAL_PASSWORD_DINGTALK_REQUIRED,
    message: INITIAL_PASSWORD_DINGTALK_MESSAGE,
    data: { pendingState },
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/register", async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        phone: z.string().trim().min(5).max(20),
        password: z.string().min(1).max(128),
      })
      .safeParse(req.body);

    if (!body.success) {
      return reply.code(400).send({ success: false, message: "请完整填写注册信息" });
    }
    const passwordError = validateNewPassword(body.data.password);
    if (passwordError) {
      return reply.code(400).send({ success: false, message: passwordError });
    }

    try {
      const passwordHash = await hashPassword(body.data.password);

      const [employee] = await db
        .insert(employees)
        .values({
          name: body.data.name,
          phone: body.data.phone,
          passwordHash,
          role: "employee",
          status: "active",
          enterpriseId: null,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
        })
        .returning({
          id: employees.id,
          name: employees.name,
          dept: employees.dept,
          phone: employees.phone,
          status: employees.status,
          role: employees.role,
          enterpriseId: employees.enterpriseId,
        });

      const dingtalkJoin = await tryJoinRegisteredEmployeeFromDingtalk({
        employeeId: employee.id,
        name: employee.name,
        phone: employee.phone,
      });
      const dingtalkJoined = dingtalkJoin.status === "matched";
      const message = registerDingtalkJoinMessage(dingtalkJoin);
      if (dingtalkJoin.status === "error") {
        req.log.warn({ employeeId: employee.id }, "register dingtalk join failed");
      }

      await writeOpsAudit({
        action: "auth.register_personal",
        targetType: "employee",
        targetId: String(employee.id),
        detail: {
          name: employee.name,
          phone: employee.phone,
          dingtalkStatus: dingtalkJoin.status,
          ...(dingtalkJoin.status === "matched"
            ? {
                userid: dingtalkJoin.userid,
                enterpriseId: dingtalkJoin.enterpriseId,
                departmentIds: dingtalkJoin.departments.map((row) => row.departmentId),
              }
            : {}),
        },
        ip: req.ip,
      });

      return {
        success: true,
        data: {
          ...employee,
          enterpriseId:
            dingtalkJoin.status === "matched" ? dingtalkJoin.enterpriseId : employee.enterpriseId,
          dept:
            dingtalkJoin.status === "matched"
              ? dingtalkJoin.departments[0]?.departmentName ?? employee.dept
              : employee.dept,
          dingtalkJoined,
          message,
        },
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("employees_phone_uidx") || message.includes("unique")) {
        return reply.code(409).send({ success: false, message: "该手机号已提交申请或已注册" });
      }
      throw e;
    }
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = z
      .object({
        phone: z.string().min(5).max(20),
        password: z.string().min(1),
      })
      .safeParse(req.body);

    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const [user] = await db
      .select()
      .from(employees)
      .where(eq(employees.phone, body.data.phone))
      .limit(1);

    if (!user || !isSessionRole(user.role)) {
      return reply.code(401).send({ success: false, message: "手机号或密码错误" });
    }

    const ok = await verifyPassword(body.data.password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ success: false, message: "手机号或密码错误" });
    }

    if (user.status === "pending") {
      return reply.code(403).send({
        success: false,
        code: "REGISTRATION_PENDING",
        message: "注册申请待审核，请等待管理员审核",
      });
    }

    if (user.status !== "active") {
      return reply.code(401).send({ success: false, message: "手机号或密码错误" });
    }

    if (await isInitialRegistrationPassword(user.passwordHash)) {
      return initialPasswordDingtalkChallenge(reply, user.id);
    }

    return issueLoginSession(req, reply, user, {
      action: "auth.login",
    });
  });

  app.post("/api/auth/login-ldap", async (req, reply) => {
    if (!env.LDAP_URL || !env.LDAP_BASE) {
      return reply.code(503).send({ success: false, message: "未配置 LDAP" });
    }
    const body = z
      .object({
        username: z.string().trim().min(1).max(64),
        password: z.string().min(1).max(128),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const person = await authenticateLdapUser({
      username: body.data.username,
      password: body.data.password,
      url: env.LDAP_URL,
      baseDn: env.LDAP_BASE,
    });
    if (!person) {
      return reply.code(401).send({ success: false, message: "公司账号或密码错误" });
    }

    const directory = await db.select().from(employees);
    let matched = matchEmployeeForLdapPerson(person, directory);
    if (!matched) {
      try {
        matched = await provisionEmployeeFromLdapDingtalk(person, { ip: req.ip });
      } catch (error) {
        req.log.warn({ err: error, uid: person.uid }, "ldap dingtalk provision failed");
        matched = null;
      }
    }
    if (!matched) {
      return reply.code(403).send({
        success: false,
        code: "LDAP_USER_NOT_LINKED",
        message: "公司账号已验证，但系统中没有对应员工，请联系管理员",
      });
    }
    const [user] = await db.select().from(employees).where(eq(employees.id, matched.id)).limit(1);
    if (!user || !isSessionRole(user.role)) {
      return reply.code(401).send({ success: false, message: "公司账号或密码错误" });
    }
    if (user.status === "pending") {
      return reply.code(403).send({
        success: false,
        code: "REGISTRATION_PENDING",
        message: "注册申请待审核，请等待管理员审核",
      });
    }
    if (user.status !== "active") {
      return reply.code(401).send({ success: false, message: "公司账号或密码错误" });
    }

    if (await isInitialRegistrationPassword(user.passwordHash)) {
      return initialPasswordDingtalkChallenge(reply, user.id);
    }

    return issueLoginSession(req, reply, user, {
      action: "auth.login_ldap",
    });
  });

  app.get("/api/auth/dingtalk/start", async (req, reply) => {
    const credentials = readDingtalkCredentials(env);
    if (!credentials) {
      return reply.code(503).send({ success: false, message: "未配置钉钉登录" });
    }
    const query = z
      .object({
        redirect_uri: z.string().url().optional(),
        pending_state: z.string().trim().min(1).max(2048).optional(),
      })
      .safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const allowed = allowedDingtalkLoginRedirects();
    const redirectUri = query.data.redirect_uri ?? allowed[0]!;
    if (!isAllowedDingtalkRedirectUri(redirectUri, allowed)) {
      return reply.code(400).send({ success: false, message: "回调地址未登记" });
    }
    let state = createDingtalkLoginState(env.JWT_SECRET);
    if (query.data.pending_state) {
      const pending = readDingtalkLoginState(env.JWT_SECRET, query.data.pending_state);
      if (!pending.ok) {
        return reply.code(401).send({ success: false, message: "钉钉登录已过期，请重试" });
      }
      state = query.data.pending_state;
    }
    return {
      success: true,
      data: {
        authorizeUrl: buildDingtalkAuthorizeUrl({
          clientId: credentials.appKey,
          redirectUri,
          state,
        }),
      },
    };
  });

  app.post("/api/auth/login-dingtalk", async (req, reply) => {
    const credentials = readDingtalkCredentials(env);
    if (!credentials) {
      return reply.code(503).send({ success: false, message: "未配置钉钉登录" });
    }
    const body = z
      .object({
        code: z.string().trim().min(1).max(512),
        state: z.string().trim().min(1).max(2048),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const pending = readDingtalkLoginState(env.JWT_SECRET, body.data.state);
    if (!pending.ok) {
      return reply.code(401).send({ success: false, message: "钉钉登录已过期，请重试" });
    }

    let resolved: Awaited<ReturnType<typeof resolveDingtalkLoginEmployee>>;
    try {
      resolved = await resolveDingtalkLoginEmployee({
        code: body.data.code,
        ip: req.ip,
        pendingEmployeeId: pending.employeeId,
      });
    } catch (error) {
      req.log.warn({ err: error }, "dingtalk login failed");
      return reply.code(401).send({ success: false, message: "钉钉授权失败，请重试" });
    }

    if (resolved.status === "oauth_failed") {
      return reply.code(401).send({ success: false, message: "钉钉授权失败，请重试" });
    }
    if (resolved.status === "not_in_corp") {
      return reply.code(403).send({
        success: false,
        code: "DINGTALK_NOT_IN_CORP",
        message: "钉钉账号不是本企业成员，无法登录",
      });
    }
    if (resolved.status === "not_linked") {
      return reply.code(403).send({
        success: false,
        code: "DINGTALK_USER_NOT_LINKED",
        message: "钉钉已验证，但系统中没有对应员工，请联系管理员",
      });
    }
    if (resolved.status === "pending_mismatch") {
      return reply.code(403).send({
        success: false,
        code: "DINGTALK_ACCOUNT_MISMATCH",
        message: "钉钉账号与当前登录账户不一致",
      });
    }

    const user = resolved.user;
    if (!isSessionRole(user.role)) {
      return reply.code(401).send({ success: false, message: "钉钉授权失败，请重试" });
    }
    if (user.status === "pending") {
      return reply.code(403).send({
        success: false,
        code: "REGISTRATION_PENDING",
        message: "注册申请待审核，请等待管理员审核",
      });
    }
    if (user.status !== "active") {
      return reply.code(401).send({ success: false, message: "用户不可用" });
    }

    return issueLoginSession(req, reply, user, {
      action: "auth.login_dingtalk",
    });
  });

  app.get("/api/auth/me", { preHandler: [requireSession] }, async (req, reply) => {
    const [user] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, req.employeeId!))
      .limit(1);
    if (!user || user.status !== "active") {
      return reply.code(401).send({ success: false, message: "用户不可用" });
    }
    return {
      success: true,
      data: publicEmployee(user, await loadEnterprise(req.session!.enterpriseId), {
        role: req.session!.role,
        enterpriseId: req.session!.enterpriseId,
        trueRole: req.session!.trueRole ?? user.role,
        actAs: req.session!.actAs ?? null,
      }),
    };
  });

  app.post(
    "/api/auth/change-password",
    { preHandler: [requireSession] },
    async (req, reply) => {
      const body = z
        .object({
          oldPassword: z.string().min(1).max(128).optional(),
          newPassword: z.string().min(8).max(128),
        })
        .safeParse(req.body);

      if (!body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const policy = validateNewPassword(body.data.newPassword);
      if (policy) {
        return reply.code(400).send({ success: false, message: policy });
      }

      const [user] = await db
        .select()
        .from(employees)
        .where(eq(employees.id, req.employeeId!))
        .limit(1);

      if (!user || !isSessionRole(user.role)) {
        return reply.code(401).send({ success: false, message: "用户不存在" });
      }

      const forced = user.mustChangePassword;
      if (!forced) {
        if (!body.data.oldPassword) {
          return reply.code(400).send({ success: false, message: "参数无效" });
        }
        const ok = await verifyPassword(body.data.oldPassword, user.passwordHash);
        if (!ok) {
          return reply.code(400).send({ success: false, message: "原密码错误" });
        }
      } else if (body.data.oldPassword) {
        const ok = await verifyPassword(body.data.oldPassword, user.passwordHash);
        if (!ok) {
          return reply.code(400).send({ success: false, message: "原密码错误" });
        }
      }

      if (body.data.oldPassword && body.data.oldPassword === body.data.newPassword) {
        return reply.code(400).send({ success: false, message: "新密码不能与原密码相同" });
      }

      const passwordHash = await hashPassword(body.data.newPassword);
      await db
        .update(employees)
        .set({
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(employees.id, user.id));

      const token = await signSession({
        sub: String(user.id),
        role: user.role,
        phone: user.phone,
        name: user.name,
        mustChangePassword: false,
        enterpriseId: user.enterpriseId,
      });

      await writeOpsAudit({
        actorEmployeeId: user.id,
        action: "auth.change_password",
        targetType: "employee",
        targetId: String(user.id),
        ip: req.ip,
      });

      return {
        success: true,
        data: {
          token,
          user: {
            ...publicEmployee(user, await loadEnterprise(user.enterpriseId)),
            mustChangePassword: false,
          },
        },
      };
    },
  );
}
