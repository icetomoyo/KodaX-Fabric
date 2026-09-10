import { inspectCredentialSecretDuplicates } from "./credential-bulk.js";

export type BulkRegisterUserInput = {
  name: string;
  phone: string;
};

export type BulkRegisterPlan = {
  create: BulkRegisterUserInput[];
  existingPhones: string[];
};

export function planBulkRegisterUsers(
  users: readonly BulkRegisterUserInput[],
  existingPhones: Iterable<string> = [],
):
  | { kind: "batch_duplicate"; duplicateIndexes: number[] }
  | { kind: "accepted"; plan: BulkRegisterPlan } {
  const phones = users.map((user) => user.phone);
  const duplicates = inspectCredentialSecretDuplicates(phones, existingPhones);
  if (duplicates.batchDuplicateIndexes.length) {
    return {
      kind: "batch_duplicate",
      duplicateIndexes: duplicates.batchDuplicateIndexes,
    };
  }
  const existingSet = new Set(duplicates.existingDuplicateIndexes);
  return {
    kind: "accepted",
    plan: {
      create: users.filter((_, index) => !existingSet.has(index + 1)),
      existingPhones: users
        .filter((_, index) => existingSet.has(index + 1))
        .map((user) => user.phone),
    },
  };
}

/** `ops_audit_logs.target_id` is varchar(64); never join the whole batch into it. */
export function bulkRegisterAuditTargetId(createdIds: readonly number[]): string {
  return createdIds[0] == null ? "" : String(createdIds[0]);
}
