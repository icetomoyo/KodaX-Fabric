import {
  allocateProductCode,
  findChannelPlugin,
  findChannelVariant,
  resolveVariantProtocolConfigs,
} from "../channels/index.js";
import { RELAY_PROTOCOLS, type RelayProtocol } from "./relay/protocol.js";
import { configurableSupportedProtocolsSchema } from "./upstream-channel-update.js";
import type { ProductLineProtocolConfigs } from "./upstream-protocol-config.js";

export const CHANNEL_TAG_MAX_LENGTH = 32;

export function normalizeChannelTag(value: unknown): string | null {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  const tag = value.trim();
  if (tag.length > CHANNEL_TAG_MAX_LENGTH) return null;
  return tag;
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
    variantCode: string;
    testModel: string | null;
    allocateCode: () => string;
  }
  | { kind: "name_required" }
  | { kind: "protocols_required" }
  | { kind: "seat_count_invalid" }
  | { kind: "tag_invalid" }
  | { kind: "test_model_invalid" }
  | { kind: "provider_unsupported" }
  | { kind: "protocol_unsupported"; unsupportedProtocols: RelayProtocol[] };

export const CHANNEL_TEST_MODEL_MAX_LENGTH = 128;

/** 解析可选的渠道测试模型：空/缺省 → null（走 discoveredModels / 内置默认兜底）。 */
export function normalizeChannelTestModel(value: unknown): string | null | "invalid" {
  if (value == null) return null;
  if (typeof value !== "string") return "invalid";
  const model = value.trim();
  if (!model) return null;
  if (model.length > CHANNEL_TEST_MODEL_MAX_LENGTH) return "invalid";
  return model;
}

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
  const testModel = normalizeChannelTestModel(body.testModel);
  if (testModel === "invalid") return { kind: "test_model_invalid" };
  const protocolsParsed = configurableSupportedProtocolsSchema.safeParse(body.supportedProtocols);
  if (!protocolsParsed.success) return { kind: "protocols_required" };
  const protocols = RELAY_PROTOCOLS.filter((protocol) => protocolsParsed.data.includes(protocol));

  const plugin = findChannelPlugin(typeof body.provider === "string" ? body.provider : "");
  if (!plugin) return { kind: "provider_unsupported" };
  const variant = findChannelVariant(plugin, body.variant);
  if (!variant) return { kind: "provider_unsupported" };
  const resolution = resolveVariantProtocolConfigs(variant, protocols);
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
    productType: plugin.productType,
    providerCode: plugin.code,
    providerName: plugin.meta.company,
    variantCode: variant.code,
    testModel,
    allocateCode: () => allocateProductCode(variant),
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
    case "test_model_invalid":
      return { status: 400, message: "测试模型最多 128 个字符" };
    case "provider_unsupported":
      return { status: 400, message: "目前只支持智谱、DeepSeek 或火山方舟" };
    case "protocol_unsupported":
      return { status: 400, message: "所选协议不受该供应商支持" };
  }
}
