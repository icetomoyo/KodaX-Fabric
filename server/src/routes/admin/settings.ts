import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  loadSensitiveWordsConfig,
  updateSensitiveWordFlags,
  SensitiveWordsError,
} from "../../lib/relay/sensitive-words.js";
import { requireRoles, requireSession } from "../../middleware/auth.js";

function settingsPayload(config: { detectEnabled: boolean; interceptEnabled: boolean }) {
  return {
    sensitiveWordDetectEnabled: config.detectEnabled,
    sensitiveWordInterceptEnabled: config.interceptEnabled,
  };
}

export async function adminSettingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/settings", async () => {
    const config = await loadSensitiveWordsConfig();
    return {
      success: true,
      data: settingsPayload(config),
    };
  });

  app.patch("/api/admin/settings", async (req, reply) => {
    const body = z
      .object({
        sensitiveWordDetectEnabled: z.boolean().optional(),
        sensitiveWordInterceptEnabled: z.boolean().optional(),
      })
      .refine(
        (value) =>
          value.sensitiveWordDetectEnabled !== undefined
          || value.sensitiveWordInterceptEnabled !== undefined,
        { message: "参数无效" },
      )
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    try {
      const config = await updateSensitiveWordFlags({
        detectEnabled: body.data.sensitiveWordDetectEnabled,
        interceptEnabled: body.data.sensitiveWordInterceptEnabled,
      });
      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "settings.update",
        targetType: "system_setting",
        targetId: "sensitive_words",
        detail: settingsPayload(config),
        ip: req.ip,
      });
      return {
        success: true,
        data: settingsPayload(config),
      };
    } catch (error) {
      if (error instanceof SensitiveWordsError) {
        return reply.code(error.status).send({ success: false, message: error.message });
      }
      throw error;
    }
  });
}
