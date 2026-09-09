import { and, desc, eq, gt } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  modelRoutes,
  productLines,
  providers,
  upstreamCredentials,
} from "../../db/schema/index.js";
import {
  collectCatalogModels,
  parseDiscoveredModels,
  toCatalogModelName,
} from "../discovered-models.js";
import { effectiveCredentialStatus } from "../credential-status.js";
import { resolveProtocolUpstreamConfig } from "../upstream-protocol-config.js";
import type { RelayCandidate } from "../relay/types.js";
import { sendRelayUpstream } from "../relay/upstream.js";
import { supportBotUnavailable, supportBotUpstreamError } from "./errors.js";

export const SUPPORT_BOT_INVOKE_TIMEOUT_MS = 45_000;

export type SupportLlmMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: SupportOpenAiToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type SupportOpenAiTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
};

export type SupportOpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type SupportToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type SupportCompletion = {
  content: string;
  toolCalls: SupportToolCall[];
  stopReason: "stop" | "toolUse";
};

export type SupportBotTransport =
  | { kind: "override" }
  | { kind: "channel"; candidate: RelayCandidate };

export function hasSupportBotOverride(apiKey?: string): boolean {
  return Boolean(apiKey?.trim());
}

/** Join an OpenAI-compatible base with /chat/completions without doubling the path. */
export function joinChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

export function readAssistantContent(payload: unknown): string | null {
  const completion = parseSupportCompletion(payload);
  if (!completion) return null;
  return completion.content || null;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Tool arguments may be malformed; still expose the name.
  }
  return {};
}

export function parseSupportCompletion(payload: unknown): SupportCompletion | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = "choices" in payload ? payload.choices : undefined;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = "message" in first ? first.message : undefined;
  if (!message || typeof message !== "object") return null;

  const contentRaw = "content" in message ? message.content : undefined;
  const content = typeof contentRaw === "string" ? contentRaw.trim() : "";

  const toolCalls: SupportToolCall[] = [];
  const rawToolCalls = "tool_calls" in message ? message.tool_calls : undefined;
  if (Array.isArray(rawToolCalls)) {
    for (const [index, item] of rawToolCalls.entries()) {
      if (!item || typeof item !== "object") continue;
      const fn = "function" in item ? item.function : undefined;
      if (!fn || typeof fn !== "object") continue;
      const name = "name" in fn && typeof fn.name === "string" ? fn.name.trim() : "";
      if (!name) continue;
      const id =
        "id" in item && typeof item.id === "string" && item.id.trim()
          ? item.id
          : `call_${index + 1}`;
      const argsValue = "arguments" in fn ? fn.arguments : undefined;
      const args =
        argsValue && typeof argsValue === "object" && !Array.isArray(argsValue)
          ? (argsValue as Record<string, unknown>)
          : parseJsonObject(typeof argsValue === "string" ? argsValue : "{}");
      toolCalls.push({ id, name, arguments: args });
    }
  }

  const functionCall = "function_call" in message ? message.function_call : undefined;
  if (toolCalls.length === 0 && functionCall && typeof functionCall === "object") {
    const name =
      "name" in functionCall && typeof functionCall.name === "string"
        ? functionCall.name.trim()
        : "";
    if (name) {
      const argsRaw =
        "arguments" in functionCall && typeof functionCall.arguments === "string"
          ? functionCall.arguments
          : "{}";
      toolCalls.push({ id: "call_1", name, arguments: parseJsonObject(argsRaw) });
    }
  }

  if (!content && toolCalls.length === 0) return null;
  return {
    content,
    toolCalls,
    stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
  };
}

export function buildSupportLlmMessages(input: {
  system: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
}): SupportLlmMessage[] {
  const history = input.history.slice(-8);
  return [
    { role: "system", content: input.system },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: "user", content: input.userMessage },
  ];
}

