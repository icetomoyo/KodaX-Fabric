import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  modelRoutes,
  productLines,
  providers,
  upstreamCredentials,
} from "../../db/schema/index.js";
import { effectiveCredentialStatus } from "../credential-status.js";
import {
  type CredentialLoad,
  type CredentialLoadReader,
  EMPTY_CREDENTIAL_LOAD,
  getCredentialLoad,
} from "./credential-load.js";
import { resolveProtocolUpstreamConfig } from "../upstream-protocol-config.js";
import {
  acquireBoundCredential,
  type BoundCredential,
} from "./binding.js";
import type { RelayProtocol } from "./protocol.js";
import type {
  RelayCandidate,
} from "./types.js";
import { isValidRelayProductLineId } from "./types.js";
import {
  glmProviderBlocksClientModel,
  isGlmClientModelAllowed,
  isGlmProvider,
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
    | "unavailable"
    | "model_not_allowed"
    | null;
  retryAfterSeconds: number | null;
};

export type RelayModelListResolution = {
  models: Array<{ id: string; ownedBy: string }>;
  unavailableReason: "bound_channel_unavailable" | null;
};

export type RelayBoundCandidateResolution = {
  candidate: RelayCandidate | null;
  unavailableReason: RelayCandidateResolution["unavailableReason"];
  retryAfterSeconds: number | null;
};

/** Defense-in-depth: scope raw snapshots before routing or ranking. */
export function filterRelayItemsToProductLine<T extends { productLineId: number }>(
  items: readonly T[],
  productLineId: number,
): T[] {
  if (!isValidRelayProductLineId(productLineId)) return [];
  return items.filter((item) => item.productLineId === productLineId);
}

function discoveredModels(meta: unknown): string[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const object = meta as Record<string, unknown>;
  const direct = object.discoveredModels;
  if (Array.isArray(direct)) {
    return direct.filter((item): item is string => typeof item === "string");
  }
  const lastTest = object.lastTest;
  if (lastTest && typeof lastTest === "object" && !Array.isArray(lastTest)) {
    const models = (lastTest as Record<string, unknown>).models;
    if (Array.isArray(models)) {
      return models.filter((item): item is string => typeof item === "string");
    }
  }
  return [];
}

export function credentialSupportsProtocol(
  credential: { supportedProtocols?: readonly RelayProtocol[] | null },
  protocol: RelayProtocol,
): boolean {
  return credential.supportedProtocols?.includes(protocol) ?? false;
}

type RelayCredentialAccess = {
  credentials: AvailableRelayCredential[];
  boundChannelUnavailable: boolean;
  providerCode: string | null;
};

