import type { SessionClaims } from "../lib/jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionClaims;
    employeeId?: number;
  }
}
