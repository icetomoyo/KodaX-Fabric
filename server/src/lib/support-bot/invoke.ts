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
  role: "system" | "user" | "assistant";
  content: string;
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
  if (!payload || typeof payload !== "object") return null;
  const choices = "choices" in payload ? payload.choices : undefined;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = "message" in first ? first.message : undefined;
  if (!message || typeof message !== "object") return null;
  const content = "content" in message ? message.content : undefined;
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
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

async function invokeOverride(messages: SupportLlmMessage[]): Promise<string> {
  const apiKey = env.SUPPORT_BOT_UPSTREAM_API_KEY;
  if (!apiKey) {
    throw supportBotUnavailable();
  }
  const baseUrl = env.SUPPORT_BOT_UPSTREAM_BASE_URL;

  const controller = new AbortController();
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
      body: JSON.stringify({
        model: env.SUPPORT_BOT_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });
  } catch {
    throw supportBotUpstreamError();
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw supportBotUpstreamError();
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw supportBotUpstreamError();
  }

  const content = readAssistantContent(payload);
  if (!content) {
    throw supportBotUpstreamError();
  }
  return content;
}

async function invokeChannel(
  candidate: RelayCandidate,
  messages: SupportLlmMessage[],
): Promise<string> {
  const attempt = await sendRelayUpstream({
    candidate,
    operation: "chat_completions",
    protocol: "openai_chat",
    body: {
      messages,
      temperature: 0.2,
      max_tokens: 1500,
      stream: false,
    },
    timeoutMs: SUPPORT_BOT_INVOKE_TIMEOUT_MS,
  });

  try {
    if (attempt.kind !== "success" || !attempt.response) {
      throw supportBotUpstreamError();
    }
    let payload: unknown;
    try {
      payload = await attempt.response.json();
    } catch {
      throw supportBotUpstreamError();
    }
    const content = readAssistantContent(payload);
    if (!content) {
      throw supportBotUpstreamError();
    }
    return content;
  } finally {
    attempt.cleanup();
  }
}

export async function invokeSupportBot(
  messages: SupportLlmMessage[],
  transport?: SupportBotTransport,
): Promise<string> {
  const resolved = transport ?? (await resolveSupportBotTransport());
  if (resolved.kind === "override") {
    return invokeOverride(messages);
  }
  return invokeChannel(resolved.candidate, messages);
}
