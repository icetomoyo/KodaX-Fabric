import { and, eq } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  modelRoutes,
  productLines,
  providers,
} from "../../db/schema/index.js";
import { findChannelPlugin } from "../../channels/index.js";
import {
  type CredentialLoad,
  type CredentialLoadReader,
  EMPTY_CREDENTIAL_LOAD,
  getCredentialLoad,
} from "./credential-load.js";
import {
  loadRelayPool,
  loadRelayPoolByProviderCode,
} from "./channel-pool.js";
import { parseClientModel } from "./client-model.js";
import {
  acquireBoundCredential,
  type BoundCredential,
} from "./binding.js";
import type { RelayProtocol } from "./protocol.js";
import type {
  RelayCandidate,
} from "./types.js";
import { isValidRelayProductLineId } from "./types.js";
import { acquireTidalCredential, type TidalRequest } from "./tidal-pool.js";
import { RELAY_KEY_BUSY_RETRY_AFTER_SECONDS } from "./upstream.js";
import {
  providerBlocksClientModel,
} from "../discovered-models.js";

export type AvailableRelayCredential = {
  credentialId: number;
  credentialSuffix: string;
  secretEncrypted: string;
  credentialPriority: number;
  credentialWeight: number;
  credentialStatus: "active" | "disabled" | "auto_disabled" | "cooling";
  coolUntil: Date | null;
  meta: unknown;
  productLineId: number;
  productType: "api" | "coding_plan";
  retryPolicy: unknown;
  providerCode: string;
  authStyle: string;
  supportedProtocols: RelayProtocol[];
  baseUrl: string;
  fiveHourWindowAnchor?: Date | null;
  weeklyWindowResetAt?: Date | null;
};

export type AvailableRelayModelRoute = {
  routeId: number;
  productLineId: number;
  upstreamModel: string;
  routePriority: number;
  routeWeight: number;
};

export type RelayCandidateResolution = {
  candidates: RelayCandidate[];
  unavailableReason:
    | "bound_channel_unavailable"
    | "cooling"
    /** Every Key the employee could use is at its concurrency limit. */
    | "busy"
    /** This employee already has RELAY_EMPLOYEE_MAX_CONCURRENCY in flight across all Keys. */
    | "member_busy"
    | "unavailable"
    | "model_not_allowed"
    | null;
  retryAfterSeconds: number | null;
};

export type RelayBoundCandidateResolution = {
  candidate: RelayCandidate | null;
  unavailableReason: RelayCandidateResolution["unavailableReason"];
  retryAfterSeconds: number | null;
  /**
   * Tidal only: the candidate Key's concurrency slot is already taken. Hand it
   * to `sendRelayUpstream`, which releases it when the attempt ends.
   */
  heldSlot?: (() => void) | null;
};

/** Defense-in-depth: scope raw snapshots before routing or ranking. */
export function filterRelayItemsToProductLine<T extends { productLineId: number }>(
  items: readonly T[],
  productLineId: number,
): T[] {
  if (!isValidRelayProductLineId(productLineId)) return [];
  return filterRelayItemsToProductLines(items, new Set([productLineId]));
}

export function filterRelayItemsToProductLines<T extends { productLineId: number }>(
  items: readonly T[],
  productLineIds: ReadonlySet<number>,
): T[] {
  if (productLineIds.size === 0) return [];
  return items.filter((item) => productLineIds.has(item.productLineId));
}

export function credentialSupportsProtocol(
  credential: { supportedProtocols?: readonly RelayProtocol[] | null },
  protocol: RelayProtocol,
): boolean {
  return credential.supportedProtocols?.includes(protocol) ?? false;
}

function retryAfterSecondsFrom(retryAt: Date | null): number | null {
  if (!retryAt) return null;
  const seconds = Math.ceil((retryAt.getTime() - Date.now()) / 1_000);
  return seconds > 0 ? seconds : null;
}

