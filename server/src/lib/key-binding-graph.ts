import { resolveBindingScope } from "./relay/binding.js";
import { isOpenPoolProvider } from "./relay/open-pool.js";
import { credentialSupportsProtocol } from "./relay/routing.js";
import type { CreditCoolingKind } from "./relay/credential-quota.js";
import type { RelayProtocol } from "./relay/protocol.js";
import { isRelayProtocol } from "./relay/protocol.js";
import { DEFAULT_USAGE_TIER, type UsageTier } from "./usage-tier.js";

const DEFAULT_TEAM_NODE_NAME = "默认团队";

export type KeyBindingEmployeeInput = {
  id: number;
  name: string;
  enterpriseId: number | null;
  enterpriseName: string | null;
  departmentId: number | null;
  departmentName: string | null;
  teamId: number | null;
  teamName: string | null;
  teamIsDefault?: boolean;
  usageTier?: UsageTier;
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
  coolingKind?: CreditCoolingKind | null;
  coolUntil?: string | null;
  supportedProtocols: readonly string[];
};

export type KeyBindingScopeType = "employee" | "team" | "enterprise" | "department";

export type KeyBindingBindingInput = {
  credentialId: number;
  scopeType: KeyBindingScopeType;
  scopeId: number;
};

export type KeyBindingGraphFilter = {
  productLineId?: number;
  enterpriseId?: number;
  q?: string;
};

export type KeyBindingEmployee = KeyBindingEmployeeInput;
export type KeyBindingVirtualKey = KeyBindingVirtualKeyInput;
export type KeyBindingCredential = KeyBindingCredentialInput & {
  bound: boolean;
};

export type KeyBindingNodeType =
  | "enterprise"
  | "department"
  | "team"
  | "employee"
  | "virtual_key"
  | "credential";

export type KeyBindingEdgeKind =
  | "org"
  | "owns"
  | "dedicated"
  | "team_shared"
  | "department_shared"
  | "enterprise_shared"
  | "open_shared";

