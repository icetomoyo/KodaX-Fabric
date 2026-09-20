import type { FastifyInstance } from "fastify";
import { env } from "../../config.js";
import {
  DingtalkApiError,
  DingtalkNotConfiguredError,
  fetchDingtalkDepartmentTree,
  readDingtalkCredentials,
} from "../../lib/dingtalk-department-tree.js";
import {
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export async function adminEnterpriseDingtalkRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/enterprise-dingtalk/departments", async (_req, reply) => {
    const credentials = readDingtalkCredentials(env);
    if (!credentials) {
      return reply.code(400).send({
        success: false,
        code: "DINGTALK_NOT_CONFIGURED",
        message: new DingtalkNotConfiguredError().message,
      });
    }
    try {
      const tree = await fetchDingtalkDepartmentTree(credentials);
      return { success: true, data: tree };
    } catch (error) {
      if (error instanceof DingtalkNotConfiguredError) {
        return reply.code(400).send({
          success: false,
          code: error.code,
          message: error.message,
        });
      }
      if (error instanceof DingtalkApiError) {
        return reply.code(502).send({ success: false, message: error.message });
      }
      throw error;
    }
  });
}
