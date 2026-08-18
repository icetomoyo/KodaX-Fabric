/**
 * In-process load tracking for upstream credentials.
 *
 * Scheduling prefers the credential with the fewest in-flight requests, then
 * the fewest total uses, so pool pressure stays evenly spread. Counters live
 * in process memory: they reset on restart, which only affects tie-breaking,
 * and they assume a single relay instance.
 */

export type CredentialLoad = {
  inFlight: number;
  totalUses: number;
};

export type CredentialLoadReader = (credentialId: number) => CredentialLoad;

const inFlightByCredential = new Map<number, number>();
const totalUsesByCredential = new Map<number, number>();

export function getCredentialLoad(credentialId: number): CredentialLoad {
  return {
    inFlight: inFlightByCredential.get(credentialId) ?? 0,
    totalUses: totalUsesByCredential.get(credentialId) ?? 0,
  };
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