export type KeyBindingEdge = {
  id: string;
  sourceType: KeyBindingNodeType;
  sourceId: number;
  targetType: KeyBindingNodeType;
  targetId: number;
  kind: KeyBindingEdgeKind;
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

export type KeyBindingDepartment = {
  id: number;
  name: string;
  enterpriseId: number | null;
};

export type KeyBindingTeam = {
  id: number;
  name: string;
  enterpriseId: number | null;
  departmentId: number | null;
  isDefault?: boolean;
};

export type KeyBindingGraph = {
  employees: KeyBindingEmployee[];
  departments: KeyBindingDepartment[];
  teams: KeyBindingTeam[];
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
  bindings: readonly KeyBindingBindingInput[];
  filter?: KeyBindingGraphFilter;
};

const BINDING_EDGE_KIND: Record<
  KeyBindingScopeType,
  Extract<KeyBindingEdgeKind, "dedicated" | "team_shared" | "department_shared" | "enterprise_shared">
> = {
  employee: "dedicated",
  team: "team_shared",
  department: "department_shared",
  enterprise: "enterprise_shared",
};

function asRelayProtocols(values: readonly string[]): RelayProtocol[] {
  return values.filter(isRelayProtocol);
}

function normalizeQuery(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function employeeMatches(row: KeyBindingEmployeeInput, q: string): boolean {
  return (
    row.name.toLowerCase().includes(q) ||
    (row.enterpriseName?.toLowerCase().includes(q) ?? false) ||
    (row.departmentName?.toLowerCase().includes(q) ?? false) ||
    (row.teamName?.toLowerCase().includes(q) ?? false)
  );
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

function collectDepartments(
  employees: readonly KeyBindingEmployeeInput[],
): KeyBindingDepartment[] {
  const byId = new Map<number, KeyBindingDepartment>();
  for (const row of employees) {
    if (row.departmentId == null || !row.departmentName) continue;
    byId.set(row.departmentId, {
      id: row.departmentId,
      name: row.departmentName,
      enterpriseId: row.enterpriseId,
    });
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function isDefaultTeam(row: {
  teamName?: string | null;
  teamIsDefault?: boolean;
  isDefault?: boolean;
}): boolean {
  return row.teamIsDefault === true || row.isDefault === true || row.teamName === DEFAULT_TEAM_NODE_NAME;
}

function collectTeams(employees: readonly KeyBindingEmployeeInput[]): KeyBindingTeam[] {
  const byId = new Map<number, KeyBindingTeam>();
  for (const row of employees) {
    if (row.teamId == null || !row.teamName || isDefaultTeam(row)) continue;
    byId.set(row.teamId, {
      id: row.teamId,
      name: row.teamName,
      enterpriseId: row.enterpriseId,
      departmentId: row.departmentId,
      isDefault: false,
    });
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function buildOrgEdges(employees: readonly KeyBindingEmployeeInput[]): KeyBindingEdge[] {
  const edges: KeyBindingEdge[] = [];
  const seenEnterpriseDepartment = new Set<string>();
  const seenDepartmentTeam = new Set<string>();
  const seenEnterpriseTeam = new Set<string>();
  for (const employee of employees) {
    if (employee.enterpriseId != null && employee.departmentId != null) {
      const id = `org:ent:${employee.enterpriseId}:dept:${employee.departmentId}`;
      if (!seenEnterpriseDepartment.has(id)) {
        seenEnterpriseDepartment.add(id);
        edges.push({
          id,
          sourceType: "enterprise",
          sourceId: employee.enterpriseId,
          targetType: "department",
          targetId: employee.departmentId,
          kind: "org",
        });
      }
    }
    const namedTeam = employee.teamId != null && !isDefaultTeam(employee);
    if (employee.departmentId != null && namedTeam) {
      const id = `org:dept:${employee.departmentId}:team:${employee.teamId}`;
      if (!seenDepartmentTeam.has(id)) {
        seenDepartmentTeam.add(id);
        edges.push({
          id,
          sourceType: "department",
          sourceId: employee.departmentId,
          targetType: "team",
          targetId: employee.teamId!,
          kind: "org",
        });
      }
    } else if (employee.enterpriseId != null && namedTeam) {
      const id = `org:ent:${employee.enterpriseId}:team:${employee.teamId}`;
      if (!seenEnterpriseTeam.has(id)) {
        seenEnterpriseTeam.add(id);
        edges.push({
          id,
          sourceType: "enterprise",
          sourceId: employee.enterpriseId,
          targetType: "team",
          targetId: employee.teamId!,
          kind: "org",
        });
      }
    }
    if (namedTeam) {
      edges.push({
        id: `org:team:${employee.teamId}:emp:${employee.id}`,
        sourceType: "team",
        sourceId: employee.teamId!,
        targetType: "employee",
        targetId: employee.id,
        kind: "org",
      });
      continue;
    }
    if (employee.departmentId != null) {
      edges.push({
        id: `org:dept:${employee.departmentId}:emp:${employee.id}`,
        sourceType: "department",
        sourceId: employee.departmentId,
        targetType: "employee",
        targetId: employee.id,
        kind: "org",
      });
      continue;
    }
    if (employee.enterpriseId != null) {
      edges.push({
        id: `org:ent:${employee.enterpriseId}:emp:${employee.id}`,
        sourceType: "enterprise",
        sourceId: employee.enterpriseId,
        targetType: "employee",
        targetId: employee.id,
        kind: "org",
      });
    }
  }
  return edges;
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

function employeeMatchesBinding(
  employee: KeyBindingEmployeeInput,
  binding: KeyBindingBindingInput,
): boolean {
  const scope = resolveBindingScope({
    employeeId: employee.id,
    usageTier: employee.usageTier ?? DEFAULT_USAGE_TIER,
    teamId: employee.teamId,
    departmentId: employee.departmentId,
    enterpriseId: employee.enterpriseId,
  });
  return scope?.scopeType === binding.scopeType && scope.scopeId === binding.scopeId;
}

/**
 * Usage tier the canvas should draw for an employee.
 *
 * Always the committed `employees.usageTier`. Request-time
 * `effectiveUsageTier` may already have classified after the 7×24h
 * protection window, but that write happens on the next acquire or the
 * daily job. Drawing the preview hides the exclusive Key still in
 * `credential_bindings`.
 */
export function usageTierForKeyBindingGraph(
  stored: UsageTier | null | undefined,
): UsageTier {
  return stored ?? DEFAULT_USAGE_TIER;
}

/**
 * Build the super-admin graph:
 * enterprise → department → named team → employee → virtual Key → upstream credential.
 * Default-team members hang on the department; the default team is not drawn.
 *
 * Virtual Key → credential edges follow credential_bindings, but only for
 * employees whose current usage tier would actually use that scope:
 * idle → none; heavy → employee (`dedicated`); standard → department
 * (`department_shared`).
 * Self-hosted (`custom`) channels skip usage-tier binding: every virtual Key
 * on that channel connects to every protocol-compatible credential (`open_shared`).
 * Unbound credentials stay in the graph with `bound: false`.
 */
export function buildKeyBindingGraph(input: GraphInput): KeyBindingGraph {
  const employeesById = new Map(input.employees.map((row) => [row.id, row]));
  const credentialsById = new Map(input.credentials.map((row) => [row.id, row]));
  const boundCredentialIds = new Set(
    input.bindings
      .filter((row) => credentialsById.has(row.credentialId))
      .map((row) => row.credentialId),
  );

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
    const employee = employeesById.get(key.employeeId);
    if (!employee) continue;

    for (const credential of input.credentials) {
      if (!isOpenPoolProvider(credential.providerCode)) continue;
      if (credential.productLineId !== key.productLineId) continue;
      if (
        !credentialSupportsProtocol(
          { supportedProtocols: asRelayProtocols(credential.supportedProtocols) },
          protocol,
        )
      ) {
        continue;
      }
      useEdges.push({
        id: `use:${key.id}:${credential.id}:open_shared`,
        sourceType: "virtual_key",
        sourceId: key.id,
        targetType: "credential",
        targetId: credential.id,
        kind: "open_shared",
      });
    }

    for (const binding of input.bindings) {
      const credential = credentialsById.get(binding.credentialId);
      if (!credential || credential.productLineId !== key.productLineId) continue;
      if (isOpenPoolProvider(credential.providerCode)) continue;
      if (
        !credentialSupportsProtocol(
          { supportedProtocols: asRelayProtocols(credential.supportedProtocols) },
          protocol,
        )
      ) {
        continue;
      }
      if (!employeeMatchesBinding(employee, binding)) continue;
      const kind = BINDING_EDGE_KIND[binding.scopeType];
      useEdges.push({
        id: `use:${key.id}:${credential.id}:${kind}`,
        sourceType: "virtual_key",
        sourceId: key.id,
        targetType: "credential",
        targetId: credential.id,
        kind,
      });
    }
  }

  const usedEmployeeIds = new Set(virtualKeys.map((row) => row.employeeId));
  let employees = input.employees.filter((row) => usedEmployeeIds.has(row.id));
  let keys = virtualKeys;
  const openPoolLinkedIds = new Set(
    useEdges.filter((edge) => edge.kind === "open_shared").map((edge) => edge.targetId),
  );
  let credentials: KeyBindingCredential[] = input.credentials.map((row) => ({
    ...row,
    bound: boundCredentialIds.has(row.id) || openPoolLinkedIds.has(row.id),
  }));
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

  employees = uniqueById(employees)
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      ...row,
      usageTier: row.usageTier ?? DEFAULT_USAGE_TIER,
    }));
  keys = uniqueById(keys).sort((a, b) => a.id - b.id);
  credentials = uniqueById(credentials).sort((a, b) => a.id - b.id);
  const departments = collectDepartments(employees);
  const teams = collectTeams(employees);
  const employeeIds = new Set(employees.map((row) => row.id));
  const keyIds = new Set(keys.map((row) => row.id));
  const credentialIds = new Set(credentials.map((row) => row.id));
  edges = [
    ...buildOrgEdges(employees),
    ...edges.filter((edge) => {
      if (edge.kind === "owns") {
        return employeeIds.has(edge.sourceId) && keyIds.has(edge.targetId);
      }
      return keyIds.has(edge.sourceId) && credentialIds.has(edge.targetId);
    }),
  ];

  return {
    employees,
    departments,
    teams,
    virtualKeys: keys,
    credentials,
    edges,
    channels: collectChannels(input.virtualKeys, input.credentials),
    enterprises: collectEnterprises(input.employees),
  };
}