function mapAcquireFailure(
  reason: "no_scope" | "exhausted_pool" | "pool_busy" | "member_busy" | "no_binding_available",
  retryAt: Date | null,
): Pick<RelayBoundCandidateResolution, "unavailableReason" | "retryAfterSeconds"> {
  if (reason === "member_busy") {
    return { unavailableReason: "member_busy", retryAfterSeconds: RELAY_KEY_BUSY_RETRY_AFTER_SECONDS };
  }
  if (reason === "pool_busy") {
    return { unavailableReason: "busy", retryAfterSeconds: RELAY_KEY_BUSY_RETRY_AFTER_SECONDS };
  }
  if (reason === "exhausted_pool") {
    return { unavailableReason: "cooling", retryAfterSeconds: retryAfterSecondsFrom(retryAt) };
  }
  return { unavailableReason: "unavailable", retryAfterSeconds: null };
}

/**
 * Snapshot-equivalent model-route pick: explicit positive-weight routes win
 * by priority then weight; no routes means transparent clientModel passthrough;
 * only zero-weight routes suppress fallback.
 */
function pickModelRoute(
  rawRoutes: readonly AvailableRelayModelRoute[],
  productLineId: number,
):
  | { kind: "transparent" }
  | { kind: "routed"; route: AvailableRelayModelRoute }
  | { kind: "suppressed" } {
  const routes = filterRelayItemsToProductLine(rawRoutes, productLineId);
  if (routes.length === 0) return { kind: "transparent" };
  const positive = routes.filter((route) => route.routeWeight > 0);
  if (positive.length === 0) return { kind: "suppressed" };
  let best = positive[0];
  for (const route of positive) {
    if (
      route.routePriority > best.routePriority ||
      (route.routePriority === best.routePriority && route.routeWeight > best.routeWeight)
    ) {
      best = route;
    }
  }
  return { kind: "routed", route: best };
}

function candidateRank(candidate: RelayCandidate): [number, number] {
  return [candidate.routePriority, candidate.credentialPriority];
}

function compareRank(a: RelayCandidate, b: RelayCandidate): number {
  const [aRoute, aCredential] = candidateRank(a);
  const [bRoute, bCredential] = candidateRank(b);
  return bRoute - aRoute || bCredential - aCredential;
}

