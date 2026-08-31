import {
  credentialSupportsProtocol,
  filterCredentialsByGrant,
} from "./relay/routing.js";
import type { RelayProtocol } from "./relay/protocol.js";
import { isRelayProtocol } from "./relay/protocol.js";

export type KeyBindingEmployeeInput = {
  id: number;
  name: string;
  enterpriseId: number | null;
  enterpriseName: string | null;
  teamId: number | null;
  teamName: string | null;
};

export type KeyBindingVirtualKeyInput = {
  id: number;
  employeeId: number;
  name: string;
  keyPrefix: string;
  protocol: string;
  productLineId: number;
  productLineName: string;
  teamId: number | null;
  teamName: string | null;
  status: "active" | "revoked";
};

export type KeyBindingCredentialInput = {
  id: number;
  label: string;
  secretSuffix: string;
  productLineId: number;
  productLineName: string;
  providerCode: string;
  providerName: string;
  status: "active" | "disabled" | "auto_disabled" | "cooling";
  supportedProtocols: readonly string[];
};

export type KeyBindingGrantInput = {
  employeeId: number;
  credentialId: number;
};

export type KeyBindingGraphFilter = {
  productLineId?: number;
  enterpriseId?: number;
  q?: string;
};

export type KeyBindingEmployee = KeyBindingEmployeeInput;
export type KeyBindingVirtualKey = KeyBindingVirtualKeyInput;
export type KeyBindingCredential = KeyBindingCredentialInput;

export type KeyBindingEdge = {
  id: string;
  sourceType: "employee" | "virtual_key";
  sourceId: number;
  targetType: "virtual_key" | "credential";
  targetId: number;
  kind: "owns" | "grant" | "pool";
};

export type KeyBindingChannel = {
  id: number;
  name: string;
  providerCode: string;
  providerName: string;
};

export type KeyBindingEnterprise = {
  id: number;
  name: string;
};

export type KeyBindingGraph = {
  employees: KeyBindingEmployee[];
  virtualKeys: KeyBindingVirtualKey[];
  credentials: KeyBindingCredential[];
  edges: KeyBindingEdge[];
  channels: KeyBindingChannel[];
  enterprises: KeyBindingEnterprise[];
};

type GraphInput = {
  employees: readonly KeyBindingEmployeeInput[];
  virtualKeys: readonly KeyBindingVirtualKeyInput[];
  credentials: readonly KeyBindingCredentialInput[];
  grants: readonly KeyBindingGrantInput[];
  filter?: KeyBindingGraphFilter;
};

type CredentialRef = {
  credentialId: number;
  productLineId: number;
  supportedProtocols: readonly RelayProtocol[];
};

function asRelayProtocols(values: readonly string[]): RelayProtocol[] {
  return values.filter(isRelayProtocol);
}

