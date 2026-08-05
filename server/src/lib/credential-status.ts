export type CredentialStatus = "active" | "disabled" | "auto_disabled" | "cooling";

/**
 * Resolve temporary cooling without mutating persistent state.
 *
 * Read-only metadata and model-list requests must agree with relay scheduling,
 * but they must never turn a GET into a database write. Cooling is effective
 * only while coolUntil defines a future window; otherwise the credential is
 * active.
 */
export function effectiveCredentialStatus(
  status: CredentialStatus,
  coolUntil: Date | null,
  now: Date = new Date(),
): CredentialStatus {
  if (status !== "cooling") return status;
  if (!coolUntil || coolUntil.getTime() <= now.getTime()) return "active";
  return "cooling";
}
