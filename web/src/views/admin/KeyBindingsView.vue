<template>
  <div class="bindings-page" v-loading="loading">
    <el-empty
      v-if="!loading && !activeBoard"
      description="没有可展示的绑定关系"
      :image-size="88"
    />
    <KeyBindingCanvas
      v-else-if="activeBoard"
      :key="activeBoardKey"
      :nodes="canvasNodes"
      :edges="canvasEdges"
      :selected-node-id="selectedNodeId"
      :live="lastLive"
      :active="true"
      @node-click="(event) => onNodeClick(activeBoardKey, event)"
      @pane-click="() => onPaneClick(activeBoardKey)"
    />

    <div class="fab-stack">
      <button type="button" class="fab" :class="{ active: resourceOpen }" @click="resourceOpen = true">
        资源
        <span v-if="resourceKeys.length" class="fab-count">{{ resourceKeys.length }}</span>
      </button>
      <button type="button" class="fab primary" @click="filterOpen = true">筛选</button>
    </div>

    <el-drawer
      v-model="filterOpen"
      title="筛选"
      direction="rtl"
      size="320px"
      append-to-body
    >
      <el-form label-position="top">
        <el-form-item label="组织">
          <el-cascader
            v-model="orgFilterPath"
            :options="orgCascaderOptions"
            :props="orgCascaderProps"
            clearable
            filterable
            placeholder="企业 / 部门 / 子部门"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </template>
    </el-drawer>

    <el-drawer
      v-model="resourceOpen"
      title="资源"
      direction="rtl"
      size="400px"
      append-to-body
    >
      <el-empty v-if="!resourceKeys.length" description="暂无资源" :image-size="72" />
      <div v-else class="resource-list">
        <article v-for="row in resourceKeys" :key="row.id" class="resource-row">
          <div class="resource-top">
            <strong>{{ row.label }}</strong>
            <el-tag effect="light" :type="resourceTagType(row.lane)">
              {{ resourceLaneLabel(row.lane) }}
            </el-tag>
          </div>
          <div class="resource-meta">
            <span class="mono">…{{ row.secretSuffix }}</span>
            <span>{{ row.providerName || row.productLineName }}</span>
          </div>
        </article>
      </div>
      <template #footer>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </template>
    </el-drawer>

    <el-drawer
      v-model="credentialOpen"
      :title="selectedCredential?.label || '渠道 Key'"
      direction="rtl"
      size="420px"
      append-to-body
    >
      <template v-if="selectedCredential">
        <section class="detail-block">
          <div class="resource-top">
            <strong>{{ selectedCredential.label }}</strong>
            <el-tag effect="light" :type="resourceTagType(selectedCredential.lane)">
              {{ resourceLaneLabel(selectedCredential.lane) }}
            </el-tag>
          </div>
          <div class="resource-meta">
            <span class="mono">…{{ selectedCredential.secretSuffix }}</span>
            <span>{{ selectedCredential.providerName || selectedCredential.productLineName }}</span>
          </div>
        </section>

        <section class="detail-block">
          <h3>绑定</h3>
          <p v-if="selectedCredential.binding">
            {{ bindingScopeLabel(selectedCredential.binding.scopeType) }}
            · {{ selectedCredential.binding.scopeName || selectedCredential.binding.scopeId }}
          </p>
          <p v-else class="muted">当前没有可释放的绑定</p>
        </section>

        <section class="detail-block">
          <h3>使用情况</h3>
          <dl class="quota-list">
            <div>
              <dt>5 小时积分</dt>
              <dd>{{ formatQuotaPair(selectedCredential.fiveHourCredits, selectedCredential.fiveHourLimit) }}</dd>
            </div>
            <div>
              <dt>周积分</dt>
              <dd>{{ formatQuotaPair(selectedCredential.weeklyCredits, selectedCredential.weeklyLimit) }}</dd>
            </div>
            <div v-if="selectedCredential.inFlight">
              <dt>进行中</dt>
              <dd>{{ selectedCredential.inFlight }} 路请求</dd>
            </div>
          </dl>
          <el-empty
            v-if="!credentialUsers.length"
            description="没有连到这把 Key 的员工"
            :image-size="56"
          />
          <ul v-else class="user-list">
            <li v-for="row in credentialUsers" :key="row.keyId">
              <strong>{{ row.employeeName }}</strong>
              <span>{{ usageTierLabel(row.usageTier) }} · {{ row.keyName }}</span>
            </li>
          </ul>
        </section>
      </template>
      <template #footer>
        <el-button @click="credentialOpen = false">关闭</el-button>
        <el-button
          v-if="selectedCredential?.binding"
          type="primary"
          :loading="releasing"
          @click="releaseSelectedCredential"
        >
          释放到资源列表
        </el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import KeyBindingCanvas from "@/components/KeyBindingCanvas.vue";
import { MarkerType, type Edge, type Node, type NodeMouseEvent } from "@vue-flow/core";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import {
  buildOrgCascaderOptions,
  employeeInOrgSelection,
  enterpriseCascaderValue,
  groupingDepartmentId,
  parseOrgFilterPath,
  subtreeIdsForSelection,
  type OrgFilterDepartment,
  type OrgFilterSelection,
} from "@/lib/key-binding-org-filter";

type BindingKind =
  | "org"
  | "owns"
  | "dedicated"
  | "team_shared"
  | "department_shared"
  | "enterprise_shared"
  | "open_shared";
type UseBindingKind = "dedicated" | "team_shared" | "department_shared" | "enterprise_shared" | "open_shared";
type NodeKind =
  | "enterprise"
  | "department"
  | "team"
  | "employee"
  | "virtual_key"
  | "credential"
  | "lane_header";
