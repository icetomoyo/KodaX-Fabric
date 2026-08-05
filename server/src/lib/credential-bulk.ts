export type CredentialSecretDuplicateResult = {
  /** 1-based positions of every item involved in an in-batch duplicate. */
  batchDuplicateIndexes: number[];
  /** 1-based positions whose secret already exists in the target product line. */
  existingDuplicateIndexes: number[];
};

export type BulkChannelCreationIntent = {
  productLineId?: number;
  name?: string;
  status?: string;
};

/**
 * A provider/base-URL request carrying channel metadata means "create", not
 * "locate or reuse". If another transaction won the unique product-line
 * insert, importing into that winner would silently discard this request's
 * metadata and mix credentials across administrators.
 */
export function shouldRejectExistingChannelForMetadataRequest(
  input: BulkChannelCreationIntent,
  productLineInsertedByRequest: boolean,
): boolean {
  if (input.productLineId !== undefined || productLineInsertedByRequest) return false;
  return input.name !== undefined ||
    input.status !== undefined;
}

/**
 * Compare credential secrets without returning the secrets themselves.
 *
 * Callers are expected to normalize user input before calling this helper. The
 * returned indexes are 1-based so they can be shown directly in validation
 * messages without accidentally exposing any secret material.
 */
export function inspectCredentialSecretDuplicates(
  requestedSecrets: readonly string[],
  existingSecrets: Iterable<string> = [],
): CredentialSecretDuplicateResult {
  const positionsBySecret = new Map<string, number[]>();
  requestedSecrets.forEach((secret, index) => {
    const positions = positionsBySecret.get(secret) ?? [];
    positions.push(index + 1);
    positionsBySecret.set(secret, positions);
  });

  const batchDuplicateIndexes = [...positionsBySecret.values()]
    .filter((positions) => positions.length > 1)
    .flat()
    .sort((left, right) => left - right);

  const existingSet = new Set(existingSecrets);
  const existingDuplicateIndexes = requestedSecrets
    .map((secret, index) => existingSet.has(secret) ? index + 1 : null)
    .filter((index): index is number => index !== null);

  return { batchDuplicateIndexes, existingDuplicateIndexes };
}
