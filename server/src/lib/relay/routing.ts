import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  credentialEmployeeGrants,
  modelRoutes,
  productLines,
  providers,
  upstreamCredentials,
} from "../../db/schema/index.js";
import type { RelayCandidate } from "./types.js";

type AvailableCredential = {
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
  shareMode: "public_pool" | "grant_only" | "disabled";
  allowAutoRoute: boolean;
  retryPolicy: unknown;
  providerCode: string;
  authStyle: string;
  baseUrl: string;
};

export type RelayCandidateResolution = {
  candidates: RelayCandidate[];
  unavailableReason: "unknown_model" | "cooling" | "unavailable" | null;
  retryAfterSeconds: number | null;
};

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

async function loadAccessibleCredentials(employeeId: number): Promise<AvailableCredential[]> {
  const now = new Date();
  // Cooling is a temporary state. Restore expired entries in persistent state
  // so admin views and subsequent scheduling agree that the credential is
  // active again. A null coolUntil is also treated as an expired legacy state.
  await db
    .update(upstreamCredentials)
    .set({ status: "active", coolUntil: null, updatedAt: now })
    .where(
      and(
        eq(upstreamCredentials.status, "cooling"),
        or(isNull(upstreamCredentials.coolUntil), lte(upstreamCredentials.coolUntil, now)),
      ),
    );

  const [rows, grants] = await Promise.all([
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
        shareMode: productLines.shareMode,
        allowAutoRoute: productLines.allowAutoRoute,
        retryPolicy: productLines.retryPolicy,
        providerCode: providers.code,
        authStyle: providers.authStyle,
        defaultBaseUrl: providers.defaultBaseUrl,
        baseUrlOverride: productLines.baseUrlOverride,
      })
      .from(upstreamCredentials)
      .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .where(and(eq(productLines.status, "active"), eq(providers.status, "active"))),
    db
      .select({ credentialId: credentialEmployeeGrants.credentialId })
      .from(credentialEmployeeGrants)
      .where(eq(credentialEmployeeGrants.employeeId, employeeId)),
  ]);

  const grantedCredentialIds = new Set(grants.map((grant) => grant.credentialId));
  return rows
    .filter((row) => {
      if (row.shareMode === "public_pool") return true;
      if (row.shareMode === "grant_only") {
        return grantedCredentialIds.has(row.credentialId);
      }
      return false;
    })
    .map((row) => ({
      credentialId: row.credentialId,
      credentialSuffix: row.credentialSuffix,
      secretEncrypted: row.secretEncrypted,
      credentialPriority: row.credentialPriority,
      credentialWeight: row.credentialWeight,
      credentialStatus: row.credentialStatus,
      coolUntil: row.coolUntil,
      meta: row.meta,
      productLineId: row.productLineId,
      productType: row.productType,
      shareMode: row.shareMode,
      allowAutoRoute: row.allowAutoRoute,
      retryPolicy: row.retryPolicy,
      providerCode: row.providerCode,
      authStyle: row.authStyle,
      baseUrl: (row.baseUrlOverride || row.defaultBaseUrl).replace(/\/+$/, ""),
    }));
}

function coolingRetryAfter(credentials: AvailableCredential[]): number | null {
  const now = Date.now();
  const retryTimes = credentials
    .filter((credential) => credential.credentialStatus === "cooling")
    .map((credential) => credential.coolUntil?.getTime())
    .filter((value): value is number => value !== undefined && value > now);
  if (retryTimes.length === 0) return null;
  return Math.max(1, Math.ceil((Math.min(...retryTimes) - now) / 1_000));
}

function unavailableResolution(
  known: boolean,
  credentials: AvailableCredential[],
): Pick<RelayCandidateResolution, "unavailableReason" | "retryAfterSeconds"> {
  if (!known) return { unavailableReason: "unknown_model", retryAfterSeconds: null };
  const retryAfterSeconds = coolingRetryAfter(credentials);
  if (retryAfterSeconds !== null) {
    return { unavailableReason: "cooling", retryAfterSeconds };
  }
  return { unavailableReason: "unavailable", retryAfterSeconds: null };
}

function candidateRank(candidate: RelayCandidate): [number, number] {
  return [candidate.routePriority, candidate.credentialPriority];
}

function compareRank(a: RelayCandidate, b: RelayCandidate): number {
  const [aRoute, aCredential] = candidateRank(a);
  const [bRoute, bCredential] = candidateRank(b);
  return bRoute - aRoute || bCredential - aCredential;
}