type CanvasDepth = "enterprise" | "department" | "team";
type CoolingKind = "five_hour" | "weekly" | "other";
type CredentialLane = "bound" | "pending" | "cooling_5h" | "cooling_weekly" | "disabled";

type UsageTier = "idle" | "standard" | "heavy";

type GraphEmployee = {
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

type GraphDepartment = {
  id: number;
  name: string;
  enterpriseId: number | null;
  parentId?: number | null;
  isDefault?: boolean;
};

type GraphTeam = {
  id: number;
  name: string;
  enterpriseId: number | null;
  departmentId?: number | null;
  isDefault?: boolean;
};

type GraphVirtualKey = {
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

type GraphCredentialBinding = {
  scopeType: "employee" | "team" | "enterprise" | "department";
  scopeId: number;
  scopeName: string;
};

type GraphCredential = {
  id: number;
  label: string;
  secretSuffix: string;
  productLineId: number;
  productLineName: string;
  providerCode: string;
  providerName: string;
  status: "active" | "disabled" | "auto_disabled" | "cooling";
  coolingKind?: CoolingKind | null;
  coolUntil?: string | null;
  supportedProtocols: string[];
  bound?: boolean;
  fiveHourCredits?: number;
  weeklyCredits?: number;
  fiveHourLimit?: number | null;
  weeklyLimit?: number | null;
  binding?: GraphCredentialBinding | null;
};

type GraphEdge = {
  id: string;
  sourceType: NodeKind;
  sourceId: number;
  targetType: NodeKind;
  targetId: number;
  kind: BindingKind;
};

type KeyBindingGraph = {
  employees: GraphEmployee[];
  departments?: GraphDepartment[];
  teams: GraphTeam[];
  virtualKeys: GraphVirtualKey[];
  credentials: GraphCredential[];
  edges: GraphEdge[];
  channels: Array<{ id: number; name: string; providerCode: string; providerName: string }>;
  enterprises: Array<{ id: number; name: string }>;
};

type RelayLiveNode = {
  id: number;
  inFlight: number;
  afterglow: boolean;
};

type RelayLiveHop = {
  virtualKeyId: number;
  credentialId: number;
  inFlight: number;
  afterglow: boolean;
};

type RelayLiveLoad = {
  keys: RelayLiveNode[];
  credentials: RelayLiveNode[];
  hops: RelayLiveHop[];
};

type CanvasScope = {
  enterpriseId: number | null;
  departmentId: number | null;
  teamId: number | null;
};

type CanvasBoard = {
  key: string;
  title: string;
  enterpriseTitle: string;
  mode: "enterprise" | "pool";
  scope: CanvasScope;
  nodes: any[];
  edges: any[];
};

const COL_X = {
  enterprise: 0,
  department: 360,
  team: 720,
  employee: 1080,
  virtual_key: 1440,
  bound: 1800,
  pending: 2160,
  cooling_5h: 2520,
  cooling_weekly: 2880,
  disabled: 3240,
} as const;

const STATUS_HEADERS: Array<{
  key: "pending" | "cooling_5h" | "cooling_weekly" | "disabled";
  label: string;
}> = [
  { key: "pending", label: "待绑定" },
  { key: "cooling_5h", label: "5小时冷却" },
  { key: "cooling_weekly", label: "周冷却" },
  { key: "disabled", label: "停用" },
];
const NODE_H = 92;
const NODE_GAP = 40;
const GROUP_GAP = 72;
const LIVE_POLL_MS = 4000;

const loading = ref(false);
const graph = ref<KeyBindingGraph | null>(null);
const selectedNodeId = ref<string | null>(null);
const selectedBoardKey = ref<string | null>(null);
const activeBoardKey = ref("");
const boards = ref<CanvasBoard[]>([]);
const lastLive = ref<RelayLiveLoad | null>(null);
let lastLiveStamp = "";
const filterOpen = ref(false);
const resourceOpen = ref(false);
const credentialOpen = ref(false);
const releasing = ref(false);
const activeBoard = computed(() => boards.value.find((board) => board.key === activeBoardKey.value) ?? null);
const resourceKeys = computed(() => {
  const source = graph.value;
  if (!source) return [];
  const boundIds = boundCredentialIds(source);
  const order: CredentialLane[] = ["pending", "cooling_5h", "cooling_weekly", "disabled"];
  return source.credentials
    .map((row) => ({ ...row, lane: credentialLane(row, boundIds) }))
    .filter((row) => row.bound !== true && row.lane !== "bound")
    .sort((a, b) => order.indexOf(a.lane) - order.indexOf(b.lane) || a.id - b.id);
});
const selectedCredential = computed(() => {
  if (!credentialOpen.value || !selectedNodeId.value?.startsWith("credential:")) return null;
  const credentialId = parseNodeNumericId(selectedNodeId.value);
  if (credentialId == null) return null;
  const source = graph.value;
  if (!source) return null;
  const row = source.credentials.find((item) => item.id === credentialId);
  if (!row) return null;
  const node = activeBoard.value?.nodes.find((item) => item.id === selectedNodeId.value);
  const live = lastLive.value?.credentials.find((item) => item.id === credentialId);
  return {
    ...row,
    lane: (node?.data?.lane as CredentialLane | undefined) ?? credentialLane(row, boundCredentialIds(source)),
    inFlight: Number(live?.inFlight ?? node?.data?.inFlight ?? 0),
  };
});
const credentialUsers = computed(() => {
  const credentialId = selectedCredential.value?.id;
  const source = graph.value;
  if (credentialId == null || !source) return [];
  const keyIds = new Set(
    source.edges
      .filter((edge) => isUseEdgeKind(edge.kind) && edge.targetId === credentialId)
      .map((edge) => edge.sourceId),
  );
  const employeesById = new Map(source.employees.map((row) => [row.id, row]));
  return source.virtualKeys
    .filter((key) => keyIds.has(key.id))
    .map((key) => {
      const employee = employeesById.get(key.employeeId);
      return {
        keyId: key.id,
        keyName: key.name,
        employeeName: employee?.name ?? `员工 ${key.employeeId}`,
        usageTier: employee?.usageTier ?? "standard",
      };
    });
});
const canvasNodes = computed(() => activeBoard.value?.nodes ?? []);
const canvasEdges = computed(() => activeBoard.value?.edges ?? []);

const orgFilterPath = ref<string[]>([]);
const orgCascaderProps = {
  checkStrictly: true,
  emitPath: true,
  expandTrigger: "click" as const,
};
const orgFilterDepartments = computed((): OrgFilterDepartment[] =>
  (graph.value?.departments ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId ?? null,
    enterpriseId: row.enterpriseId ?? 0,
    isDefault: row.isDefault,
  })),
);
const orgCascaderOptions = computed(() =>
  buildOrgCascaderOptions(graph.value?.enterprises ?? [], orgFilterDepartments.value),
);
const orgFilterSelection = computed(() => parseOrgFilterPath(orgFilterPath.value));