async function loadAccessibleCredentials(
  protocol: RelayProtocol,
  productLineId: number,
  options: { readOnly?: boolean } = {},
): Promise<RelayCredentialAccess> {
  const now = new Date();
  if (!isValidRelayProductLineId(productLineId)) {
    return { credentials: [], boundChannelUnavailable: true, providerCode: null };
  }
  // Cooling is a temporary state. Restore expired entries in persistent state
  // so admin views and subsequent scheduling agree that the credential is
  // active again. Model discovery is strictly read-only and instead applies
  // the same effective-status function to its query result in memory.
  if (!options.readOnly) {
    await db
      .update(upstreamCredentials)
      .set({ status: "active", coolUntil: null, updatedAt: now })
      .where(
        and(
          eq(upstreamCredentials.status, "cooling"),
          or(isNull(upstreamCredentials.coolUntil), lte(upstreamCredentials.coolUntil, now)),
          eq(upstreamCredentials.productLineId, productLineId),
        ),
      );
  }

  const [rows, boundChannel] = await Promise.all([
    db
      .select({
        credentialId: upstreamCredentials.id,
        credentialSuffix: upstreamCredentials.secretSuffix,
        secretEncrypted: upstreamCredentials.secretEncrypted,
        credentialPriority: upstreamCredentials.priority,
        credentialWeight: upstreamCredentials.weight,
        credentialStatus: upstreamCredentials.status,
        coolUntil: upstreamCredentials.coolUntil,
        meta: upstreamCredentials.meta,
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
      .where(eq(upstreamCredentials.productLineId, productLineId)),
    db
      .select({
        productLineId: productLines.id,
        productLineStatus: productLines.status,
        providerStatus: providers.status,
        providerCode: providers.code,
      })
      .from(productLines)
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .where(eq(productLines.id, productLineId))
      .limit(1)
      .then((result) => result[0] ?? null),
  ]);

  const unavailable = !boundChannel ||
    boundChannel.productLineStatus !== "active" ||
    boundChannel.providerStatus !== "active";
  if (unavailable) {
    return {
      credentials: [],
      boundChannelUnavailable: true,
      providerCode: boundChannel?.providerCode ?? null,
    };
  }

  const credentials = rows
    .filter((row) => credentialSupportsProtocol(row, protocol))
    .map((row): AvailableRelayCredential | null => {
      const upstreamConfig = resolveProtocolUpstreamConfig({
        protocol,
        protocolConfigs: row.protocolConfigs,
        legacyBaseUrl: row.baseUrlOverride || row.defaultBaseUrl,
        legacyAuthStyle: row.authStyle,
      });
      if (!upstreamConfig) return null;
      return {
        credentialId: row.credentialId,
        credentialSuffix: row.credentialSuffix,
        secretEncrypted: row.secretEncrypted,
        credentialPriority: row.credentialPriority,
        credentialWeight: row.credentialWeight,
        credentialStatus: effectiveCredentialStatus(
          row.credentialStatus,
          row.coolUntil,
          now,
        ),
        coolUntil: row.coolUntil,
        meta: row.meta,
        productLineId: row.productLineId,
        productType: row.productType,
        retryPolicy: row.retryPolicy,
        providerCode: row.providerCode,
        authStyle: upstreamConfig.authStyle,
        supportedProtocols: row.supportedProtocols ?? [],
        baseUrl: upstreamConfig.baseUrl,
      };
    })
    .filter((credential): credential is AvailableRelayCredential => credential !== null);

  return {
    credentials: filterRelayItemsToProductLine(credentials, productLineId),
    boundChannelUnavailable: false,
    providerCode: boundChannel.providerCode,
  };
}

function coolingRetryAfter(credentials: AvailableRelayCredential[]): number | null {
  if (credentials.length === 0) {
    return null;
  }
  if (credentials.some((credential) => credential.credentialStatus !== "cooling")) return null;
  const now = Date.now();
  const retryTimes = credentials
    .filter((credential) => credential.credentialStatus === "cooling")
    .map((credential) => credential.coolUntil?.getTime())
    .filter((value): value is number => value !== undefined && value > now);
  if (retryTimes.length !== credentials.length) return null;
  if (retryTimes.length === 0) return null;
  return Math.max(1, Math.ceil((Math.min(...retryTimes) - now) / 1_000));
}

function unavailableResolution(
  credentials: AvailableRelayCredential[],
): Pick<RelayCandidateResolution, "unavailableReason" | "retryAfterSeconds"> {
  const retryAfterSeconds = coolingRetryAfter(credentials);
  if (retryAfterSeconds !== null) {
    return { unavailableReason: "cooling", retryAfterSeconds };
  }
  return { unavailableReason: "unavailable", retryAfterSeconds: null };
}

function retryAfterSecondsFrom(retryAt: Date | null): number | null {
  if (!retryAt) return null;
  const seconds = Math.ceil((retryAt.getTime() - Date.now()) / 1_000);
  return seconds > 0 ? seconds : null;
}

function mapAcquireFailure(
  reason: "no_scope" | "exhausted_pool" | "no_binding_available",
  retryAt: Date | null,
): Pick<RelayBoundCandidateResolution, "unavailableReason" | "retryAfterSeconds"> {
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
>;

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
  };
}

/**
 * Pure routing core used by both production queries and focused tests. Raw
 * rows are scoped to the Key product line before explicit-route detection,
 * transparent fallback, candidate construction, weighting, and error
 * classification.
 */
export function resolveRelayCandidatesFromSnapshot(
  rawCredentials: readonly AvailableRelayCredential[],
  rawRoutes: readonly AvailableRelayModelRoute[],
  clientModel: string,
  upstreamProtocol: RelayProtocol,
  productLineId: number,
): RelayCandidateResolution {
  if (!isValidRelayProductLineId(productLineId)) {
    return {
      candidates: [],
      unavailableReason: "bound_channel_unavailable",
      retryAfterSeconds: null,
    };
  }
  const scopedCredentials = filterRelayItemsToProductLine(rawCredentials, productLineId);
  if (
    scopedCredentials.some((credential) =>
      glmProviderBlocksClientModel(credential.providerCode, clientModel)
    )
  ) {
    return {
      candidates: [],
      unavailableReason: "model_not_allowed",
      retryAfterSeconds: null,
    };
  }
  const credentials = scopedCredentials
    .filter((credential) => credentialSupportsProtocol(credential, upstreamProtocol));
  const routes = filterRelayItemsToProductLine(rawRoutes, productLineId);
  const activeCredentials = credentials.filter(
    (credential) =>
      credential.credentialStatus === "active" && credential.credentialWeight > 0,
  );
  const candidates: RelayCandidate[] = [];
  if (routes.length) {
    for (const route of routes) {
      if (route.routeWeight <= 0) continue;
      for (const credential of activeCredentials) {
        if (credential.productLineId !== route.productLineId) continue;
        candidates.push(toRelayCandidate(credential, clientModel, upstreamProtocol, route));
      }
    }
  } else {
    for (const credential of activeCredentials) {
      candidates.push(toRelayCandidate(credential, clientModel, upstreamProtocol));
    }
  }

  const ordered = orderRelayCandidates(candidates);
  if (ordered.length > 0) {
    return { candidates: ordered, unavailableReason: null, retryAfterSeconds: null };
  }

  if (routes.length) {
    const routedProductLines = new Set(routes.map((route) => route.productLineId));
    const mappedCredentials = credentials.filter((credential) =>
      routedProductLines.has(credential.productLineId)
    );
    const hasPositiveRoute = routes.some((route) => route.routeWeight > 0);
    const eligibleCredentials = hasPositiveRoute
      ? mappedCredentials.filter((credential) => credential.credentialWeight > 0)
      : [];
    return {
      candidates: [],
      ...unavailableResolution(eligibleCredentials),
    };
  }

  const eligibleCredentials = credentials.filter(
    (credential) => credential.credentialWeight > 0,
  );
  return {
    candidates: [],
    ...unavailableResolution(eligibleCredentials),
  };
}

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
): Promise<RelayBoundCandidateResolution> {
  if (!isValidRelayProductLineId(productLineId)) {
    return {
      candidate: null,
      unavailableReason: "bound_channel_unavailable",
      retryAfterSeconds: null,
    };
  }
  const access = await loadAccessibleCredentials(protocol, productLineId);
  if (access.boundChannelUnavailable) {
    return {
      candidate: null,
      unavailableReason: "bound_channel_unavailable",
      retryAfterSeconds: null,
    };
  }
  if (access.providerCode && glmProviderBlocksClientModel(access.providerCode, clientModel)) {
    return {
      candidate: null,
      unavailableReason: "model_not_allowed",
      retryAfterSeconds: null,
    };
  }

  const routes = await loadEnabledModelRoutes(productLineId, clientModel);
  const snapshot = resolveRelayCandidatesFromSnapshot(
    access.credentials,
    routes,
    clientModel,
    protocol,
    productLineId,
  );
  const modelRoute = pickModelRoute(routes, productLineId);
  if (modelRoute.kind === "suppressed") {
    return {
      candidate: null,
      unavailableReason: "unavailable",
      retryAfterSeconds: null,
    };
  }

  const acquired = await acquireBoundCredential({
    employeeId,
    productLineId,
    protocol,
    excludeCredentialIds,
  });
  if (!acquired.ok) {
    return { candidate: null, ...mapAcquireFailure(acquired.reason, acquired.retryAt) };
  }

  const bound: BoundCredential = acquired.credential;
  if (!credentialSupportsProtocol(bound, protocol)) {
    return { candidate: null, ...mapAcquireFailure("no_binding_available", null) };
  }

  const preferred = snapshot.candidates[0];
  const route: AvailableRelayModelRoute | undefined =
    preferred && preferred.routeId !== null
      ? {
          routeId: preferred.routeId,
          productLineId: preferred.productLineId,
          upstreamModel: preferred.upstreamModel,
          routePriority: preferred.routePriority,
          routeWeight: preferred.routeWeight,
        }
      : modelRoute.kind === "routed"
        ? modelRoute.route
        : undefined;

  return {
    candidate: toRelayCandidate(bound, clientModel, protocol, route),
    unavailableReason: null,
    retryAfterSeconds: null,
  };
}

