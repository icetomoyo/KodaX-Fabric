import type { SessionClaims } from "../lib/jwt.js";
import type { RelayPrincipal } from "../lib/relay/types.js";

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionClaims;
    employeeId?: number;
    relayPrincipal?: RelayPrincipal;
  }
}
