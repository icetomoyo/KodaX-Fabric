/**
 * In-process load tracking for upstream credentials.
 *
 * Scheduling prefers the credential with the fewest in-flight requests, then
 * the fewest observed tokens. Official upstream limits are usually token
 * budgets, not request counts, so a few huge completions must outweigh many
 * tiny ones. Request count remains a later tie-breaker. Counters live in
 * process memory: they reset on restart, which only affects tie-breaking,
 * and they assume a single relay instance.
 *
 * Virtual-key hops are tracked for the admin binding graph. Afterglow is
 * display-only and never affects scheduling.
 */

export type CredentialLoad = {
  inFlight: number;
  totalUses: number;
  totalTokens: number;
};

export type CredentialLoadReader = (credentialId: number) => CredentialLoad;

export const EMPTY_CREDENTIAL_LOAD: CredentialLoad = {
  inFlight: 0,
  totalUses: 0,
  totalTokens: 0,
};

/** Keep a hop visible after the last in-flight request ends so the graph can catch short calls. */
export const RELAY_LIVE_AFTERGLOW_MS = 4_000;

export type RelayLiveNode = {
  id: number;
  inFlight: number;
  afterglow: boolean;
};

export type RelayLiveHop = {
  virtualKeyId: number;
  credentialId: number;
  inFlight: number;
  afterglow: boolean;
};

export type RelayLiveLoad = {
  keys: RelayLiveNode[];
  credentials: RelayLiveNode[];
  hops: RelayLiveHop[];
};

type LiveCounter = {
  inFlight: number;
  lastEndedAt: number | null;
};

type HopCounter = LiveCounter & {
  virtualKeyId: number;
  credentialId: number;
};

const inFlightByCredential = new Map<number, number>();
const totalUsesByCredential = new Map<number, number>();
const totalTokensByCredential = new Map<number, number>();
const liveByCredential = new Map<number, LiveCounter>();
const liveByVirtualKey = new Map<number, LiveCounter>();
const liveByHop = new Map<string, HopCounter>();

function hopKey(virtualKeyId: number, credentialId: number): string {
  return `${virtualKeyId}:${credentialId}`;
}