export async function resolveAccessibleRelayModels(
  employeeId: number,
  upstreamProtocol: RelayProtocol,
  productLineId: number,
): Promise<RelayModelListResolution> {
  if (!isValidRelayProductLineId(productLineId)) {
    return { models: [], unavailableReason: "bound_channel_unavailable" };
  }
  const access = await loadAccessibleCredentials(
    upstreamProtocol,
    productLineId,
    { readOnly: true },
  );
  if (access.boundChannelUnavailable) {
    return { models: [], unavailableReason: "bound_channel_unavailable" };
  }
  const glmOnly = access.providerCode != null && isGlmProvider(access.providerCode);
  const credentials = access.credentials.filter(
    (credential) =>
      credential.credentialStatus === "active" && credential.credentialWeight > 0,
  );
  const eligibleProductLines = new Set(credentials.map((item) => item.productLineId));
  const routes = await db
    .select({
      clientModel: modelRoutes.clientModel,
      productLineId: modelRoutes.productLineId,
      providerCode: providers.code,
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
      ),
    );

  const byId = new Map<string, string>();
  const boundExplicitModels = new Set(routes.map((route) => route.clientModel));
  const allowModel = (model: string) => !glmOnly || isGlmClientModelAllowed(model);
  for (const credential of credentials) {
    for (const model of discoveredModels(credential.meta)) {
      // Prefer the explicit model-list entry for a duplicate client model.
      if (boundExplicitModels.has(model)) continue;
      if (!allowModel(model)) continue;
      if (!byId.has(model)) byId.set(model, credential.providerCode);
    }
  }
  for (const route of routes) {
    const callable = eligibleProductLines.has(route.productLineId) &&
      route.routeWeight > 0 &&
      allowModel(route.clientModel);
    if (callable) {
      byId.set(route.clientModel, route.providerCode);
    }
  }

  return {
    models: [...byId.entries()]
      .map(([id, ownedBy]) => ({ id, ownedBy }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    unavailableReason: null,
  };
}

export async function listAccessibleRelayModels(
  employeeId: number,
  upstreamProtocol: RelayProtocol,
  productLineId: number,
): Promise<Array<{ id: string; ownedBy: string }>> {
  return (await resolveAccessibleRelayModels(
    employeeId,
    upstreamProtocol,
    productLineId,
  )).models;
}
