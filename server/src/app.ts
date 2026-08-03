import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { adminUserRoutes } from "./routes/admin/users.js";
import { adminOverviewRoutes } from "./routes/admin/overview.js";
import { adminProviderRoutes } from "./routes/admin/providers.js";
import { adminCredentialRoutes } from "./routes/admin/credentials.js";
import { adminModelRouteRoutes } from "./routes/admin/model-routes.js";
import { adminLogRoutes } from "./routes/admin/logs.js";
import { adminGrantRoutes } from "./routes/admin/grants.js";
import { adminQuotaRoutes } from "./routes/admin/quota.js";
import { adminOpsAuditRoutes } from "./routes/admin/ops-audit.js";
import { v1StubRoutes } from "./routes/v1/stub.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
    trustProxy: true,
    bodyLimit: 20 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(adminUserRoutes);
  await app.register(adminOverviewRoutes);
  await app.register(adminProviderRoutes);
  await app.register(adminCredentialRoutes);
  await app.register(adminModelRouteRoutes);
  await app.register(adminLogRoutes);
  await app.register(adminGrantRoutes);
  await app.register(adminQuotaRoutes);
  await app.register(adminOpsAuditRoutes);
  await app.register(v1StubRoutes);

  return app;
}

