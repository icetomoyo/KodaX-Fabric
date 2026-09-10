import { inspectCredentialSecretDuplicates } from "./credential-bulk.js";
import {
  effectiveCredentialStatus,
  type CredentialStatus,
} from "./credential-status.js";
import type { RelayProtocol } from "./relay/protocol.js";
import { resolveChannelCredentialInsertProtocols } from "./upstream-channel-update.js";
import {
  configuredProtocols,
  parseProductLineProtocolConfigs,
} from "./upstream-protocol-config.js";

export type SubmitableChannel = {
  id: number;
  name: string;
  code: string;
  productType: "api" | "coding_plan";
  providerCode: string;
  providerName: string;
};

export type SubmitableChannelRow = {
  id: number;
  name: string;
  code: string;
  productType: "api" | "coding_plan";
  status: string;
  providerCode: string;
  providerName: string;
  providerStatus: string;
};

export type EmployeeChannelCredentialSubmitPlan =
  | { kind: "accepted"; protocols: RelayProtocol[]; label: string }
  | { kind: "channel_unavailable" }
  | { kind: "channel_protocol_unset" }
  | { kind: "existing_duplicate" }
  | { kind: "existing_secret_unreadable"; credentialIds: number[] };

const LABEL_MAX_LENGTH = 200;

export function collectSubmitableChannels(
  rows: readonly SubmitableChannelRow[],
): SubmitableChannel[] {
  return [...rows]
    .filter((row) => row.status === "active" && row.providerStatus === "active")
    .sort((left, right) => left.id - right.id)
    .map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      productType: row.productType,
      providerCode: row.providerCode,
      providerName: row.providerName,
    }));
}

export function buildEmployeeSubmittedCredentialLabel(
  channelName: string,
  employeeName: string,
): string {
  const name = employeeName.trim() || "员工";
  const suffix = ` · ${name}`;
  if (suffix.length >= LABEL_MAX_LENGTH) return name.slice(0, LABEL_MAX_LENGTH);
  const prefix = channelName.trim() || "渠道";
  const raw = `${prefix}${suffix}`;
  if (raw.length <= LABEL_MAX_LENGTH) return raw;
  return `${prefix.slice(0, LABEL_MAX_LENGTH - suffix.length)}${suffix}`;
}

export function planEmployeeChannelCredentialSubmit(input: {
  productLineStatus: string;
  providerStatus: string;
  channelName: string;
  employeeName: string;
  protocolConfigs: unknown;
  existingCredentials: ReadonlyArray<{
    supportedProtocols: readonly RelayProtocol[] | null;
  }>;
  existingSecrets: readonly string[];
  unreadableCredentialIds: readonly number[];
  secret: string;
}): EmployeeChannelCredentialSubmitPlan {
  if (input.productLineStatus !== "active" || input.providerStatus !== "active") {
    return { kind: "channel_unavailable" };
  }

  const protocolResolution = resolveChannelCredentialInsertProtocols(
    input.existingCredentials,
    undefined,
    configuredProtocols(parseProductLineProtocolConfigs(input.protocolConfigs)),
  );
  if (protocolResolution.kind === "unset") {
    return { kind: "channel_protocol_unset" };
  }
  if (protocolResolution.kind === "mismatch") {
    return { kind: "channel_unavailable" };
  }
  if (input.unreadableCredentialIds.length) {
    return {
      kind: "existing_secret_unreadable",
      credentialIds: [...input.unreadableCredentialIds],
    };
  }
  if (
    inspectCredentialSecretDuplicates([input.secret], input.existingSecrets)
      .existingDuplicateIndexes.length
  ) {
    return { kind: "existing_duplicate" };
  }

  return {
    kind: "accepted",
    protocols: protocolResolution.protocols,
    label: buildEmployeeSubmittedCredentialLabel(input.channelName, input.employeeName),
  };
}

export type EmployeeSubmittedCredentialRow = {
  id: number;
  productLineId: number;
  productLineName: string;
  providerName: string;
  providerCode: string;
  label: string;
  secretSuffix: string;
  status: CredentialStatus;
  coolUntil: Date | null;
  createdAt: Date;
};

export type EmployeeSubmittedCredentialView = {
  id: number;
  productLineId: number;
  productLineName: string;
  providerName: string;
  providerCode: string;
  label: string;
  secretSuffix: string;
  status: CredentialStatus;
  createdAt: string;
};

export function isEmployeeSubmittedCredentialMeta(
  meta: unknown,
  employeeId: number,
): boolean {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  const record = meta as Record<string, unknown>;
  return (
    record.createdBy === "employee_submit" &&
    Number(record.submittedByEmployeeId) === employeeId
  );
}

export function submittedByEmployeeIdFromMeta(meta: unknown): number | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const record = meta as Record<string, unknown>;
  if (record.createdBy !== "employee_submit") return null;
  const employeeId = Number(record.submittedByEmployeeId);
  return Number.isSafeInteger(employeeId) && employeeId > 0 ? employeeId : null;
}

export type CredentialSubmitRosterPerson = {
  id: number;
  name: string;
  phone: string;
  role: string;
  status: string;
  enterpriseName: string | null;
};

export type CredentialSubmitRosterItem = {
  credentialId: number;
  employeeId: number;
  productLineId: number;
  productLineName: string;
  providerName: string;
  secretSuffix: string;
  status: CredentialStatus;
  createdAt: string;
};

export function partitionCredentialSubmitRoster(
  people: readonly CredentialSubmitRosterPerson[],
  submissions: readonly CredentialSubmitRosterItem[],
): {
  submitted: Array<CredentialSubmitRosterPerson & { submissions: CredentialSubmitRosterItem[] }>;
  unsubmitted: CredentialSubmitRosterPerson[];
} {
  const submissionsByEmployee = new Map<number, CredentialSubmitRosterItem[]>();
  for (const submission of submissions) {
    const list = submissionsByEmployee.get(submission.employeeId) ?? [];
    list.push(submission);
    submissionsByEmployee.set(submission.employeeId, list);
  }
  const submitted: Array<CredentialSubmitRosterPerson & { submissions: CredentialSubmitRosterItem[] }> = [];
  const unsubmitted: CredentialSubmitRosterPerson[] = [];
  for (const person of people) {
    const owned = submissionsByEmployee.get(person.id);
    if (owned?.length) submitted.push({ ...person, submissions: owned });
    else unsubmitted.push(person);
  }
  return { submitted, unsubmitted };
}

export function presentEmployeeSubmittedCredentials(
  rows: readonly EmployeeSubmittedCredentialRow[],
  now: Date = new Date(),
): EmployeeSubmittedCredentialView[] {
  return rows.map((row) => ({
    id: row.id,
    productLineId: row.productLineId,
    productLineName: row.productLineName,
    providerName: row.providerName,
    providerCode: row.providerCode,
    label: row.label,
    secretSuffix: row.secretSuffix,
    status: effectiveCredentialStatus(row.status, row.coolUntil, now),
    createdAt: row.createdAt.toISOString(),
  }));
}