function catalogIncludesModel(meta: unknown, model: string): boolean {
  const wanted = model.trim();
  if (!wanted) return false;
  const catalog = collectCatalogModels([meta]);
  const discovered = parseDiscoveredModels(meta);
  return (
    catalog.includes(wanted) ||
    discovered.includes(wanted) ||
    catalog.includes(toCatalogModelName(wanted))
  );
}

export async function resolvePlatformCandidate(
  model = env.SUPPORT_BOT_MODEL,
): Promise<RelayCandidate | null> {
  try {
    const rows = await db
      .select({
        credentialId: upstreamCredentials.id,
        credentialSuffix: upstreamCredentials.secretSuffix,
        secretEncrypted: upstreamCredentials.secretEncrypted,
        credentialPriority: upstreamCredentials.priority,
        credentialWeight: upstreamCredentials.weight,
        credentialStatus: upstreamCredentials.status,
        coolUntil: upstreamCredentials.coolUntil,
        meta: upstreamCredentials.meta,
        lastUsedAt: upstreamCredentials.lastUsedAt,
        productLineId: productLines.id,
        productType: productLines.productType,
        retryPolicy: productLines.retryPolicy,
        providerCode: providers.code,
        authStyle: providers.authStyle,
        supportedProtocols: upstreamCredentials.supportedProtocols,
        defaultBaseUrl: providers.defaultBaseUrl,
        baseUrlOverride: productLines.baseUrlOverride,
        protocolConfigs: productLines.protocolConfigs,
      })
      .from(upstreamCredentials)
      .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .where(
        and(
          eq(providers.status, "active"),
          eq(productLines.status, "active"),
          eq(upstreamCredentials.status, "active"),
          gt(upstreamCredentials.weight, 0),
        ),
      );

    const now = new Date();
    const matched = rows
      .filter((row) => {
        if (effectiveCredentialStatus(row.credentialStatus, row.coolUntil, now) !== "active") {
          return false;
        }
        const protocols = row.supportedProtocols ?? [];
        if (!protocols.includes("openai_chat")) return false;
        const upstream = resolveProtocolUpstreamConfig({
          protocol: "openai_chat",
          protocolConfigs: row.protocolConfigs,
          legacyBaseUrl: row.baseUrlOverride || row.defaultBaseUrl,
          legacyAuthStyle: row.authStyle,
        });
        return upstream != null && catalogIncludesModel(row.meta, model);
      })
      .sort((left, right) => {
        const byPriority = right.credentialPriority - left.credentialPriority;
        if (byPriority !== 0) return byPriority;
        const byWeight = right.credentialWeight - left.credentialWeight;
        if (byWeight !== 0) return byWeight;
        return (right.lastUsedAt?.getTime() ?? 0) - (left.lastUsedAt?.getTime() ?? 0);
      });

    const row = matched[0];
    if (!row) return null;

    const upstream = resolveProtocolUpstreamConfig({
      protocol: "openai_chat",
      protocolConfigs: row.protocolConfigs,
      legacyBaseUrl: row.baseUrlOverride || row.defaultBaseUrl,
      legacyAuthStyle: row.authStyle,
    });
    if (!upstream) return null;

    const [route] = await db
      .select({
        upstreamModel: modelRoutes.upstreamModel,
      })
      .from(modelRoutes)
      .where(
        and(
          eq(modelRoutes.clientModel, model),
          eq(modelRoutes.productLineId, row.productLineId),
          eq(modelRoutes.enabled, true),
        ),
      )
      .orderBy(desc(modelRoutes.priority))
      .limit(1);

    return {
      routeId: null,
      routePriority: 0,
      routeWeight: 100,
      clientModel: model,
      upstreamModel: route?.upstreamModel ?? model,
      providerCode: row.providerCode,
      authStyle: upstream.authStyle,
      supportedProtocols: row.supportedProtocols ?? ["openai_chat"],
      upstreamProtocol: "openai_chat",
      productLineId: row.productLineId,
      productType: row.productType,
      retryPolicy: row.retryPolicy,
      credentialId: row.credentialId,
      credentialSuffix: row.credentialSuffix,
      secretEncrypted: row.secretEncrypted,
      baseUrl: upstream.baseUrl,
      credentialPriority: row.credentialPriority,
      credentialWeight: row.credentialWeight,
    };
  } catch {
    return null;
  }
}

