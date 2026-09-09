import { isAxiosError } from "axios";
import { readSupportErrorBody } from "@/lib/support-error";
import { http } from "./http";

export type SupportMessageRole = "user" | "assistant";

export type SupportHistoryMessage = {
  id: number;
  role: SupportMessageRole;
  content: string;
  createdAt: string;
};

export type SupportStatusResponse = {
  success: true;
  data: { enabled: boolean };
};

export type SupportHistoryResponse = {
  success: true;
  data: {
    conversationId: number | null;
    messages: SupportHistoryMessage[];
  };
};

export type SupportChatRequest = {
  message: string;
  conversationId?: number;
  newConversation?: boolean;
};

export type SupportChatResponse = {
  success: true;
  data: {
    conversationId: number;
    reply: string;
  };
};

export function supportApiError(error: unknown, fallback = "提问失败，请稍后再试"): string {
  if (isAxiosError(error)) {
    const fromBody = readSupportErrorBody(error.response?.data);
    if (fromBody) return fromBody;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export async function fetchSupportStatus(): Promise<boolean> {
  const { data } = await http.get<SupportStatusResponse>("/api/support/status");
  return data.success ? data.data.enabled : false;
}

export async function fetchSupportHistory(): Promise<SupportHistoryResponse["data"]> {
  const { data } = await http.get<SupportHistoryResponse>("/api/support/history");
  if (!data.success) {
    return { conversationId: null, messages: [] };
  }
  return data.data;
}

export async function sendSupportChat(payload: SupportChatRequest): Promise<SupportChatResponse["data"]> {
  const { data } = await http.post<SupportChatResponse>("/api/support/chat", payload, {
    timeout: 60_000,
  });
  return data.data;
}
