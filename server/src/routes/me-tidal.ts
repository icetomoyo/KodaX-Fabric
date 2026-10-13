import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { employees, tidalApplications } from "../db/schema/index.js";
import { actingEmployeeId } from "../lib/act-as.js";
import {
  canHoldTidalGrant,
  findActiveTidalGrant,
  loadTidalSettings,
} from "../lib/relay/tidal-settings.js";
import { requireRoles, requireSession } from "../middleware/auth.js";

const applySchema = z.object({
  /** 申请用到什么时候（ISO 时间），必填。 */
  expiresAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().max(200).nullable().optional(),
});

type ApplicationRow = typeof tidalApplications.$inferSelect;

function applicationView(row: ApplicationRow) {
  return {
    id: row.id,
    status: row.status,
    requestedExpiresAt: row.requestedExpiresAt,
    reason: row.reason,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
  };
}

async function loadApplicant(employeeId: number) {
  const [row] = await db
    .select({
      status: employees.status,
      role: employees.role,
      enterpriseId: employees.enterpriseId,
    })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  return row ?? null;
}

/**
 * 员工申请潮汐授权：说明要用到什么时候，超级管理员审核通过后才有潮汐KEY。
 * 潮汐没开启、或者这个账号本来就用不了潮汐时，不给申请入口。
 */
export async function meTidalRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requireRoles("employee", "dept_admin", "org_admin", "admin"));

  app.get("/api/me/tidal-application", async (req) => {
    const employeeId = actingEmployeeId(req);
    const [settings, applicant] = await Promise.all([loadTidalSettings(), loadApplicant(employeeId)]);
    if (!settings.enabled || !canHoldTidalGrant(applicant)) {
      return { success: true, data: { available: false, granted: false, application: null } };
    }
    const [grant, [latest]] = await Promise.all([
      findActiveTidalGrant(employeeId),
      db
        .select()
        .from(tidalApplications)
        .where(eq(tidalApplications.employeeId, employeeId))
        .orderBy(desc(tidalApplications.id))
        .limit(1),
    ]);
    return {
      success: true,
      data: {
        available: true,
        granted: grant != null,
        application: latest ? applicationView(latest) : null,
      },
    };
  });

  app.post("/api/me/tidal-application", async (req, reply) => {
    const body = applySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "请填写到期时间" });
    }
    const requestedExpiresAt = new Date(body.data.expiresAt);
    if (requestedExpiresAt.getTime() <= Date.now()) {
      return reply.code(400).send({ success: false, message: "到期时间必须晚于现在" });
    }

    const employeeId = actingEmployeeId(req);
    const [settings, applicant] = await Promise.all([loadTidalSettings(), loadApplicant(employeeId)]);
    if (!settings.enabled) {
      return reply.code(400).send({
        success: false,
        code: "tidal_disabled",
        message: "潮汐调度暂未开启，无法申请",
      });
    }
    if (!canHoldTidalGrant(applicant)) {
      return reply.code(400).send({
        success: false,
        code: "tidal_application_ineligible",
        message: "只有已加入企业的在职员工可以申请",
      });
    }
    if (await findActiveTidalGrant(employeeId)) {
      return reply.code(409).send({
        success: false,
        code: "tidal_grant_exists",
        message: "你已经有潮汐授权了，到期后再申请",
      });
    }

    // 一人同时只能有一条待审核的申请（库里有唯一约束兜底）。
    const [created] = await db
      .insert(tidalApplications)
      .values({
        employeeId,
        requestedExpiresAt,
        reason: body.data.reason || null,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      return reply.code(409).send({
        success: false,
        code: "tidal_application_pending",
        message: "你已经提交过申请，请等待管理员审核",
      });
    }
    return { success: true, data: applicationView(created) };
  });
}