export async function resolveSupportBotTransport(): Promise<SupportBotTransport> {
  if (!env.SUPPORT_BOT_ENABLED) {
    throw supportBotUnavailable();
  }
  if (hasSupportBotOverride(env.SUPPORT_BOT_UPSTREAM_API_KEY)) {
    return { kind: "override" };
  }
  const candidate = await resolvePlatformCandidate();
  if (!candidate) {
    throw supportBotUnavailable();
  }
  return { kind: "channel", candidate };
}

function completionBody(
  messages: SupportLlmMessage[],
  tools: SupportOpenAiTool[] | undefined,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: env.SUPPORT_BOT_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: 800,
    stream: false,
    thinking: { type: "disabled" },
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  return body;
}

async function readCompletion(response: Response): Promise<SupportCompletion> {
  if (!response.ok) {
    throw supportBotUpstreamError();
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw supportBotUpstreamError();
  }
  const completion = parseSupportCompletion(payload);
  if (!completion) {
    throw supportBotUpstreamError();
  }
  return completion;
}

async function invokeOverrideCompletion(
  messages: SupportLlmMessage[],
  tools: SupportOpenAiTool[] | undefined,
  signal?: AbortSignal,
): Promise<SupportCompletion> {
  const apiKey = env.SUPPORT_BOT_UPSTREAM_API_KEY;
  if (!apiKey) {
    throw supportBotUnavailable();
  }
  const baseUrl = env.SUPPORT_BOT_UPSTREAM_BASE_URL;

  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    onAbort();
  } else {
    signal?.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), SUPPORT_BOT_INVOKE_TIMEOUT_MS);
  timer.unref?.();

  let response: Response;
  try {
    response = await fetch(joinChatCompletionsUrl(baseUrl), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "TokenHub/0.1 support-bot",
      },
      body: JSON.stringify(completionBody(messages, tools)),
      signal: controller.signal,
    });
  } catch {
    throw supportBotUpstreamError();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  return readCompletion(response);
}

async function invokeChannelCompletion(
  candidate: RelayCandidate,
  messages: SupportLlmMessage[],
  tools: SupportOpenAiTool[] | undefined,
  signal?: AbortSignal,
): Promise<SupportCompletion> {
  const attempt = await sendRelayUpstream({
    candidate,
    operation: "chat_completions",
    protocol: "openai_chat",
    body: completionBody(messages, tools),
    timeoutMs: SUPPORT_BOT_INVOKE_TIMEOUT_MS,
    signal,
  });

  try {
    if (attempt.kind !== "success" || !attempt.response) {
      throw supportBotUpstreamError();
    }
    return await readCompletion(attempt.response);
  } finally {
    attempt.cleanup();
  }
}

export async function invokeSupportBotCompletion(
  messages: SupportLlmMessage[],
  transport?: SupportBotTransport,
  tools?: SupportOpenAiTool[],
  signal?: AbortSignal,
): Promise<SupportCompletion> {
  const resolved = transport ?? (await resolveSupportBotTransport());
  if (resolved.kind === "override") {
    return invokeOverrideCompletion(messages, tools, signal);
  }
  return invokeChannelCompletion(resolved.candidate, messages, tools, signal);
}

export async function invokeSupportBot(
  messages: SupportLlmMessage[],
  transport?: SupportBotTransport,
): Promise<string> {
  const completion = await invokeSupportBotCompletion(messages, transport);
  if (!completion.content) {
    throw supportBotUpstreamError();
  }
  return completion.content;
}
