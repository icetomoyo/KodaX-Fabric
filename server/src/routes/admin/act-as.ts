import type { FastifyInstance } from "fastify";
import { loadActAsOrgTree } from "../../lib/act-as.js";
import {
  requirePasswordChanged,
  requireSession,
  requireTrueAdmin,
} from "../../middleware/auth.js";

export async function adminActAsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireTrueAdmin());

  app.get("/api/admin/act-as/org", async () => ({
    success: true,
    data: await loadActAsOrgTree(),
  }));
}