function isPositiveId(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function bumpLive(map: Map<number, LiveCounter>, id: number): void {
  const current = map.get(id);
  if (current) {
    current.inFlight += 1;
    return;
  }
  map.set(id, { inFlight: 1, lastEndedAt: null });
}

function dropLive(map: Map<number, LiveCounter>, id: number, now: number): void {
  const current = map.get(id);
  if (!current) return;
  current.inFlight = Math.max(0, current.inFlight - 1);
  if (current.inFlight === 0) current.lastEndedAt = now;
}

function bumpHop(virtualKeyId: number, credentialId: number): void {
  const key = hopKey(virtualKeyId, credentialId);
  const current = liveByHop.get(key);
  if (current) {
    current.inFlight += 1;
    return;
  }
  liveByHop.set(key, {
    virtualKeyId,
    credentialId,
    inFlight: 1,
    lastEndedAt: null,
  });
}

function dropHop(virtualKeyId: number, credentialId: number, now: number): void {
  const current = liveByHop.get(hopKey(virtualKeyId, credentialId));
  if (!current) return;
  current.inFlight = Math.max(0, current.inFlight - 1);
  if (current.inFlight === 0) current.lastEndedAt = now;
}

function isVisible(counter: LiveCounter, now: number, afterglowMs: number): boolean {
  if (counter.inFlight > 0) return true;
  return counter.lastEndedAt != null && now - counter.lastEndedAt < afterglowMs;
}

function pruneLiveMap(map: Map<number, LiveCounter>, now: number, afterglowMs: number): void {
  for (const [id, counter] of map) {
    if (!isVisible(counter, now, afterglowMs)) map.delete(id);
  }
}

function pruneHops(now: number, afterglowMs: number): void {
  for (const [key, counter] of liveByHop) {
    if (!isVisible(counter, now, afterglowMs)) liveByHop.delete(key);
  }
}

function pruneLive(now: number, afterglowMs: number): void {
  pruneLiveMap(liveByCredential, now, afterglowMs);
  pruneLiveMap(liveByVirtualKey, now, afterglowMs);
  pruneHops(now, afterglowMs);
}

function toLiveNode(id: number, counter: LiveCounter): RelayLiveNode {
  return {
    id,
    inFlight: counter.inFlight,
    afterglow: counter.inFlight <= 0,
  };
}

export function getCredentialLoad(credentialId: number): CredentialLoad {
  return {
    inFlight: inFlightByCredential.get(credentialId) ?? 0,
    totalUses: totalUsesByCredential.get(credentialId) ?? 0,
    totalTokens: totalTokensByCredential.get(credentialId) ?? 0,
  };
}

export function recordCredentialTokens(credentialId: number, tokens: number): void {
  const amount = Number.isFinite(tokens) ? Math.trunc(tokens) : 0;
  if (amount <= 0) return;
  totalTokensByCredential.set(
    credentialId,
    (totalTokensByCredential.get(credentialId) ?? 0) + amount,
  );
}

/**
 * Snapshot of hops that are in flight or still in the afterglow window.
 * Afterglow never changes scheduling counters from `getCredentialLoad`.
 */
export function snapshotRelayLiveLoad(
  now = Date.now(),
  afterglowMs = RELAY_LIVE_AFTERGLOW_MS,
): RelayLiveLoad {
  const windowMs = Math.max(0, afterglowMs);
  pruneLive(now, windowMs);
  const keys: RelayLiveNode[] = [];
  for (const [id, counter] of liveByVirtualKey) {
    if (isVisible(counter, now, windowMs)) keys.push(toLiveNode(id, counter));
  }
  const credentials: RelayLiveNode[] = [];
  for (const [id, counter] of liveByCredential) {
    if (isVisible(counter, now, windowMs)) credentials.push(toLiveNode(id, counter));
  }
  const hops: RelayLiveHop[] = [];
  for (const counter of liveByHop.values()) {
    if (!isVisible(counter, now, windowMs)) continue;
    hops.push({
      virtualKeyId: counter.virtualKeyId,
      credentialId: counter.credentialId,
      inFlight: counter.inFlight,
      afterglow: counter.inFlight <= 0,
    });
  }
  keys.sort((a, b) => a.id - b.id);
  credentials.sort((a, b) => a.id - b.id);
  hops.sort(
    (a, b) => a.virtualKeyId - b.virtualKeyId || a.credentialId - b.credentialId,
  );
  return { keys, credentials, hops };
}

/**
 * Record the start of one upstream attempt. Returns an idempotent release
 * callback that must run when the attempt fully ends (including after a
 * streamed response body has been consumed or aborted).
 *
 * Pass `virtualKeyId` when the attempt is tied to an employee API key so the
 * binding graph can light the correct hop. Scheduling still keys only on the
 * credential.
 */
export function beginCredentialUse(
  credentialId: number,
  virtualKeyId?: number | null,
): () => void {
  const now = Date.now();
  pruneLive(now, RELAY_LIVE_AFTERGLOW_MS);
  inFlightByCredential.set(
    credentialId,
    (inFlightByCredential.get(credentialId) ?? 0) + 1,
  );
  totalUsesByCredential.set(
    credentialId,
    (totalUsesByCredential.get(credentialId) ?? 0) + 1,
  );
  bumpLive(liveByCredential, credentialId);
  const trackedKeyId = isPositiveId(virtualKeyId) ? virtualKeyId : null;
  if (trackedKeyId != null) {
    bumpLive(liveByVirtualKey, trackedKeyId);
    bumpHop(trackedKeyId, credentialId);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const endedAt = Date.now();
    const current = inFlightByCredential.get(credentialId) ?? 0;
    if (current <= 1) {
      inFlightByCredential.delete(credentialId);
    } else {
      inFlightByCredential.set(credentialId, current - 1);
    }
    dropLive(liveByCredential, credentialId, endedAt);
    if (trackedKeyId != null) {
      dropLive(liveByVirtualKey, trackedKeyId, endedAt);
      dropHop(trackedKeyId, credentialId, endedAt);
    }
  };
}
