import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { meTicketRoutes } from "./routes/me-tickets.js";
import { adminUserRoutes } from "./routes/admin/users.js";
import { adminEnterpriseRoutes } from "./routes/admin/enterprises.js";
import { adminTeamRoutes } from "./routes/admin/teams.js";
import { adminProjectRoutes } from "./routes/admin/projects.js";
import { adminOverviewRoutes } from "./routes/admin/overview.js";
import { adminProviderRoutes } from "./routes/admin/providers.js";
import { adminCredentialRoutes } from "./routes/admin/credentials.js";
import { adminModelPriceRoutes } from "./routes/admin/model-prices.js";
import { adminModelRouteRoutes } from "./routes/admin/model-routes.js";
import { adminLogRoutes } from "./routes/admin/logs.js";
import { adminErrorLogRoutes } from "./routes/admin/error-logs.js";
import { adminOpsAuditRoutes } from "./routes/admin/ops-audit.js";
import { adminTicketRoutes } from "./routes/admin/tickets.js";
import { chatCompletionRoutes } from "./routes/relay/chat-completions.js";
import { anthropicMessageRoutes } from "./routes/relay/anthropic-messages.js";

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
  await app.register(meTicketRoutes);
  await app.register(adminUserRoutes);
  await app.register(adminEnterpriseRoutes);
  await app.register(adminTeamRoutes);
  await app.register(adminProjectRoutes);
  await app.register(adminOverviewRoutes);
  await app.register(adminProviderRoutes);
  await app.register(adminCredentialRoutes);
  await app.register(adminModelPriceRoutes);
  await app.register(adminModelRouteRoutes);
  await app.register(adminLogRoutes);
  await app.register(adminErrorLogRoutes);
  await app.register(adminOpsAuditRoutes);
  await app.register(adminTicketRoutes);
  await app.register(chatCompletionRoutes);
  await app.register(anthropicMessageRoutes);

  return app;
}
