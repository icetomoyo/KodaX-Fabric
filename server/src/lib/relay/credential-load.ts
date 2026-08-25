/**
 * In-process load tracking for upstream credentials.
 *
 * Scheduling prefers the credential with the fewest in-flight requests, then
 * the fewest observed tokens. Official upstream limits are usually token
 * budgets, not request counts, so a few huge completions must outweigh many
 * tiny ones. Request count remains a later tie-breaker. Counters live in
 * process memory: they reset on restart, which only affects tie-breaking,
 * and they assume a single relay instance.
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

const inFlightByCredential = new Map<number, number>();
const totalUsesByCredential = new Map<number, number>();
const totalTokensByCredential = new Map<number, number>();

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
 * Record the start of one upstream attempt. Returns an idempotent release
 * callback that must run when the attempt fully ends (including after a
 * streamed response body has been consumed or aborted).
 */
export function beginCredentialUse(credentialId: number): () => void {
  inFlightByCredential.set(
    credentialId,
    (inFlightByCredential.get(credentialId) ?? 0) + 1,
  );
  totalUsesByCredential.set(
    credentialId,
    (totalUsesByCredential.get(credentialId) ?? 0) + 1,
  );
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = inFlightByCredential.get(credentialId) ?? 0;
    if (current <= 1) {
      inFlightByCredential.delete(credentialId);
    } else {
      inFlightByCredential.set(credentialId, current - 1);
    }
  };
}
