import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import { quotaPolicy } from "../../db/schema/index.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import { nextQuotaResetAt } from "../../lib/quota-time.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

const QUOTA_POLICY_KEY = "default";

async function currentPolicy() {
  const [row] = await db
    .select()
    .from(quotaPolicy)
    .where(eq(quotaPolicy.key, QUOTA_POLICY_KEY))
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

export async function adminQuotaRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/quota-policy", async (_req, reply) => {
    const policy = await currentPolicy();
    if (!policy) {
      return reply.code(503).send({
        success: false,
        code: "quota_policy_not_initialized",
        message: "每日 Token 配额未初始化，请先执行数据库迁移",
      });
    }
    return {
      success: true,
      data: policyPayload(policy.dailyTokenLimit),
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

    const [saved] = await db
      .insert(quotaPolicy)
      .values({
        key: QUOTA_POLICY_KEY,
        dailyTokenLimit: body.data.dailyTokenLimit,
      })
      .onConflictDoUpdate({
        target: quotaPolicy.key,
        set: {
          dailyTokenLimit: body.data.dailyTokenLimit,
          updatedAt: new Date(),
        },
      })
      .returning();

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "quota_policy.update",
      targetType: "quota_policy",
      targetId: saved.key,
      detail: { dailyTokenLimit: body.data.dailyTokenLimit },
      ip: req.ip,
    });

    return { success: true, data: policyPayload(saved.dailyTokenLimit) };
  });
}