function shuffle(
  candidates: RelayCandidate[],
  random: () => number,
): RelayCandidate[] {
  const items = [...candidates];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Least-loaded ordering inside one priority group: fewest in-flight requests
 * first, then fewest observed tokens (official limits are token budgets),
 * then fewest request counts, then higher combined weight, and finally
 * random via the pre-shuffle plus stable sort.
 */
function leastLoadedOrder(
  group: RelayCandidate[],
  random: () => number,
  loadOf: CredentialLoadReader,
): RelayCandidate[] {
  const loads = new Map<number, CredentialLoad>();
  for (const candidate of group) {
    if (!loads.has(candidate.credentialId)) {
      loads.set(candidate.credentialId, loadOf(candidate.credentialId));
    }
  }
  const loadFor = (candidate: RelayCandidate): CredentialLoad =>
    loads.get(candidate.credentialId) ?? EMPTY_CREDENTIAL_LOAD;
  return shuffle(group, random).sort((a, b) => {
    const la = loadFor(a);
    const lb = loadFor(b);
    return (
      la.inFlight - lb.inFlight ||
      la.totalTokens - lb.totalTokens ||
      la.totalUses - lb.totalUses ||
      b.routeWeight * b.credentialWeight - a.routeWeight * a.credentialWeight
    );
  });
}

export function orderRelayCandidates(
  candidates: RelayCandidate[],
  random: () => number = Math.random,
  loadOf: CredentialLoadReader = getCredentialLoad,
): RelayCandidate[] {
  const ranked = candidates
    .filter(
      (candidate) =>
        Number.isFinite(candidate.routeWeight) &&
        Number.isFinite(candidate.credentialWeight) &&
        candidate.routeWeight > 0 &&
        candidate.credentialWeight > 0,
    )
    .sort(compareRank);
  const ordered: RelayCandidate[] = [];
  const selectedCredentialIds = new Set<number>();
  while (ranked.length) {
    const first = ranked[0];
    const group = ranked.filter(
      (candidate) =>
        candidate.routePriority === first.routePriority &&
        candidate.credentialPriority === first.credentialPriority,
    );
    for (const candidate of leastLoadedOrder(group, random, loadOf)) {
      // A request must not retry the same credential. Deduplicate only after
      // ordering equal-priority routes so duplicate mappings do not make the
      // database's unspecified row order decide the upstream model.
      if (selectedCredentialIds.has(candidate.credentialId)) continue;
      selectedCredentialIds.add(candidate.credentialId);
      ordered.push(candidate);
    }
    ranked.splice(0, group.length);
  }
  return ordered;
}

type CandidateCredentialSource = Pick<
  AvailableRelayCredential,
  | "providerCode"
  | "authStyle"
  | "supportedProtocols"
  | "productLineId"
  | "productType"
  | "retryPolicy"
  | "credentialId"
  | "credentialSuffix"
  | "secretEncrypted"
  | "baseUrl"
  | "credentialPriority"
  | "credentialWeight"
  | "meta"
> & {
  fiveHourCreditLimit?: number | null;
  weeklyCreditLimit?: number | null;
  monthlyCreditLimit?: number | null;
  fiveHourWindowAnchor?: Date | null;
  fiveHourWindowBaseCredits?: number | null;
  weeklyWindowResetAt?: Date | null;
  monthlyWindowResetAt?: Date | null;
};

function toRelayCandidate(
  credential: CandidateCredentialSource,
  clientModel: string,
  upstreamProtocol: RelayProtocol,
  route?: AvailableRelayModelRoute,
): RelayCandidate {
  return {
    routeId: route?.routeId ?? null,
    routePriority: route?.routePriority ?? 0,
    routeWeight: route?.routeWeight ?? 100,
    clientModel,
    upstreamModel: route?.upstreamModel ?? clientModel,
    providerCode: credential.providerCode,
    authStyle: credential.authStyle,
    supportedProtocols: credential.supportedProtocols,
    upstreamProtocol,
    productLineId: credential.productLineId,
    productType: credential.productType,
    retryPolicy: credential.retryPolicy,
    credentialId: credential.credentialId,
    credentialSuffix: credential.credentialSuffix,
    secretEncrypted: credential.secretEncrypted,
    baseUrl: credential.baseUrl,
    credentialPriority: credential.credentialPriority,
    credentialWeight: credential.credentialWeight,
    meta: credential.meta,
    fiveHourCreditLimit: credential.fiveHourCreditLimit ?? null,
    weeklyCreditLimit: credential.weeklyCreditLimit ?? null,
    fiveHourWindowAnchor: credential.fiveHourWindowAnchor ?? null,
    fiveHourWindowBaseCredits: credential.fiveHourWindowBaseCredits ?? null,
    weeklyWindowResetAt: credential.weeklyWindowResetAt ?? null,
    monthlyCreditLimit: credential.monthlyCreditLimit ?? null,
    monthlyWindowResetAt: credential.monthlyWindowResetAt ?? null,
  };
}

/**
 * Pure routing core used by both production queries and focused tests. Raw
 * rows are scoped to the Key product line before explicit-route detection,
 * transparent fallback, candidate construction, weighting, and error
 * classification.
 */
async function loadEnabledModelRoutes(
  productLineId: number,
  clientModel?: string,
): Promise<AvailableRelayModelRoute[]> {
  return db
    .select({
      routeId: modelRoutes.id,
      productLineId: modelRoutes.productLineId,
      upstreamModel: modelRoutes.upstreamModel,
      routePriority: modelRoutes.priority,
      routeWeight: modelRoutes.weight,
    })
    .from(modelRoutes)
    .innerJoin(productLines, eq(modelRoutes.productLineId, productLines.id))
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .where(
      and(
        eq(modelRoutes.enabled, true),
        eq(productLines.status, "active"),
        eq(providers.status, "active"),
        eq(modelRoutes.productLineId, productLineId),
        clientModel === undefined ? undefined : eq(modelRoutes.clientModel, clientModel),
      ),
    );
}

/**
 * Resolve the client model onto one bound Key. Snapshot routing supplies the
 * upstream model / route weights; acquireBoundCredential supplies the Key.
 */
export async function resolveRelayBoundCandidate(
  employeeId: number,
  clientModel: string,
  protocol: RelayProtocol,
  productLineId: number,
  excludeCredentialIds?: ReadonlySet<number>,
  /** Set when the request came in on a tidal Key. */
  tidal?: TidalRequest | null,
): Promise<RelayBoundCandidateResolution> {
  const parsed = parseClientModel(clientModel);
  const upstreamModel = parsed.upstreamModel;
  const pool = parsed.kind === "legacy"
    ? await loadRelayPool(productLineId)
    : await loadRelayPoolByProviderCode(parsed.providerCode);
  if (!pool || pool.activeProductLineIds.length === 0) {
    return {
      candidate: null,
      unavailableReason: parsed.kind === "legacy" ? "bound_channel_unavailable" : "model_not_allowed",
      retryAfterSeconds: null,
    };
  }
  // Plugin channels only accept `channel/model`.
  const unprefixedOnPlugin = parsed.kind === "legacy" && findChannelPlugin(pool.providerCode) != null;
  if (unprefixedOnPlugin || providerBlocksClientModel(pool.providerCode, upstreamModel)) {
    return {
      candidate: null,
      unavailableReason: "model_not_allowed",
      retryAfterSeconds: null,
    };
  }

  // 潮汐KEY 不走绑定：每次请求从池里挑一把闲置的 Key 并直接占住并发位。
  if (tidal) {
    const acquired = await acquireTidalCredential({
      employeeId,
      pool,
      protocol,
      tidal,
      excludeCredentialIds,
    });
    if (!acquired.ok) {
      return { candidate: null, ...mapAcquireFailure(acquired.reason, null) };
    }
    let handedOff = false;
    try {
      const resolved = await candidateForCredential(
        acquired.credential,
        clientModel,
        upstreamModel,
        protocol,
      );
      if (!resolved.candidate) return resolved;
      resolved.candidate.maxConcurrency = acquired.credential.keyMaxConcurrency;
      handedOff = true;
      return { ...resolved, heldSlot: acquired.release };
    } finally {
      if (!handedOff) acquired.release();
    }
  }

  const acquired = await acquireBoundCredential({
    employeeId,
    productLineId,
    protocol,
    pool,
    excludeCredentialIds,
  });
  if (!acquired.ok) {
    return { candidate: null, ...mapAcquireFailure(acquired.reason, acquired.retryAt) };
  }

  const resolved = await candidateForCredential(
    acquired.credential,
    clientModel,
    upstreamModel,
    protocol,
  );
  if (resolved.candidate) {
    resolved.candidate.maxConcurrency = acquired.credential.keyMaxConcurrency;
    resolved.candidate.maxEmployeeConcurrency = env.RELAY_EMPLOYEE_MAX_CONCURRENCY;
  }
  return resolved;
}

/** Map the client model onto the acquired Key through its package's model routes. */
async function candidateForCredential(
  bound: BoundCredential,
  clientModel: string,
  upstreamModel: string,
  protocol: RelayProtocol,
): Promise<RelayBoundCandidateResolution> {
  if (!credentialSupportsProtocol(bound, protocol)) {
    return { candidate: null, ...mapAcquireFailure("no_binding_available", null) };
  }

  const routes = await loadEnabledModelRoutes(bound.productLineId, upstreamModel);
  const modelRoute = pickModelRoute(routes, bound.productLineId);
  if (modelRoute.kind === "suppressed") {
    return {
      candidate: null,
      unavailableReason: "unavailable",
      retryAfterSeconds: null,
    };
  }
  const route = modelRoute.kind === "routed" ? modelRoute.route : undefined;
  const candidate = toRelayCandidate(bound, clientModel, protocol, route);
  candidate.upstreamModel = route?.upstreamModel ?? upstreamModel;

  return {
    candidate,
    unavailableReason: null,
    retryAfterSeconds: null,
  };
}