function nodeId(type: NodeKind, id: number): string {
  return `${type}:${id}`;
}

function useEdgeStyle(kind: BindingKind): Record<string, string | number | undefined> {
  if (kind === "dedicated") {
    return { stroke: "#2563eb", strokeWidth: 2 };
  }
  if (kind === "team_shared" || kind === "department_shared") {
    return { stroke: "#0891b2", strokeWidth: 1.5, strokeDasharray: "6 4" };
  }
  if (kind === "enterprise_shared") {
    return { stroke: "#4338ca", strokeWidth: 1.5, strokeDasharray: "2 4" };
  }
  if (kind === "open_shared") {
    return { stroke: "#059669", strokeWidth: 1.5 };
  }
  return { stroke: "#94a3b8", strokeWidth: 1.5 };
}

function resourceLaneLabel(lane: CredentialLane): string {
  if (lane === "pending") return "待绑定";
  if (lane === "cooling_weekly") return "周冷却";
  if (lane === "cooling_5h") return "5小时冷却";
  if (lane === "disabled") return "停用";
  return "绑定";
}

function resourceTagType(lane: CredentialLane): "info" | "warning" | "danger" | "success" {
  if (lane === "pending") return "warning";
  if (lane === "cooling_weekly" || lane === "cooling_5h") return "danger";
  if (lane === "disabled") return "info";
  return "success";
}

function bindingScopeLabel(scopeType: GraphCredentialBinding["scopeType"]): string {
  if (scopeType === "employee") return "员工独占";
  if (scopeType === "department") return "部门共享";
  if (scopeType === "team") return "团队共享";
  return "企业共享";
}

function usageTierLabel(tier: UsageTier): string {
  if (tier === "idle") return "闲置用户";
  if (tier === "heavy") return "重度用户";
  return "标准用户";
}

function formatCreditAmount(value: number | undefined): string {
  const n = Math.round(Number(value ?? 0));
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("zh-CN");
}

function formatQuotaPair(used: number | undefined, limit: number | null | undefined): string {
  const usedText = formatCreditAmount(used);
  return limit == null ? `${usedText} / 不限` : `${usedText} / ${formatCreditAmount(limit)} 积分`;
}

function isUseEdgeKind(kind: BindingKind): kind is UseBindingKind {
  return (
    kind === "dedicated" ||
    kind === "team_shared" ||
    kind === "department_shared" ||
    kind === "enterprise_shared" ||
    kind === "open_shared"
  );
}

function isScheduledUseKind(kind: BindingKind): boolean {
  return kind === "dedicated" || kind === "department_shared" || kind === "open_shared";
}

function boundCredentialIds(source: KeyBindingGraph): Set<number> {
  const keyIds = new Set(source.virtualKeys.map((row) => row.id));
  const ids = new Set<number>();
  for (const edge of source.edges) {
    if (!isScheduledUseKind(edge.kind)) continue;
    if (!keyIds.has(edge.sourceId)) continue;
    ids.add(edge.targetId);
  }
  return ids;
}

function credentialLane(
  credential: GraphCredential,
  boundIds: Set<number>,
): CredentialLane {
  if (credential.status === "disabled" || credential.status === "auto_disabled") return "disabled";
  if (credential.coolingKind === "weekly") return "cooling_weekly";
  if (credential.coolingKind === "five_hour" || credential.coolingKind === "other") return "cooling_5h";
  if (credential.status === "cooling") return "cooling_5h";
  if (boundIds.has(credential.id)) return "bound";
  return "pending";
}

type TeamLookup = {
  id: number;
  name: string;
  departmentId?: number | null;
  departmentName?: string | null;
  enterpriseId?: number | null;
  isDefault?: boolean;
};

type DepartmentLookup = {
  id: number;
  name: string;
  enterpriseId: number;
  parentId?: number | null;
  isDefault?: boolean;
};

function isHiddenTeam(employee: GraphEmployee, team?: TeamLookup | GraphTeam): boolean {
  return Boolean(
    employee.teamIsDefault
    || team?.isDefault
    || employee.teamName === "默认团队"
    || team?.name === "默认团队",
  );
}

