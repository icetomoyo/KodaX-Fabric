import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { supportConversations, supportMessages } from "../../db/schema/index.js";
import { supportBotConversationNotFound } from "./errors.js";

export type SupportStoredRole = "user" | "assistant";

export type SupportHistoryMessage = {
  id: number;
  role: SupportStoredRole;
  content: string;
  createdAt: string;
};

export type SupportChatStore = {
  findOwnedConversation(employeeId: number, conversationId: number): Promise<{ id: number } | null>;
  findLatestConversation(employeeId: number): Promise<{ id: number } | null>;
  createConversation(employeeId: number): Promise<{ id: number }>;
  listMessages(conversationId: number): Promise<SupportHistoryMessage[]>;
  listRecentMessages(
    conversationId: number,
    limit: number,
  ): Promise<Array<{ role: SupportStoredRole; content: string }>>;
  insertMessage(conversationId: number, role: SupportStoredRole, content: string): Promise<void>;
};

export function createPostgresSupportChatStore(): SupportChatStore {
  return {
    async findOwnedConversation(employeeId, conversationId) {
      const [row] = await db
        .select({ id: supportConversations.id })
        .from(supportConversations)
        .where(
          and(
            eq(supportConversations.id, conversationId),
            eq(supportConversations.employeeId, employeeId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async findLatestConversation(employeeId) {
      const [row] = await db
        .select({ id: supportConversations.id })
        .from(supportConversations)
        .where(eq(supportConversations.employeeId, employeeId))
        .orderBy(desc(supportConversations.updatedAt), desc(supportConversations.id))
        .limit(1);
      return row ?? null;
    },
    async createConversation(employeeId) {
      const [row] = await db
        .insert(supportConversations)
        .values({ employeeId })
        .returning({ id: supportConversations.id });
      if (!row) throw new Error("failed to create support conversation");
      return row;
    },
    async listMessages(conversationId) {
      const rows = await db
        .select({
          id: supportMessages.id,
          role: supportMessages.role,
          content: supportMessages.content,
          createdAt: supportMessages.createdAt,
        })
        .from(supportMessages)
        .where(eq(supportMessages.conversationId, conversationId))
        .orderBy(asc(supportMessages.createdAt), asc(supportMessages.id));
      return rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.createdAt.toISOString(),
      }));
    },
    async listRecentMessages(conversationId, limit) {
      const rows = await db
        .select({
          role: supportMessages.role,
          content: supportMessages.content,
          createdAt: supportMessages.createdAt,
          id: supportMessages.id,
        })
        .from(supportMessages)
        .where(eq(supportMessages.conversationId, conversationId))
        .orderBy(desc(supportMessages.createdAt), desc(supportMessages.id))
        .limit(limit);
      return rows.reverse().map((row) => ({ role: row.role, content: row.content }));
    },
    async insertMessage(conversationId, role, content) {
      const now = new Date();
      await db.insert(supportMessages).values({ conversationId, role, content });
      await db
        .update(supportConversations)
        .set({ updatedAt: now })
        .where(eq(supportConversations.id, conversationId));
    },
  };
}

export function createMemorySupportChatStore(): SupportChatStore & {
  dump(): { conversations: Array<{ id: number; employeeId: number }>; messages: SupportHistoryMessage[] };
} {
  let nextConversationId = 1;
  let nextMessageId = 1;
  const conversations: Array<{ id: number; employeeId: number; updatedAt: number }> = [];
  const messages: Array<SupportHistoryMessage & { conversationId: number; sort: number }> = [];

  return {
    async findOwnedConversation(employeeId, conversationId) {
      const row = conversations.find((item) => item.id === conversationId && item.employeeId === employeeId);
      return row ? { id: row.id } : null;
    },
    async findLatestConversation(employeeId) {
      const owned = conversations
        .filter((item) => item.employeeId === employeeId)
        .sort((left, right) => right.updatedAt - left.updatedAt || right.id - left.id);
      return owned[0] ? { id: owned[0].id } : null;
    },
    async createConversation(employeeId) {
      const row = { id: nextConversationId++, employeeId, updatedAt: Date.now() };
      conversations.push(row);
      return { id: row.id };
    },
    async listMessages(conversationId) {
      return messages
        .filter((item) => item.conversationId === conversationId)
        .sort((left, right) => left.sort - right.sort)
        .map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt }));
    },
    async listRecentMessages(conversationId, limit) {
      return messages
        .filter((item) => item.conversationId === conversationId)
        .sort((left, right) => left.sort - right.sort)
        .slice(-limit)
        .map(({ role, content }) => ({ role, content }));
    },
    async insertMessage(conversationId, role, content) {
      messages.push({
        id: nextMessageId++,
        conversationId,
        role,
        content,
        createdAt: new Date().toISOString(),
        sort: messages.length,
      });
      const conversation = conversations.find((item) => item.id === conversationId);
      if (conversation) conversation.updatedAt = Date.now();
    },
    dump() {
      return {
        conversations: conversations.map(({ id, employeeId }) => ({ id, employeeId })),
        messages: messages.map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt })),
      };
    },
  };
}

export async function resolveSupportConversation(
  store: SupportChatStore,
  employeeId: number,
  input: { conversationId?: number; newConversation?: boolean },
): Promise<{ id: number }> {
  if (input.newConversation) {
    return store.createConversation(employeeId);
  }
  if (input.conversationId != null) {
    const owned = await store.findOwnedConversation(employeeId, input.conversationId);
    if (!owned) throw supportBotConversationNotFound();
    return owned;
  }
  const latest = await store.findLatestConversation(employeeId);
  return latest ?? store.createConversation(employeeId);
}

export async function runSupportChatTurn(input: {
  employeeId: number;
  message: string;
  conversationId?: number;
  newConversation?: boolean;
  store: SupportChatStore;
  complete: (turn: {
    history: Array<{ role: SupportStoredRole; content: string }>;
    userMessage: string;
  }) => Promise<string>;
}): Promise<{ conversationId: number; reply: string }> {
  const conversation = await resolveSupportConversation(input.store, input.employeeId, input);
  const history = await input.store.listRecentMessages(conversation.id, 8);
  await input.store.insertMessage(conversation.id, "user", input.message);
  const reply = await input.complete({
    history,
    userMessage: input.message,
  });
  await input.store.insertMessage(conversation.id, "assistant", reply);
  return { conversationId: conversation.id, reply };
}

export function parseSupportChatMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const message = raw.trim();
  if (message.length < 1 || message.length > 2000) return null;
  return message;
}
