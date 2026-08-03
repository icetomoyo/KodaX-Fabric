import type { FastifyInstance } from "fastify";

/** OpenAI-compatible relay — full implementation in next iteration */
export async function v1StubRoutes(app: FastifyInstance) {
  app.post("/v1/chat/completions", async (_req, reply) => {
    return reply.code(501).send({
      error: {
        message:
          "Relay not enabled yet. Auth, audit schema and admin console are ready; channel pool + proxy comes next.",
        type: "not_implemented",
        code: "relay_pending",
      },
    });
  });
}