function hydrateOrgChain(
  source: KeyBindingGraph,
  teams: TeamLookup[],
  departments: DepartmentLookup[],
): KeyBindingGraph {
  const teamById = new Map(teams.map((row) => [row.id, row]));
  const deptById = new Map(departments.map((row) => [row.id, row]));
  const employees = source.employees.map((employee) => {
    const team = employee.teamId != null ? teamById.get(employee.teamId) : undefined;
    const departmentId = employee.departmentId ?? team?.departmentId ?? null;
    const department = departmentId != null ? deptById.get(departmentId) : undefined;
    return {
      ...employee,
      departmentId,
      departmentName: employee.departmentName ?? team?.departmentName ?? department?.name ?? null,
      teamIsDefault: isHiddenTeam(employee, team),
    };
  });

  const graphDepartments = new Map<number, GraphDepartment>();
  for (const department of departments) {
    graphDepartments.set(department.id, {
      id: department.id,
      name: department.name,
      enterpriseId: department.enterpriseId,
      parentId: department.parentId ?? null,
      isDefault: department.isDefault,
    });
  }
  for (const employee of employees) {
    if (employee.departmentId == null || graphDepartments.has(employee.departmentId)) continue;
    const department = deptById.get(employee.departmentId);
    graphDepartments.set(employee.departmentId, {
      id: employee.departmentId,
      name: employee.departmentName || department?.name || "部门",
      enterpriseId: employee.enterpriseId ?? department?.enterpriseId ?? null,
      parentId: department?.parentId ?? null,
      isDefault: department?.isDefault,
    });
  }

  const graphTeams: GraphTeam[] = [];
  const seenTeam = new Set<number>();
  for (const employee of employees) {
    if (employee.teamId == null || employee.teamIsDefault) continue;
    if (seenTeam.has(employee.teamId)) continue;
    seenTeam.add(employee.teamId);
    const team = teamById.get(employee.teamId);
    graphTeams.push({
      id: employee.teamId,
      name: employee.teamName || team?.name || "团队",
      enterpriseId: employee.enterpriseId,
      departmentId: employee.departmentId,
      isDefault: false,
    });
  }

  const orgEdges: GraphEdge[] = [];
  const seen = new Set<string>();
  const push = (edge: GraphEdge) => {
    if (seen.has(edge.id)) return;
    seen.add(edge.id);
    orgEdges.push(edge);
  };
  for (const employee of employees) {
    if (employee.enterpriseId != null && employee.departmentId != null) {
      push({
        id: `org:ent:${employee.enterpriseId}:dept:${employee.departmentId}`,
        sourceType: "enterprise",
        sourceId: employee.enterpriseId,
        targetType: "department",
        targetId: employee.departmentId,
        kind: "org",
      });
    }
    const namedTeam = employee.teamId != null && !employee.teamIsDefault;
    if (namedTeam && employee.departmentId != null) {
      push({
        id: `org:dept:${employee.departmentId}:team:${employee.teamId}`,
        sourceType: "department",
        sourceId: employee.departmentId,
        targetType: "team",
        targetId: employee.teamId!,
        kind: "org",
      });
    }
    if (namedTeam) {
      push({
        id: `org:team:${employee.teamId}:emp:${employee.id}`,
        sourceType: "team",
        sourceId: employee.teamId!,
        targetType: "employee",
        targetId: employee.id,
        kind: "org",
      });
    } else if (employee.departmentId != null) {
      push({
        id: `org:dept:${employee.departmentId}:emp:${employee.id}`,
        sourceType: "department",
        sourceId: employee.departmentId,
        targetType: "employee",
        targetId: employee.id,
        kind: "org",
      });
    } else if (employee.enterpriseId != null) {
      push({
        id: `org:ent:${employee.enterpriseId}:emp:${employee.id}`,
        sourceType: "enterprise",
        sourceId: employee.enterpriseId,
        targetType: "employee",
        targetId: employee.id,
        kind: "org",
      });
    }
  }

  return {
    ...source,
    employees,
    departments: [...graphDepartments.values()],
    teams: graphTeams,
    edges: [...orgEdges, ...source.edges.filter((edge) => edge.kind !== "org")],
  };
}

function subgraphForEmployees(source: KeyBindingGraph, employees: GraphEmployee[]): KeyBindingGraph {
  const employeeIds = new Set(employees.map((row) => row.id));
  const virtualKeys = source.virtualKeys.filter((row) => employeeIds.has(row.employeeId));
  const keyIds = new Set(virtualKeys.map((row) => row.id));
  const teamIds = new Set(
    employees.map((row) => row.teamId).filter((id): id is number => id != null),
  );
  const departmentIds = new Set(
    employees.map((row) => row.departmentId).filter((id): id is number => id != null),
  );
  const enterpriseIds = new Set(
    employees.map((row) => row.enterpriseId).filter((id): id is number => id != null),
  );
  const useTargets = new Set<number>();
  const edges = source.edges.filter((edge) => {
    if (edge.kind === "owns") return employeeIds.has(edge.sourceId) && keyIds.has(edge.targetId);
    if (isUseEdgeKind(edge.kind)) {
      if (!keyIds.has(edge.sourceId)) return false;
      useTargets.add(edge.targetId);
      return true;
    }
    if (edge.sourceType === "enterprise" && edge.targetType === "department") {
      return enterpriseIds.has(edge.sourceId) && departmentIds.has(edge.targetId);
    }
    if (edge.sourceType === "department" && edge.targetType === "team") {
      return departmentIds.has(edge.sourceId) && teamIds.has(edge.targetId);
    }
    if (edge.sourceType === "department" && edge.targetType === "employee") {
      return departmentIds.has(edge.sourceId) && employeeIds.has(edge.targetId);
    }
    if (edge.sourceType === "enterprise" && edge.targetType === "team") {
      return enterpriseIds.has(edge.sourceId) && teamIds.has(edge.targetId);
    }
    if (edge.sourceType === "team" && edge.targetType === "employee") {
      return teamIds.has(edge.sourceId) && employeeIds.has(edge.targetId);
    }
    if (edge.sourceType === "enterprise" && edge.targetType === "employee") {
      return enterpriseIds.has(edge.sourceId) && employeeIds.has(edge.targetId);
    }
    return false;
  });
  return {
    ...source,
    employees,
    departments: (source.departments ?? []).filter((row) => departmentIds.has(row.id)),
    teams: source.teams.filter((row) => teamIds.has(row.id)),
    virtualKeys,
    credentials: source.credentials.filter((row) => useTargets.has(row.id)),
    edges,
    enterprises: source.enterprises.filter((row) => enterpriseIds.has(row.id)),
  };
}

