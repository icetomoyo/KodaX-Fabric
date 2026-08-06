import { z } from "zod";
import {
  RELAY_PROTOCOLS,
  type RelayProtocol,
} from "./relay/protocol.js";

export const configurableSupportedProtocolsSchema = z
  .array(z.enum(RELAY_PROTOCOLS))
  .min(1, "至少选择一个支持协议")
  .max(RELAY_PROTOCOLS.length)
  .refine((protocols) => new Set(protocols).size === protocols.length, {
    message: "支持协议不能重复",
  });

export const upstreamChannelUpdateSchema = z
  .object({
    expectedConfigVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(100).optional(),
    status: z.enum(["active", "disabled"]).optional(),
    supportedProtocols: configurableSupportedProtocolsSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== "expectedConfigVersion"), {
    message: "至少提供一个要修改的字段",
  });

export type UpstreamChannelUpdate = z.infer<typeof upstreamChannelUpdateSchema>;

export type ChannelCredentialProtocolState = {
  supportedProtocols: readonly RelayProtocol[] | null;
};

/** Template defaults name a new channel but never replace an administrator edit. */
export function resolveTemplateChannelName(
  existingName: string | null | undefined,
  templateName: string,
): string {
  return existingName ?? templateName;
}

export type ChannelProtocolUpdatePlan = {
  currentProtocols: RelayProtocol[];
  nextProtocols: RelayProtocol[];
  removedProtocols: RelayProtocol[];
  protocolsChanged: boolean;
};

export type ChannelCredentialInsertProtocolResolution =
  | { kind: "accepted"; protocols: RelayProtocol[] }
  | { kind: "mismatch"; channelProtocols: RelayProtocol[] }
  | { kind: "unset" };

function normalizedProtocolSet(
  protocols: readonly RelayProtocol[] | null | undefined,
): RelayProtocol[] {
  const configured = new Set(protocols ?? []);
  return RELAY_PROTOCOLS.filter((protocol) => configured.has(protocol));
}

function protocolSetsEqual(
  left: readonly RelayProtocol[] | null | undefined,
  right: readonly RelayProtocol[] | null | undefined,
): boolean {
  const normalizedLeft = normalizedProtocolSet(left);
  const normalizedRight = normalizedProtocolSet(right);
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((protocol, index) => protocol === normalizedRight[index]);
}

/**
 * Derive channel-level protocol changes from both the channel configuration
 * and every credential. `protocolConfigs` remains the source of truth for new
 * credential inheritance, but the union here is deliberately broader: an
 * administrator must see (and be blocked by) active API keys for a protocol
 * that only survives in a drifted historical credential before an edit
 * removes that protocol.
 */
export function planChannelProtocolUpdate(
  credentials: readonly ChannelCredentialProtocolState[],
  requestedProtocols?: readonly RelayProtocol[],
  storedChannelProtocols: readonly RelayProtocol[] = [],
): ChannelProtocolUpdatePlan {
  const currentSet = new Set<RelayProtocol>(normalizedProtocolSet(storedChannelProtocols));
  for (const credential of credentials) {
    for (const protocol of normalizedProtocolSet(credential.supportedProtocols)) {
      currentSet.add(protocol);
    }
  }
  const currentProtocols = RELAY_PROTOCOLS.filter((protocol) => currentSet.has(protocol));
  const nextProtocols = requestedProtocols === undefined
    ? currentProtocols
    : normalizedProtocolSet(requestedProtocols);

  return {
    currentProtocols,
    nextProtocols,
    removedProtocols: currentProtocols.filter((protocol) => !nextProtocols.includes(protocol)),
    protocolsChanged: requestedProtocols !== undefined &&
      (!protocolSetsEqual(currentProtocols, nextProtocols) ||
        credentials.some((credential) =>
          !protocolSetsEqual(credential.supportedProtocols, nextProtocols)
        )),
  };
}

/**
 * Existing channels own their protocol set. A credential request created from
 * stale UI state must fail after it obtains the channel lock instead of
 * re-introducing per-credential protocol drift. An empty/new channel adopts
 * the validated request set.
 */
export function resolveChannelCredentialInsertProtocols(
  credentials: readonly ChannelCredentialProtocolState[],
  requestedProtocols?: readonly RelayProtocol[],
  storedChannelProtocols: readonly RelayProtocol[] = [],
): ChannelCredentialInsertProtocolResolution {
  const requested = requestedProtocols === undefined
    ? undefined
    : normalizedProtocolSet(requestedProtocols);
  const storedProtocols = normalizedProtocolSet(storedChannelProtocols);
  const channelProtocols = storedProtocols.length > 0
    ? storedProtocols
    : planChannelProtocolUpdate(credentials).currentProtocols;
  if (channelProtocols.length === 0) {
    return requested === undefined
      ? { kind: "unset" }
      : { kind: "accepted", protocols: requested };
  }
  if (requested === undefined) {
    return { kind: "accepted", protocols: channelProtocols };
  }
  return protocolSetsEqual(channelProtocols, requested)
    ? { kind: "accepted", protocols: channelProtocols }
    : { kind: "mismatch", channelProtocols };
}

export type ProtocolUsage = {
  protocol: RelayProtocol;
  activeKeyCount: number;
};

export function collectRemovedProtocolUsage(
  bindings: readonly { protocol: RelayProtocol }[],
  removedProtocols: readonly RelayProtocol[],
): ProtocolUsage[] {
  const removed = new Set(removedProtocols);
  const counts = new Map<RelayProtocol, number>();
  for (const binding of bindings) {
    if (!removed.has(binding.protocol)) continue;
    counts.set(binding.protocol, (counts.get(binding.protocol) ?? 0) + 1);
  }
  return RELAY_PROTOCOLS
    .filter((protocol) => counts.has(protocol))
    .map((protocol) => ({ protocol, activeKeyCount: counts.get(protocol) ?? 0 }));
}