function weightedShuffle(
  candidates: RelayCandidate[],
  random: () => number,
): RelayCandidate[] {
  const remaining = [...candidates];
  const ordered: RelayCandidate[] = [];
  while (remaining.length) {
    const weights = remaining.map(
      (candidate) => candidate.routeWeight * candidate.credentialWeight,
    );
    const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
    if (total <= 0) break;
    let cursor = random() * total;
    let index = weights.length - 1;
    for (let i = 0; i < weights.length; i += 1) {
      cursor -= Math.max(0, weights[i]);
      if (cursor < 0) {
        index = i;
        break;
      }
    }
    ordered.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return ordered;
}

export function orderRelayCandidates(
  candidates: RelayCandidate[],
  random: () => number = Math.random,
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
    for (const candidate of weightedShuffle(group, random)) {
      // A request must not retry the same credential. Deduplicate only after
      // weighting equal-priority routes so duplicate mappings do not make the
      // database's unspecified row order decide the upstream model.
      if (selectedCredentialIds.has(candidate.credentialId)) continue;
      selectedCredentialIds.add(candidate.credentialId);
      ordered.push(candidate);
    }
    ranked.splice(0, group.length);
  }
  return ordered;
}

export async function resolveRelayCandidates(
  employeeId: number,
  clientModel: string,
): Promise<RelayCandidateResolution> {
  const [credentials, routes] = await Promise.all([
    loadAccessibleCredentials(employeeId),
    db
      .select({
        routeId: modelRoutes.id,
        productLineId: modelRoutes.productLineId,
        upstreamModel: modelRoutes.upstreamModel,
        routePriority: modelRoutes.priority,
        routeWeight: modelRoutes.weight,
        shareMode: productLines.shareMode,
      })
      .from(modelRoutes)
      .innerJoin(productLines, eq(modelRoutes.productLineId, productLines.id))
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .where(
        and(
          eq(modelRoutes.clientModel, clientModel),
          eq(modelRoutes.enabled, true),
          eq(productLines.status, "active"),
          eq(providers.status, "active"),
        ),
      ),
  ]);

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
        candidates.push({
          routeId: route.routeId,
          routePriority: route.routePriority,
          routeWeight: route.routeWeight,
          clientModel,
          upstreamModel: route.upstreamModel,
          providerCode: credential.providerCode,
          authStyle: credential.authStyle,
          productLineId: credential.productLineId,
          productType: credential.productType,
          retryPolicy: credential.retryPolicy,
          credentialId: credential.credentialId,
          credentialSuffix: credential.credentialSuffix,
          secretEncrypted: credential.secretEncrypted,
          baseUrl: credential.baseUrl,
          credentialPriority: credential.credentialPriority,
          credentialWeight: credential.credentialWeight,
        });
      }
    }
  } else {
    for (const credential of activeCredentials) {
      if (!credential.allowAutoRoute || !discoveredModels(credential.meta).includes(clientModel)) {
        continue;
      }
      candidates.push({
        routeId: null,
        routePriority: 0,
        routeWeight: 100,
        clientModel,
        upstreamModel: clientModel,
        providerCode: credential.providerCode,
        authStyle: credential.authStyle,
        productLineId: credential.productLineId,
        productType: credential.productType,
        retryPolicy: credential.retryPolicy,
        credentialId: credential.credentialId,
        credentialSuffix: credential.credentialSuffix,
        secretEncrypted: credential.secretEncrypted,
        baseUrl: credential.baseUrl,
        credentialPriority: credential.credentialPriority,
        credentialWeight: credential.credentialWeight,
      });
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
    const knownToEmployee = mappedCredentials.length > 0 ||
      routes.some((route) => route.shareMode === "public_pool");
    return {
      candidates: [],
      ...unavailableResolution(knownToEmployee, mappedCredentials),
    };
  }

  const mappedCredentials = credentials.filter(
    (credential) =>
      credential.allowAutoRoute && discoveredModels(credential.meta).includes(clientModel),
  );
  return {
    candidates: [],
    ...unavailableResolution(mappedCredentials.length > 0, mappedCredentials),
  };
}

export async function getRelayCandidates(
  employeeId: number,
  clientModel: string,
): Promise<RelayCandidate[]> {
  return (await resolveRelayCandidates(employeeId, clientModel)).candidates;
}

export async function listAccessibleRelayModels(
  employeeId: number,
): Promise<Array<{ id: string; ownedBy: string }>> {
  const credentials = (await loadAccessibleCredentials(employeeId)).filter(
    (credential) =>
      credential.credentialStatus === "active" && credential.credentialWeight > 0,
  );
  const byId = new Map<string, string>();
  for (const credential of credentials) {
    if (!credential.allowAutoRoute) continue;
    for (const model of discoveredModels(credential.meta)) {
      if (!byId.has(model)) byId.set(model, credential.providerCode);
    }
  }

  const eligibleProductLines = new Set(credentials.map((item) => item.productLineId));
  const routes = await db
    .select({
      clientModel: modelRoutes.clientModel,
      productLineId: modelRoutes.productLineId,
      providerCode: providers.code,
    })
    .from(modelRoutes)
    .innerJoin(productLines, eq(modelRoutes.productLineId, productLines.id))
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .where(eq(modelRoutes.enabled, true));
  for (const route of routes) {
    if (eligibleProductLines.has(route.productLineId)) {
      byId.set(route.clientModel, route.providerCode);
    }
  }

  return [...byId.entries()]
    .map(([id, ownedBy]) => ({ id, ownedBy }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
