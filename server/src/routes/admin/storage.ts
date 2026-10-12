import type { FastifyInstance } from "fastify";
import {
  refreshRequestContextStorage,
  requestContextStorageReport,
} from "../../lib/request-context-storage.js";
import { requireRoles, requireSession } from "../../middleware/auth.js";

export async function adminStorageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/storage", async () => {
    return { success: true, data: await requestContextStorageReport() };
  });

  // 只负责触发，不等统计结束：生产上全量一轮要几分钟，页面轮询 scanning 即可。
  app.post("/api/admin/storage/rescan", async (req) => {
    void refreshRequestContextStorage(req.log);
    return { success: true, data: await requestContextStorageReport() };
  });
}
