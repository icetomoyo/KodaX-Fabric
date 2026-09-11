import { randomBytes } from "node:crypto";
import { resolveCustomProtocolConfigs } from "./custom-channel.js";
import {
  HAIZHI_PROVIDER_CODE,
  HAIZHI_PROVIDER_NAME,
  getProviderTemplate,
  resolveTemplateProtocolConfigs,
} from "./provider-templates.js";
import { RELAY_PROTOCOLS, type RelayProtocol } from "./relay/protocol.js";
import { configurableSupportedProtocolsSchema } from "./upstream-channel-update.js";
import type { ProductLineProtocolConfigs } from "./upstream-protocol-config.js";

export const CHANNEL_CREATE_PROVIDERS = ["glm", "haizhi"] as const;
export type ChannelCreateProvider = (typeof CHANNEL_CREATE_PROVIDERS)[number];
export const CHANNEL_CREATE_VARIANTS = ["domestic", "international"] as const;
export type ChannelCreateVariant = (typeof CHANNEL_CREATE_VARIANTS)[number];
export const CHANNEL_TAG_MAX_LENGTH = 32;

export function normalizeChannelTag(value: unknown): string | null {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  const tag = value.trim();
  if (tag.length > CHANNEL_TAG_MAX_LENGTH) return null;
  return tag;
}

export function allocateDomesticProductLineCode(): string {
  return `cn_${randomBytes(8).toString("hex")}`;
}

export function allocateHaizhiProductLineCode(): string {
  return `hz_${randomBytes(8).toString("hex")}`;
}

export function allocateInternationalProductLineCode(): string {
  return `in_${randomBytes(8).toString("hex")}`;
}

export type UpstreamChannelCreatePlan =
  | {
    kind: "accepted";
    name: string;
    tag: string;
    seatCount: number;
    status: "active" | "disabled";
    protocols: RelayProtocol[];
    protocolConfigs: ProductLineProtocolConfigs;
    productType: "api" | "coding_plan";
    providerCode: string;
    providerName: string;
    allocateCode: () => string;
  }
  | { kind: "name_required" }
  | { kind: "protocols_required" }
  | { kind: "seat_count_invalid" }
  | { kind: "tag_invalid" }
  | { kind: "provider_unsupported" }
  | { kind: "custom_configs_required" }
  | { kind: "protocol_unsupported"; unsupportedProtocols: RelayProtocol[] };

export function planUpstreamChannelCreate(input: unknown): UpstreamChannelCreatePlan {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return { kind: "name_required" };
  const tag = normalizeChannelTag(body.tag);
  if (tag == null) return { kind: "tag_invalid" };
  const seatCount = body.seatCount;
  if (
    typeof seatCount !== "number"
    || !Number.isInteger(seatCount)
    || seatCount < 0
    || seatCount > 100_000
  ) {
    return { kind: "seat_count_invalid" };
  }
  const status = body.status === "disabled" ? "disabled" : "active";
  const protocolsParsed = configurableSupportedProtocolsSchema.safeParse(body.supportedProtocols);
  if (!protocolsParsed.success) return { kind: "protocols_required" };
  const protocols = RELAY_PROTOCOLS.filter((protocol) => protocolsParsed.data.includes(protocol));

  if (body.provider === "haizhi") {
    const resolution = resolveCustomProtocolConfigs(body.protocolConfigs, protocols);
    if (!resolution.ok) return { kind: "custom_configs_required" };
    return {
      kind: "accepted",
      name,
      tag,
      seatCount,
      status,
      protocols,
      protocolConfigs: resolution.configs,
      productType: "api",
      providerCode: HAIZHI_PROVIDER_CODE,
      providerName: HAIZHI_PROVIDER_NAME,
      allocateCode: allocateHaizhiProductLineCode,
    };
  }

  if (body.provider !== "glm") return { kind: "provider_unsupported" };
  if (body.variant !== "domestic" && body.variant !== "international") {
    return { kind: "provider_unsupported" };
  }

  const template = getProviderTemplate("glm");
  const line = body.variant === "international"
    ? template?.baseUrls.find((option) => option.productLineCode === "api_intl") ?? template?.baseUrls[1]
    : template?.baseUrls[0];
  if (!template || !line) return { kind: "provider_unsupported" };
  const resolution = resolveTemplateProtocolConfigs(template, line.productLineCode, protocols);
  if (!resolution.ok) {
    return {
      kind: "protocol_unsupported",
      unsupportedProtocols: resolution.unsupportedProtocols,
    };
  }
  return {
    kind: "accepted",
    name,
    tag,
    seatCount,
    status,
    protocols,
    protocolConfigs: resolution.configs,
    productType: line.productType,
    providerCode: template.code,
    providerName: template.name,
    allocateCode: body.variant === "international"
      ? allocateInternationalProductLineCode
      : allocateDomesticProductLineCode,
  };
}

export function channelCreateError(kind: Exclude<UpstreamChannelCreatePlan["kind"], "accepted">): {
  status: number;
  message: string;
} {
  switch (kind) {
    case "name_required":
      return { status: 400, message: "请填写渠道名称" };
    case "protocols_required":
      return { status: 400, message: "请选择 API 协议" };
    case "seat_count_invalid":
      return { status: 400, message: "请填写席位数量" };
    case "tag_invalid":
      return { status: 400, message: "渠道标签最多 32 个字符" };
    case "provider_unsupported":
      return { status: 400, message: "目前只支持智谱或海致集团" };
    case "custom_configs_required":
      return { status: 400, message: "请填写上游地址" };
    case "protocol_unsupported":
      return { status: 400, message: "所选协议不受该供应商支持" };
  }
}