function normalizeQuery(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function employeeMatches(row: KeyBindingEmployeeInput, q: string): boolean {
  return row.name.toLowerCase().includes(q);
}

function virtualKeyMatches(row: KeyBindingVirtualKeyInput, q: string): boolean {
  return (
    row.name.toLowerCase().includes(q) ||
    row.keyPrefix.toLowerCase().includes(q) ||
    row.productLineName.toLowerCase().includes(q)
  );
}

function credentialMatches(row: KeyBindingCredentialInput, q: string): boolean {
  return (
    row.label.toLowerCase().includes(q) ||
    row.secretSuffix.toLowerCase().includes(q) ||
    row.productLineName.toLowerCase().includes(q)
  );
}

function uniqueById<T extends { id: number }>(rows: readonly T[]): T[] {
  const seen = new Set<number>();
  const result: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return result;
}

function collectEnterprises(
  employees: readonly KeyBindingEmployeeInput[],
): KeyBindingEnterprise[] {
  const byId = new Map<number, KeyBindingEnterprise>();
  for (const row of employees) {
    if (row.enterpriseId == null || !row.enterpriseName) continue;
    byId.set(row.enterpriseId, { id: row.enterpriseId, name: row.enterpriseName });
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function collectChannels(
  virtualKeys: readonly KeyBindingVirtualKeyInput[],
  credentials: readonly KeyBindingCredentialInput[],
): KeyBindingChannel[] {
  const byId = new Map<number, KeyBindingChannel>();
  for (const row of credentials) {
    byId.set(row.productLineId, {
      id: row.productLineId,
      name: row.productLineName,
      providerCode: row.providerCode,
      providerName: row.providerName,
    });
  }
  for (const row of virtualKeys) {
    if (byId.has(row.productLineId)) continue;
    byId.set(row.productLineId, {
      id: row.productLineId,
      name: row.productLineName,
      providerCode: "",
      providerName: "",
    });
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * Build the super-admin graph: employee → virtual Key → upstream (智谱) Key.
 *
 * Virtual Key → credential edges follow relay access:
 * grants on that product line restrict the pool; otherwise the whole
 * same-channel pool is used. Protocol support is applied in both cases.
 */
export function buildKeyBindingGraph(input: GraphInput): KeyBindingGraph {
  const employeesById = new Map(input.employees.map((row) => [row.id, row]));
  const credentialsById = new Map(input.credentials.map((row) => [row.id, row]));

  const grantsByEmployeeLine = new Map<string, Set<number>>();
  for (const grant of input.grants) {
    const credential = credentialsById.get(grant.credentialId);
    if (!credential) continue;
    const key = `${grant.employeeId}:${credential.productLineId}`;
    let ids = grantsByEmployeeLine.get(key);
    if (!ids) {
      ids = new Set();
      grantsByEmployeeLine.set(key, ids);
    }
    ids.add(grant.credentialId);
  }

  const credentialsByLine = new Map<number, CredentialRef[]>();
  for (const row of input.credentials) {
    const list = credentialsByLine.get(row.productLineId) ?? [];
    list.push({
      credentialId: row.id,
      productLineId: row.productLineId,
      supportedProtocols: asRelayProtocols(row.supportedProtocols),
    });
    credentialsByLine.set(row.productLineId, list);
  }

  const virtualKeys = input.virtualKeys.filter((row) => employeesById.has(row.employeeId));
  const ownsEdges: KeyBindingEdge[] = [];
  const useEdges: KeyBindingEdge[] = [];

  for (const key of virtualKeys) {
    ownsEdges.push({
      id: `owns:${key.employeeId}:${key.id}`,
      sourceType: "employee",
      sourceId: key.employeeId,
      targetType: "virtual_key",
      targetId: key.id,
      kind: "owns",
    });

    const protocol = key.protocol;
    if (!isRelayProtocol(protocol)) continue;
    const lineCredentials = credentialsByLine.get(key.productLineId) ?? [];
    const protocolCredentials = lineCredentials.filter((row) =>
      credentialSupportsProtocol(row, protocol),
    );
    const grantedIds = grantsByEmployeeLine.get(`${key.employeeId}:${key.productLineId}`) ?? new Set();
    const accessible = filterCredentialsByGrant(protocolCredentials, grantedIds);
    const kind = grantedIds.size > 0 ? "grant" : "pool";
    for (const credential of accessible) {
      useEdges.push({
        id: `use:${key.id}:${credential.credentialId}:${kind}`,
        sourceType: "virtual_key",
        sourceId: key.id,
        targetType: "credential",
        targetId: credential.credentialId,
        kind,
      });
    }
  }

  const usedEmployeeIds = new Set(virtualKeys.map((row) => row.employeeId));
  let employees = input.employees.filter((row) => usedEmployeeIds.has(row.id));
  let keys = virtualKeys;
  let credentials = [...input.credentials];
  let edges: KeyBindingEdge[] = [...ownsEdges, ...useEdges];

  const productLineId = input.filter?.productLineId;
  if (productLineId != null) {
    keys = keys.filter((row) => row.productLineId === productLineId);
    credentials = credentials.filter((row) => row.productLineId === productLineId);
    const remainingEmployeeIds = new Set(keys.map((row) => row.employeeId));
    employees = employees.filter((row) => remainingEmployeeIds.has(row.id));
  }

  const enterpriseId = input.filter?.enterpriseId;
  if (enterpriseId != null) {
    employees = employees.filter((row) => row.enterpriseId === enterpriseId);
    const allowedEmployees = new Set(employees.map((row) => row.id));
    keys = keys.filter((row) => allowedEmployees.has(row.employeeId));
    const allowedLines = new Set(keys.map((row) => row.productLineId));
    credentials = credentials.filter((row) => allowedLines.has(row.productLineId));
  }

  const q = normalizeQuery(input.filter?.q);
  if (q) {
    const matchedEmployees = new Set(
      employees.filter((row) => employeeMatches(row, q)).map((row) => row.id),
    );
    const matchedKeys = new Set(
      keys.filter((row) => virtualKeyMatches(row, q)).map((row) => row.id),
    );
    const matchedCredentials = new Set(
      credentials.filter((row) => credentialMatches(row, q)).map((row) => row.id),
    );

    const keepEmployees = new Set(matchedEmployees);
    const keepKeys = new Set(matchedKeys);
    const keepCredentials = new Set(matchedCredentials);

    for (const key of keys) {
      if (matchedEmployees.has(key.employeeId) || matchedKeys.has(key.id)) {
        keepEmployees.add(key.employeeId);
        keepKeys.add(key.id);
      }
    }
    for (const edge of useEdges) {
      if (keepKeys.has(edge.sourceId) || matchedCredentials.has(edge.targetId)) {
        keepKeys.add(edge.sourceId);
        keepCredentials.add(edge.targetId);
      }
    }
    for (const key of keys) {
      if (keepKeys.has(key.id)) keepEmployees.add(key.employeeId);
    }

    employees = employees.filter((row) => keepEmployees.has(row.id));
    keys = keys.filter((row) => keepKeys.has(row.id));
    credentials = credentials.filter((row) => keepCredentials.has(row.id));
  }

  const employeeIds = new Set(employees.map((row) => row.id));
  const keyIds = new Set(keys.map((row) => row.id));
  const credentialIds = new Set(credentials.map((row) => row.id));
  edges = edges.filter((edge) => {
    if (edge.kind === "owns") {
      return employeeIds.has(edge.sourceId) && keyIds.has(edge.targetId);
    }
    return keyIds.has(edge.sourceId) && credentialIds.has(edge.targetId);
  });

  return {
    employees: uniqueById(employees).sort((a, b) => a.id - b.id),
    virtualKeys: uniqueById(keys).sort((a, b) => a.id - b.id),
    credentials: uniqueById(credentials).sort((a, b) => a.id - b.id),
    edges,
    channels: collectChannels(input.virtualKeys, input.credentials),
    enterprises: collectEnterprises(input.employees),
  };
}
