import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { env } from "../config.js";
import { actingEmployeeId } from "../lib/act-as.js";
import { buildPublicRelayBaseUrl } from "../lib/support-bot/account-context.js";
import { runSupportAgent } from "../lib/support-bot/agent.js";
import {
  createPostgresSupportChatStore,
  parseSupportChatMessage,
  runSupportChatTurn,
  type SupportChatStore,
} from "../lib/support-bot/chat.js";
import { SupportBotError } from "../lib/support-bot/errors.js";
import {
  resolveSupportBotTransport,
  type SupportBotTransport,
} from "../lib/support-bot/invoke.js";
import { consumeSupportBotRateLimit } from "../lib/support-bot/rate-limit.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../middleware/auth.js";

const chatBodySchema = z.object({
  message: z.string(),
  conversationId: z.number().int().positive().optional(),
  newConversation: z.boolean().optional(),
});

export const supportBotRuntime = {
  consumeRateLimit: consumeSupportBotRateLimit,
  resolveTransport: resolveSupportBotTransport,
  runAgent: runSupportAgent,
  createStore: createPostgresSupportChatStore,
};

function sendSupportError(reply: FastifyReply, error: SupportBotError) {
  return reply.code(error.httpStatus).send({
    success: false,
    error: { code: error.code, message: error.message },
  });
}

export async function supportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("employee", "team_admin", "dept_admin", "org_admin", "admin"));

  app.get("/api/support/status", async () => {
    return { success: true, data: { enabled: env.SUPPORT_BOT_ENABLED } };
  });

  app.get("/api/support/history", async (req) => {
    const store: SupportChatStore = supportBotRuntime.createStore();
    const employeeId = actingEmployeeId(req);
    const latest = await store.findLatestConversation(employeeId);
    if (!latest) {
      return { success: true, data: { conversationId: null, messages: [] } };
    }
    const messages = await store.listMessages(latest.id);
    return { success: true, data: { conversationId: latest.id, messages } };
  });

  app.post("/api/support/chat", async (req, reply) => {
    const parsed = chatBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendSupportError(
        reply,
        new SupportBotError(400, "INVALID_MESSAGE", "消息长度须为 1–2000 个字符"),
      );
    }
    const message = parseSupportChatMessage(parsed.data.message);
    if (!message) {
      return sendSupportError(
        reply,
        new SupportBotError(400, "INVALID_MESSAGE", "消息长度须为 1–2000 个字符"),
      );
    }

    const employeeId = actingEmployeeId(req);
    if (!req.session) {
      return reply.code(401).send({ success: false, message: "未登录" });
    }

    try {
      await supportBotRuntime.consumeRateLimit(employeeId);
      const transport: SupportBotTransport = await supportBotRuntime.resolveTransport();
      const result = await runSupportChatTurn({
        employeeId,
        message,
        conversationId: parsed.data.conversationId,
        newConversation: parsed.data.newConversation,
        store: supportBotRuntime.createStore(),
        complete: (turn) =>
          supportBotRuntime.runAgent({
            transport,
            account: {
              employeeId,
              role: req.session!.role,
              trueRole: req.session!.trueRole,
              actAs: req.session!.actAs,
              relayBaseUrl: buildPublicRelayBaseUrl(req),
            },
            history: turn.history,
            userMessage: turn.userMessage,
          }),
      });
      return { success: true, data: result };
    } catch (error) {
      if (error instanceof SupportBotError) {
        return sendSupportError(reply, error);
      }
      return sendSupportError(
        reply,
        new SupportBotError(502, "SUPPORT_BOT_UPSTREAM_ERROR", "问答助手暂时无法回答，请稍后再试"),
      );
    }
  });
}