function orgEdgesForGroupedEmployees(
  employees: GraphEmployee[],
  selection: OrgFilterSelection,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const push = (edge: GraphEdge) => {
    if (seen.has(edge.id)) return;
    seen.add(edge.id);
    edges.push(edge);
  };
  for (const employee of employees) {
    if (selection.kind === "enterprise" && employee.enterpriseId != null && employee.departmentId != null) {
      push({
        id: `org:ent:${employee.enterpriseId}:dept:${employee.departmentId}`,
        sourceType: "enterprise",
        sourceId: employee.enterpriseId,
        targetType: "department",
        targetId: employee.departmentId,
        kind: "org",
      });
    }
    if (employee.departmentId != null) {
      push({
        id: `org:dept:${employee.departmentId}:emp:${employee.id}`,
        sourceType: "department",
        sourceId: employee.departmentId,
        targetType: "employee",
        targetId: employee.id,
        kind: "org",
      });
    } else if (employee.enterpriseId != null) {
      push({
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

function graphForOrgSelection(
  source: KeyBindingGraph,
  selection: OrgFilterSelection,
): { graph: KeyBindingGraph; title: string; enterpriseTitle: string; scope: CanvasScope; depth: CanvasDepth } {
  const departments = orgFilterDepartments.value;
  const subtree = subtreeIdsForSelection(selection, departments);
  const employees = source.employees.filter((employee) =>
    employeeInOrgSelection(employee, selection, subtree),
  );
  const grouped = employees.map((employee) => {
    const groupedId = groupingDepartmentId(employee.departmentId, selection, departments);
    const department = groupedId != null
      ? (source.departments ?? []).find((row) => row.id === groupedId)
      : undefined;
    return {
      ...employee,
      departmentId: groupedId,
      departmentName: department?.name ?? employee.departmentName,
    };
  });
  const scoped = subgraphForEmployees(source, grouped);
  const departmentIds = new Set(
    grouped.map((row) => row.departmentId).filter((id): id is number => id != null),
  );
  if (selection.kind === "department") departmentIds.add(selection.departmentId);
  scoped.departments = (source.departments ?? []).filter((row) => departmentIds.has(row.id));
  if (
    selection.enterpriseId != null
    && !scoped.enterprises.some((row) => row.id === selection.enterpriseId)
  ) {
    const enterprise = source.enterprises.find((row) => row.id === selection.enterpriseId);
    if (enterprise) scoped.enterprises = [...scoped.enterprises, enterprise];
  }
  scoped.edges = [
    ...orgEdgesForGroupedEmployees(grouped, selection),
    ...scoped.edges.filter((edge) => edge.kind !== "org"),
  ];
  const enterpriseTitle = source.enterprises.find((row) => row.id === selection.enterpriseId)?.name || "企业";
  const title = selection.kind === "department"
    ? (source.departments ?? []).find((row) => row.id === selection.departmentId)?.name || "部门"
    : enterpriseTitle;
  return {
    graph: scoped,
    title,
    enterpriseTitle,
    scope: {
      enterpriseId: selection.enterpriseId,
      departmentId: selection.kind === "department" ? selection.departmentId : null,
      teamId: null,
    },
    depth: selection.kind === "enterprise" ? "enterprise" : "department",
  };
}

function makeNode(type: NodeKind, id: number, x: number, y: number, data: Record<string, unknown>): Node {
  return {
    id: nodeId(type, id),
    type,
    position: { x, y },
    data: { ...data, dimmed: false, active: false },
    draggable: false,
    connectable: false,
  };
}

function layoutGraph(
  source: KeyBindingGraph,
  mode: "enterprise" | "pool" = "enterprise",
  viewDepth: CanvasDepth = "enterprise",
): { nodes: Node[]; edges: Edge[] } {
  const keysByEmployee = new Map<number, GraphVirtualKey[]>();
  for (const key of source.virtualKeys) {
    const list = keysByEmployee.get(key.employeeId) ?? [];
    list.push(key);
    keysByEmployee.set(key.employeeId, list);
  }

  const departmentById = new Map((source.departments ?? []).map((row) => [row.id, row]));
  const teamById = new Map(source.teams.map((row) => [row.id, row]));
  const employees = [...source.employees].sort((a, b) => {
    const ent = (a.enterpriseName ?? "").localeCompare(b.enterpriseName ?? "", "zh");
    if (ent !== 0) return ent;
    const dept = (a.departmentName ?? "").localeCompare(b.departmentName ?? "", "zh");
    if (dept !== 0) return dept;
    const team = (a.teamName ?? "").localeCompare(b.teamName ?? "", "zh");
    if (team !== 0) return team;
    return a.name.localeCompare(b.name, "zh");
  });

  type EmpBlock = { employee: GraphEmployee; keys: GraphVirtualKey[]; height: number };
  type TeamBlock = { team: GraphTeam | null; employees: EmpBlock[]; height: number };
  type DeptBlock = { department: GraphDepartment | null; teams: TeamBlock[]; height: number };
  type EntBlock = {
    enterpriseId: number | null;
    enterpriseName: string;
    departments: DeptBlock[];
    height: number;
  };

  const originX =
    viewDepth === "team"
      ? COL_X.team
      : viewDepth === "department"
        ? COL_X.department
        : COL_X.enterprise;
  const colX = (column: keyof typeof COL_X) => COL_X[column] - originX;
  const showEnterprise = viewDepth === "enterprise";
  const showDepartment = viewDepth === "enterprise" || viewDepth === "department";

  const empBlocks = (list: GraphEmployee[]): EmpBlock[] =>
    list.map((employee) => {
      const keys = keysByEmployee.get(employee.id) ?? [];
      const stack = Math.max(keys.length, 1);
      return {
        employee,
        keys,
        height: stack * NODE_H + (stack - 1) * NODE_GAP,
      };
    });

  const byEnterprise = new Map<number | "none", GraphEmployee[]>();
  for (const employee of employees) {
    const key = employee.enterpriseId ?? "none";
    const list = byEnterprise.get(key) ?? [];
    list.push(employee);
    byEnterprise.set(key, list);
  }

  const entBlocks: EntBlock[] = [];
  if (employees.length === 0) {
    for (const department of source.departments ?? []) {
      const enterpriseName = source.enterprises.find((row) => row.id === department.enterpriseId)?.name
        || "未加入企业";
      entBlocks.push({
        enterpriseId: department.enterpriseId,
        enterpriseName,
        departments: [{ department, teams: [], height: NODE_H }],
        height: NODE_H,
      });
    }
  }
  for (const [enterpriseKey, entEmployees] of byEnterprise) {
    const byDepartment = new Map<number | "none", GraphEmployee[]>();
    for (const employee of entEmployees) {
      const key = employee.departmentId ?? "none";
      const list = byDepartment.get(key) ?? [];
      list.push(employee);
      byDepartment.set(key, list);
    }
    const departments: DeptBlock[] = [];
    for (const [departmentKey, deptEmployees] of byDepartment) {
      const byTeam = new Map<number | "none", GraphEmployee[]>();
      for (const employee of deptEmployees) {
        const team = employee.teamId == null ? undefined : teamById.get(employee.teamId);
        const hiddenTeam = Boolean(
          employee.teamIsDefault
          || team?.isDefault
          || employee.teamName === "默认团队"
          || team?.name === "默认团队",
        );
        const key = employee.teamId == null || hiddenTeam ? "none" : employee.teamId;
        const list = byTeam.get(key) ?? [];
        list.push(employee);
        byTeam.set(key, list);
      }
      const teams: TeamBlock[] = [];
      const teamEntries = [...byTeam.entries()].sort((a, b) => {
        if (a[0] === "none") return 1;
        if (b[0] === "none") return -1;
        const nameA = teamById.get(a[0])?.name ?? "";
        const nameB = teamById.get(b[0])?.name ?? "";
        return nameA.localeCompare(nameB, "zh");
      });
      for (const [teamKey, teamEmployees] of teamEntries) {
        const blocks = empBlocks(teamEmployees);
        const height =
          blocks.reduce((sum, block) => sum + block.height, 0) +
          Math.max(0, blocks.length - 1) * NODE_GAP;
        teams.push({
          team: teamKey === "none" ? null : teamById.get(teamKey) ?? null,
          employees: blocks,
          height: Math.max(height, NODE_H),
        });
      }
      const height =
        teams.reduce((sum, block) => sum + block.height, 0) +
        Math.max(0, teams.length - 1) * GROUP_GAP;
      departments.push({
        department: departmentKey === "none" ? null : departmentById.get(departmentKey) ?? null,
        teams,
        height: Math.max(height, NODE_H),
      });
    }
    const height =
      departments.reduce((sum, block) => sum + block.height, 0) +
      Math.max(0, departments.length - 1) * GROUP_GAP;
    entBlocks.push({
      enterpriseId: enterpriseKey === "none" ? null : enterpriseKey,
      enterpriseName: entEmployees[0]?.enterpriseName || "未加入企业",
      departments,
      height: Math.max(height, NODE_H),
    });
  }

  const laidNodes: Node[] = [];
  const virtualKeyY = new Map<number, number>();
  let cursor = 0;
  if (mode === "enterprise") for (const ent of entBlocks) {
    if (showEnterprise && ent.enterpriseId != null) {
      laidNodes.push(
        makeNode(
          "enterprise",
          ent.enterpriseId,
          colX("enterprise"),
          cursor + Math.max(0, (ent.height - NODE_H) / 2),
          { id: ent.enterpriseId, name: ent.enterpriseName },
        ),
      );
    }
    let deptCursor = cursor;
    for (const dept of ent.departments) {
      if (showDepartment && dept.department) {
        laidNodes.push(
          makeNode(
            "department",
            dept.department.id,
            colX("department"),
            deptCursor + Math.max(0, (dept.height - NODE_H) / 2),
            {
              ...dept.department,
              root: viewDepth === "department",
              enterpriseName: ent.enterpriseName,
            },
          ),
        );
      }
      let teamCursor = deptCursor;
      for (const team of dept.teams) {
        if (team.team) {
          laidNodes.push(
            makeNode(
              "team",
              team.team.id,
              colX("team"),
              teamCursor + Math.max(0, (team.height - NODE_H) / 2),
              team.team,
            ),
          );
        }
        let empCursor = teamCursor;
        for (const emp of team.employees) {
          laidNodes.push(
            makeNode(
              "employee",
              emp.employee.id,
              colX("employee"),
              empCursor + Math.max(0, (emp.height - NODE_H) / 2),
              emp.employee,
            ),
          );
          emp.keys.forEach((key, index) => {
            const y = empCursor + index * (NODE_H + NODE_GAP);
            virtualKeyY.set(key.id, y);
            laidNodes.push(
              makeNode("virtual_key", key.id, colX("virtual_key"), y, key),
            );
          });
          empCursor += emp.height + NODE_GAP;
        }
        teamCursor += team.height + GROUP_GAP;
      }
      deptCursor += dept.height + GROUP_GAP;
    }
    cursor += ent.height + GROUP_GAP;
  }

  const boundIds = boundCredentialIds(source);
  const credentialsByLane: Record<CredentialLane, GraphCredential[]> = {
    bound: [],
    pending: [],
    cooling_5h: [],
    cooling_weekly: [],
    disabled: [],
  };
  for (const credential of source.credentials) {
    credentialsByLane[credentialLane(credential, boundIds)].push(credential);
  }

  const boundTargets = new Map<number, number[]>();
  for (const edge of source.edges) {
    if (!isScheduledUseKind(edge.kind)) continue;
    const ys = boundTargets.get(edge.targetId) ?? [];
    const y = virtualKeyY.get(edge.sourceId);
    if (y != null) ys.push(y);
    boundTargets.set(edge.targetId, ys);
  }

  const boundPlacements = credentialsByLane.bound
    .map((credential) => {
      const ys = boundTargets.get(credential.id) ?? [];
      const desiredY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
      return { credential, desiredY };
    })
    .sort((a, b) => a.desiredY - b.desiredY || a.credential.id - b.credential.id);

  if (mode === "enterprise") {
    let boundCursor = Number.NEGATIVE_INFINITY;
    for (const item of boundPlacements) {
      const y = Number.isFinite(boundCursor)
        ? Math.max(item.desiredY, boundCursor)
        : item.desiredY;
      laidNodes.push(
        makeNode("credential", item.credential.id, colX("bound"), y, {
          ...item.credential,
          lane: "bound",
        }),
      );
      boundCursor = y + NODE_H + NODE_GAP;
    }
  }

  if (mode === "pool") {
    for (const header of STATUS_HEADERS) {
      laidNodes.push({
        id: `header:${header.key}`,
        type: "lane_header",
        position: { x: COL_X[header.key] - COL_X.pending, y: -72 },
        data: { label: header.label, dimmed: false, active: false },
        draggable: false,
        selectable: false,
        connectable: false,
      });
    }
    for (const lane of ["pending", "cooling_5h", "cooling_weekly", "disabled"] as const) {
      let laneCursor = 0;
      for (const credential of credentialsByLane[lane]) {
        laidNodes.push(
          makeNode("credential", credential.id, COL_X[lane] - COL_X.pending, laneCursor, {
            ...credential,
            lane,
          }),
        );
        laneCursor += NODE_H + NODE_GAP;
      }
    }
  }

  const visibleIds = new Set(laidNodes.map((node) => node.id));
  const laidEdges: Edge[] = source.edges
    .filter((edge) => edge.kind === "org" || edge.kind === "owns" || isScheduledUseKind(edge.kind))
    .map((edge) => {
      const useEdge = isUseEdgeKind(edge.kind);
      return {
        id: edge.id,
        source: nodeId(edge.sourceType, edge.sourceId),
        target: nodeId(edge.targetType, edge.targetId),
        type: useEdge ? "smoothstep" : "step",
        animated: false,
        markerEnd: MarkerType.ArrowClosed,
        pathOptions: { offset: 28, borderRadius: 8 },
        style: useEdgeStyle(edge.kind),
        data: {
          kind: edge.kind,
          working: false,
          afterglow: false,
          inFlight: 0,
          dimmed: false,
        },
      };
    })
    .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));

  return { nodes: laidNodes, edges: laidEdges };
}

function parseNodeNumericId(id: string): number | null {
  const value = Number(id.slice(id.indexOf(":") + 1));
  return Number.isSafeInteger(value) ? value : null;
}

function boardKeyForSelection(selection: OrgFilterSelection): string {
  return selection.kind === "department"
    ? `ent:${selection.enterpriseId}:dept:${selection.departmentId}`
    : `ent:${selection.enterpriseId}`;
}

function renderGraph() {
  if (!graph.value) {
    boards.value = [];
    activeBoardKey.value = "";
    return;
  }
  const selection = orgFilterSelection.value;
  if (!selection) {
    boards.value = [];
    activeBoardKey.value = "";
    return;
  }
  const item = graphForOrgSelection(graph.value, selection);
  const laid = layoutGraph(item.graph, "enterprise", item.depth);
  const board: CanvasBoard = {
    key: boardKeyForSelection(selection),
    title: item.title,
    enterpriseTitle: item.enterpriseTitle,
    mode: "enterprise",
    scope: item.scope,
    nodes: laid.nodes,
    edges: laid.edges,
  };
  boards.value = [board];
  activeBoardKey.value = board.key;
}

function onTabChange() {
  selectedNodeId.value = null;
  selectedBoardKey.value = null;
  credentialOpen.value = false;
}

function onNodeClick(boardKey: string, event: NodeMouseEvent) {
  if (selectedBoardKey.value === boardKey && selectedNodeId.value === event.node.id) {
    selectedBoardKey.value = null;
    selectedNodeId.value = null;
    credentialOpen.value = false;
  } else {
    selectedBoardKey.value = boardKey;
    selectedNodeId.value = event.node.id;
    credentialOpen.value = event.node.type === "credential";
  }
}

function onPaneClick(boardKey: string) {
  if (selectedBoardKey.value !== boardKey) return;
  selectedBoardKey.value = null;
  selectedNodeId.value = null;
  credentialOpen.value = false;
}

async function releaseSelectedCredential() {
  const credential = selectedCredential.value;
  if (!credential?.binding) return;
  try {
    await ElMessageBox.confirm(
      "释放后，该渠道 Key 会回到资源列表。正在使用它的员工下次请求时会重新从资源池挂 Key。",
      "释放渠道 Key",
      { type: "warning", confirmButtonText: "释放", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  releasing.value = true;
  try {
    const { data } = await http.post(`/api/admin/key-bindings/credentials/${credential.id}/release`);
    if (!data.success) {
      throw new Error(data.message || "释放失败");
    }
    ElMessage.success("已释放到资源列表");
    credentialOpen.value = false;
    selectedNodeId.value = null;
    selectedBoardKey.value = null;
    await load();
    resourceOpen.value = true;
  } catch (error) {
    const err = error as { response?: { data?: { message?: string } }; message?: string };
    ElMessage.error(err.response?.data?.message || err.message || "释放失败");
  } finally {
    releasing.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    const [bindingsRes, teamsRes, departmentsRes] = await Promise.all([
      http.get("/api/admin/key-bindings"),
      http.get("/api/admin/teams").catch(() => ({ data: { success: false, data: [] } })),
      http.get("/api/admin/departments").catch(() => ({ data: { success: false, data: [] } })),
    ]);
    if (!bindingsRes.data.success) {
      throw new Error(bindingsRes.data.message || "加载失败");
    }
    graph.value = hydrateOrgChain(
      bindingsRes.data.data as KeyBindingGraph,
      (teamsRes.data.success ? teamsRes.data.data : []) as TeamLookup[],
      (departmentsRes.data.success ? departmentsRes.data.data : []) as DepartmentLookup[],
    );
    selectedNodeId.value = null;
    selectedBoardKey.value = null;
    credentialOpen.value = false;
    if (!parseOrgFilterPath(orgFilterPath.value)) {
      const firstEnterprise = graph.value.enterprises[0];
      orgFilterPath.value = firstEnterprise ? [enterpriseCascaderValue(firstEnterprise.id)] : [];
    }
    renderGraph();
  } catch (error) {
    const err = error as { response?: { data?: { message?: string } }; message?: string };
    ElMessage.error(err.response?.data?.message || err.message || "绑定关系加载失败");
  } finally {
    loading.value = false;
  }
}

let liveTimer: ReturnType<typeof setInterval> | null = null;

async function pollLive() {
  if (typeof document !== "undefined" && document.hidden) return;
  try {
    const { data } = await http.get("/api/admin/key-bindings/live");
    if (!data.success) return;
    const stamp = JSON.stringify(data.data);
    if (stamp === lastLiveStamp) return;
    lastLiveStamp = stamp;
    lastLive.value = data.data;
  } catch {
    // Keep the last snapshot; a missed poll should not toast.
  }
}

function startLivePolling() {
  stopLivePolling();
  void pollLive();
  liveTimer = setInterval(() => {
    void pollLive();
  }, LIVE_POLL_MS);
}

function stopLivePolling() {
  if (!liveTimer) return;
  clearInterval(liveTimer);
  liveTimer = null;
}

function onVisibilityChange() {
  if (document.hidden) return;
  void pollLive();
}

watch(orgFilterPath, () => {
  if (loading.value) return;
  renderGraph();
  onTabChange();
});

onMounted(() => {
  void load();
  startLivePolling();
  document.addEventListener("visibilitychange", onVisibilityChange);
});

onUnmounted(() => {
  stopLivePolling();
  document.removeEventListener("visibilitychange", onVisibilityChange);
});
</script>

<style scoped>
.bindings-page {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: #f8fafc;
}

.bindings-page .el-empty {
  margin: auto;
}

.fab-stack {
  position: absolute;
  right: 24px;
  bottom: 24px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}

.fab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: #fff;
  color: #0f172a;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
  cursor: pointer;
}

.fab.primary {
  border-color: #111827;
  background: #111827;
  color: #fff;
}

.fab.active {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
}

.fab-count {
  min-width: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: #e2e8f0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.fab.active .fab-count {
  background: #dbeafe;
}

.resource-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.resource-row {
  padding: 12px 14px;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  background: #f8fafc;
}

.resource-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.resource-top strong {
  color: #0f172a;
  font-size: 14px;
}

.resource-meta {
  display: flex;
  gap: 12px;
  margin-top: 6px;
  color: #94a3b8;
  font-size: 12px;
}

.resource-meta .mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #475569;
}

.detail-block {
  margin-bottom: 20px;
}

.detail-block h3 {
  margin: 0 0 8px;
  color: #0f172a;
  font-size: 13px;
  font-weight: 650;
}

.detail-block p {
  margin: 0;
  color: #334155;
  font-size: 13px;
}

.detail-block .muted {
  color: #94a3b8;
}

.quota-list {
  display: grid;
  gap: 8px;
  margin: 0 0 12px;
}

.quota-list div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.quota-list dt {
  color: #64748b;
  font-size: 12px;
}

.quota-list dd {
  margin: 0;
  color: #0f172a;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.user-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.user-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  background: #f8fafc;
}

.user-list strong {
  color: #0f172a;
  font-size: 13px;
}

.user-list span {
  color: #64748b;
  font-size: 12px;
}
</style>
