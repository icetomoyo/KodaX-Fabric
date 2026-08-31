<template>
  <div class="bindings-page">
    <section class="page-card toolbar-card">
      <div class="page-head">
        <div>
          <h2 class="page-title">Key 绑定</h2>
          <p class="page-subtitle">
            企业 → 团队 → 员工 → 虚拟 Key → 智谱 Key（绑定）→ 待绑定 → 冷却中 → 停用
          </p>
        </div>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>

      <div class="filters">
        <el-select v-model="productLineId" clearable placeholder="全部渠道" class="filter-item">
          <el-option
            v-for="channel in channels"
            :key="channel.id"
            :label="channel.name"
            :value="channel.id"
          />
        </el-select>
        <el-select v-model="enterpriseId" clearable placeholder="全部企业" class="filter-item">
          <el-option
            v-for="enterprise in enterprises"
            :key="enterprise.id"
            :label="enterprise.name"
            :value="enterprise.id"
          />
        </el-select>
        <el-select v-model="bindingKind" class="filter-item">
          <el-option label="全部绑定" value="all" />
          <el-option label="仅指定授权" value="grant" />
          <el-option label="仅公共池" value="pool" />
        </el-select>
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索企业 / 团队 / 员工 / Key"
          class="filter-search"
        />
      </div>

      <div class="legend">
        <span class="legend-item"><i class="swatch enterprise" />企业</span>
        <span class="legend-item"><i class="swatch team" />团队</span>
        <span class="legend-item"><i class="swatch employee" />员工</span>
        <span class="legend-item"><i class="tier-dot light" />轻度</span>
        <span class="legend-item"><i class="tier-dot standard" />标准</span>
        <span class="legend-item"><i class="tier-dot heavy" />重度</span>
        <span class="legend-item"><i class="swatch virtual" />虚拟 Key</span>
        <span class="legend-item"><i class="swatch bound" />绑定</span>
        <span class="legend-item"><i class="swatch pending" />待绑定</span>
        <span class="legend-item"><i class="swatch cooling" />冷却中</span>
        <span class="legend-item"><i class="swatch disabled" />停用</span>
        <span class="legend-item"><i class="line grant" />指定授权</span>
        <span class="legend-item"><i class="line pool" />公共池</span>
        <span class="legend-count">
          {{ displayedEnterprises }} 家企业 ·
          {{ displayed?.teams.length ?? 0 }} 个团队 ·
          {{ displayed?.employees.length ?? 0 }} 人 ·
          {{ displayed?.virtualKeys.length ?? 0 }} 把虚拟 Key ·
          绑定 {{ credentialLaneCounts.bound }} ·
          待绑定 {{ credentialLaneCounts.pending }} ·
          冷却 {{ credentialLaneCounts.cooling }} ·
          停用 {{ credentialLaneCounts.disabled }}
        </span>
      </div>
    </section>

    <section class="page-card canvas-card" v-loading="loading">
      <el-empty
        v-if="!loading && !nodes.length"
        description="没有可展示的绑定关系"
        :image-size="88"
      />
      <VueFlow
        v-else
        v-model:nodes="nodes"
        v-model:edges="edges"
        :min-zoom="0.15"
        :max-zoom="1.6"
        :default-viewport="{ zoom: 0.45 }"
        :nodes-connectable="false"
        :edges-updatable="false"
        :elements-selectable="true"
        fit-view-on-init
        @node-click="onNodeClick"
        @pane-click="clearHighlight"
        @init="onFlowInit"
      >
        <template #node-enterprise="{ data }">
          <div class="graph-node enterprise" :class="{ dimmed: data.dimmed, active: data.active }">
            <Handle type="source" :position="Position.Right" :connectable="false" />
            <strong>{{ data.name }}</strong>
            <span>企业</span>
          </div>
        </template>
        <template #node-team="{ data }">
          <div class="graph-node team" :class="{ dimmed: data.dimmed, active: data.active }">
            <Handle type="target" :position="Position.Left" :connectable="false" />
            <Handle type="source" :position="Position.Right" :connectable="false" />
            <strong>{{ data.name }}</strong>
            <span>团队</span>
          </div>
        </template>
        <template #node-employee="{ data }">
          <div class="graph-node employee" :class="{ dimmed: data.dimmed, active: data.active }">
            <Handle type="target" :position="Position.Left" :connectable="false" />
            <Handle type="source" :position="Position.Right" :connectable="false" />
            <strong>{{ data.name }}</strong>
            <span class="tier" :class="data.usageTier">{{ usageTierLabel(data.usageTier) }}</span>
          </div>
        </template>
        <template #node-virtual_key="{ data }">
          <div class="graph-node virtual" :class="{ dimmed: data.dimmed, active: data.active }">
            <Handle type="target" :position="Position.Left" :connectable="false" />
            <Handle type="source" :position="Position.Right" :connectable="false" />
            <strong>{{ data.name }}</strong>
            <span class="mono">{{ data.keyPrefix }}…</span>
            <span>{{ protocolLabel(data.protocol) }} · {{ data.productLineName }}</span>
          </div>
        </template>
        <template #node-lane_header="{ data }">
          <div class="lane-header">{{ data.label }}</div>
        </template>
        <template #node-credential="{ data }">
          <div
            class="graph-node credential"
            :class="[data.lane, { dimmed: data.dimmed, active: data.active }]"
          >
            <Handle type="target" :position="Position.Left" :connectable="false" />
            <strong>{{ data.label }}</strong>
            <span class="mono">…{{ data.secretSuffix }}</span>
            <span>{{ data.productLineName }} · {{ credentialLaneLabel(data.lane) }}</span>
          </div>
        </template>
        <Background :gap="18" pattern-color="#e5e7eb" />
        <Controls />
      </VueFlow>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  VueFlow,
  Handle,
  Position,
  MarkerType,
  type Edge,
  type Node,
  type NodeMouseEvent,
  type VueFlowStore,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { relayProtocolLabel } from "@/views/relay-protocol";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

type BindingKind = "org" | "owns" | "grant" | "pool";
type KindFilter = "all" | "grant" | "pool";
type NodeKind = "enterprise" | "team" | "employee" | "virtual_key" | "credential" | "lane_header";
type CredentialLane = "bound" | "pending" | "cooling" | "disabled";

type UsageTier = "light" | "standard" | "heavy";

type GraphEmployee = {
  id: number;
  name: string;
  enterpriseId: number | null;
  enterpriseName: string | null;
  teamId: number | null;
  teamName: string | null;
  usageTier?: UsageTier;
};

type GraphTeam = {
  id: number;
  name: string;
  enterpriseId: number | null;
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

type GraphCredential = {
  id: number;
  label: string;
  secretSuffix: string;
  productLineId: number;
  productLineName: string;
  providerCode: string;
  providerName: string;
  status: "active" | "disabled" | "auto_disabled" | "cooling";
  supportedProtocols: string[];
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
  teams: GraphTeam[];
  virtualKeys: GraphVirtualKey[];
  credentials: GraphCredential[];
  edges: GraphEdge[];
  channels: Array<{ id: number; name: string; providerCode: string; providerName: string }>;
  enterprises: Array<{ id: number; name: string }>;
};

const COL_X = {
  enterprise: 0,
  team: 360,
  employee: 720,
  virtual_key: 1080,
  bound: 1440,
  pending: 1800,
  cooling: 2160,
  disabled: 2520,
} as const;

const STATUS_HEADERS: Array<{ key: "pending" | "cooling" | "disabled"; label: string }> = [
  { key: "pending", label: "待绑定" },
  { key: "cooling", label: "冷却中" },
  { key: "disabled", label: "停用" },
];
const NODE_H = 92;
const NODE_GAP = 40;
const GROUP_GAP = 72;

const loading = ref(false);
const graph = ref<KeyBindingGraph | null>(null);
const productLineId = ref<number | undefined>();
const enterpriseId = ref<number | undefined>();
const bindingKind = ref<KindFilter>("all");
const keyword = ref("");
const selectedNodeId = ref<string | null>(null);
const nodes = ref<Node[]>([]);
const edges = ref<Edge[]>([]);

const channels = computed(() => graph.value?.channels ?? []);
const enterprises = computed(() => graph.value?.enterprises ?? []);
const displayed = computed(() =>
  graph.value ? visibleGraph(graph.value, bindingKind.value) : null,
);
const displayedEnterprises = computed(() => {
  const ids = new Set(
    (displayed.value?.employees ?? [])
      .map((row) => row.enterpriseId)
      .filter((id): id is number => id != null),
  );
  return ids.size;
});
const credentialLaneCounts = computed(() => {
  const source = displayed.value;
  const empty = { bound: 0, pending: 0, cooling: 0, disabled: 0 };
  if (!source) return empty;
  const boundIds = boundCredentialIds(source);
  for (const credential of source.credentials) {
    empty[credentialLane(credential, boundIds)] += 1;
  }
  return empty;
});

function nodeId(type: NodeKind, id: number): string {
  return `${type}:${id}`;
}

function protocolLabel(protocol: string): string {
  return relayProtocolLabel(protocol, true);
}

function usageTierLabel(tier: UsageTier | undefined): string {
  if (tier === "light") return "轻度用户";
  if (tier === "heavy") return "重度用户";
  return "标准用户";
}

function credentialLaneLabel(lane: CredentialLane | undefined): string {
  if (lane === "pending") return "待绑定";
  if (lane === "cooling") return "冷却中";
  if (lane === "disabled") return "停用";
  return "绑定";
}

function boundCredentialIds(source: KeyBindingGraph): Set<number> {
  const keyIds = new Set(source.virtualKeys.map((row) => row.id));
  const ids = new Set<number>();
  for (const edge of source.edges) {
    if (edge.kind !== "grant" && edge.kind !== "pool") continue;
    if (!keyIds.has(edge.sourceId)) continue;
    ids.add(edge.targetId);
  }
  return ids;
}

function credentialLane(
  credential: GraphCredential,
  boundIds: Set<number>,
): CredentialLane {
  if (credential.status === "cooling") return "cooling";
  if (credential.status === "disabled" || credential.status === "auto_disabled") return "disabled";
  if (boundIds.has(credential.id)) return "bound";
  return "pending";
}

function visibleGraph(source: KeyBindingGraph, kind: KindFilter): KeyBindingGraph {
  if (kind === "all") return source;
  const useEdges = source.edges.filter((edge) => edge.kind === kind);
  const keyIds = new Set(useEdges.map((edge) => edge.sourceId));
  const credentialIds = new Set(useEdges.map((edge) => edge.targetId));
  const virtualKeys = source.virtualKeys.filter((row) => keyIds.has(row.id));
  const employeeIds = new Set(virtualKeys.map((row) => row.employeeId));
  const employees = source.employees.filter((row) => employeeIds.has(row.id));
  const teamIds = new Set(
    employees.map((row) => row.teamId).filter((id): id is number => id != null),
  );
  const teams = source.teams.filter((row) => teamIds.has(row.id));
  const kept = {
    enterprise: new Set(
      employees.map((row) => row.enterpriseId).filter((id): id is number => id != null),
    ),
    team: teamIds,
    employee: employeeIds,
    virtual_key: keyIds,
    credential: new Set(source.credentials.map((row) => row.id)),
    lane_header: new Set<number>(),
  };
  return {
    ...source,
    employees,
    teams,
    virtualKeys,
    credentials: source.credentials,
    edges: source.edges.filter((edge) => {
      if (edge.kind === "grant" || edge.kind === "pool") return useEdges.includes(edge);
      if (edge.kind === "owns") return keyIds.has(edge.targetId);
      return kept[edge.sourceType].has(edge.sourceId) && kept[edge.targetType].has(edge.targetId);
    }),
  };
}

function makeNode(type: NodeKind, id: number, x: number, y: number, data: Record<string, unknown>): Node {
  return {
    id: nodeId(type, id),
    type,
    position: { x, y },
    data: { ...data, dimmed: false, active: false },
    draggable: true,
    connectable: false,
  };
}

function layoutGraph(source: KeyBindingGraph): { nodes: Node[]; edges: Edge[] } {
  const keysByEmployee = new Map<number, GraphVirtualKey[]>();
  for (const key of source.virtualKeys) {
    const list = keysByEmployee.get(key.employeeId) ?? [];
    list.push(key);
    keysByEmployee.set(key.employeeId, list);
  }

  const teamById = new Map(source.teams.map((row) => [row.id, row]));
  const employees = [...source.employees].sort((a, b) => {
    const ent = (a.enterpriseName ?? "").localeCompare(b.enterpriseName ?? "", "zh");
    if (ent !== 0) return ent;
    const team = (a.teamName ?? "").localeCompare(b.teamName ?? "", "zh");
    if (team !== 0) return team;
    return a.name.localeCompare(b.name, "zh");
  });

  type EmpBlock = { employee: GraphEmployee; keys: GraphVirtualKey[]; height: number };
  type TeamBlock = { team: GraphTeam | null; employees: EmpBlock[]; height: number };
  type EntBlock = {
    enterpriseId: number | null;
    enterpriseName: string;
    teams: TeamBlock[];
    height: number;
  };

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
  for (const [enterpriseKey, entEmployees] of byEnterprise) {
    const byTeam = new Map<number | "none", GraphEmployee[]>();
    for (const employee of entEmployees) {
      const key = employee.teamId ?? "none";
      const list = byTeam.get(key) ?? [];
      list.push(employee);
      byTeam.set(key, list);
    }
    const teams: TeamBlock[] = [];
    for (const [teamKey, teamEmployees] of byTeam) {
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
    entBlocks.push({
      enterpriseId: enterpriseKey === "none" ? null : enterpriseKey,
      enterpriseName: entEmployees[0]?.enterpriseName || "未加入企业",
      teams,
      height: Math.max(height, NODE_H),
    });
  }

  const laidNodes: Node[] = [];
  for (const header of STATUS_HEADERS) {
    laidNodes.push({
      id: `header:${header.key}`,
      type: "lane_header",
      position: { x: COL_X[header.key], y: -72 },
      data: { label: header.label, dimmed: false, active: false },
      draggable: false,
      selectable: false,
      connectable: false,
    });
  }
  const virtualKeyY = new Map<number, number>();
  let cursor = 0;
  for (const ent of entBlocks) {
    if (ent.enterpriseId != null) {
      laidNodes.push(
        makeNode(
          "enterprise",
          ent.enterpriseId,
          COL_X.enterprise,
          cursor + Math.max(0, (ent.height - NODE_H) / 2),
          { id: ent.enterpriseId, name: ent.enterpriseName },
        ),
      );
    }
    let teamCursor = cursor;
    for (const team of ent.teams) {
      if (team.team) {
        laidNodes.push(
          makeNode(
            "team",
            team.team.id,
            COL_X.team,
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
            COL_X.employee,
            empCursor + Math.max(0, (emp.height - NODE_H) / 2),
            emp.employee,
          ),
        );
        emp.keys.forEach((key, index) => {
          const y = empCursor + index * (NODE_H + NODE_GAP);
          virtualKeyY.set(key.id, y);
          laidNodes.push(
            makeNode("virtual_key", key.id, COL_X.virtual_key, y, key),
          );
        });
        empCursor += emp.height + NODE_GAP;
      }
      teamCursor += team.height + GROUP_GAP;
    }
    cursor += ent.height + GROUP_GAP;
  }

  const boundIds = boundCredentialIds(source);
  const credentialsByLane: Record<CredentialLane, GraphCredential[]> = {
    bound: [],
    pending: [],
    cooling: [],
    disabled: [],
  };
  for (const credential of source.credentials) {
    credentialsByLane[credentialLane(credential, boundIds)].push(credential);
  }

  const boundTargets = new Map<number, number[]>();
  for (const edge of source.edges) {
    if (edge.kind !== "grant" && edge.kind !== "pool") continue;
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

  let boundCursor = Number.NEGATIVE_INFINITY;
  for (const item of boundPlacements) {
    const y = Number.isFinite(boundCursor)
      ? Math.max(item.desiredY, boundCursor)
      : item.desiredY;
    laidNodes.push(
      makeNode("credential", item.credential.id, COL_X.bound, y, {
        ...item.credential,
        lane: "bound",
      }),
    );
    boundCursor = y + NODE_H + NODE_GAP;
  }

  for (const lane of ["pending", "cooling", "disabled"] as const) {
    let laneCursor = 0;
    for (const credential of credentialsByLane[lane]) {
      laidNodes.push(
        makeNode("credential", credential.id, COL_X[lane], laneCursor, {
          ...credential,
          lane,
        }),
      );
      laneCursor += NODE_H + NODE_GAP;
    }
  }

  const laidEdges: Edge[] = source.edges.map((edge) => {
    const grant = edge.kind === "grant";
    const org = edge.kind === "org" || edge.kind === "owns";
    return {
      id: edge.id,
      source: nodeId(edge.sourceType, edge.sourceId),
      target: nodeId(edge.targetType, edge.targetId),
      type: "step",
      animated: false,
      markerEnd: MarkerType.ArrowClosed,
      pathOptions: { offset: 28, borderRadius: 8 },
      style: {
        stroke: grant ? "#2563eb" : org ? "#94a3b8" : "#64748b",
        strokeWidth: grant ? 2 : 1.5,
        strokeDasharray: edge.kind === "pool" ? "6 4" : undefined,
      },
      data: { kind: edge.kind },
    };
  });

  return { nodes: laidNodes, edges: laidEdges };
}

function relatedIds(
  origin: string,
  currentEdges: Array<{ source: string; target: string }>,
): Set<string> {
  const ids = new Set<string>([origin]);
  const walk = (fromTarget: boolean) => {
    const queue = [origin];
    const seen = new Set<string>([origin]);
    while (queue.length) {
      const current = queue.shift();
      if (!current) break;
      for (const edge of currentEdges) {
        const next = fromTarget
          ? edge.target === current
            ? edge.source
            : null
          : edge.source === current
            ? edge.target
            : null;
        if (!next || seen.has(next)) continue;
        seen.add(next);
        ids.add(next);
        queue.push(next);
      }
    }
  };
  walk(false);
  walk(true);
  return ids;
}

function applyHighlight() {
  const selected = selectedNodeId.value;
  const related = selected ? relatedIds(selected, edges.value) : null;
  for (const node of nodes.value) {
    if (node.type === "lane_header") continue;
    node.data.active = node.id === selected;
    node.data.dimmed = related != null && !related.has(node.id);
  }
  for (const edge of edges.value) {
    const keep = related == null || (related.has(edge.source) && related.has(edge.target));
    edge.style = {
      ...(edge.style ?? {}),
      opacity: keep ? 1 : 0.12,
    };
  }
}

function renderGraph() {
  if (!graph.value) {
    nodes.value = [];
    edges.value = [];
    return;
  }
  const laid = layoutGraph(visibleGraph(graph.value, bindingKind.value));
  nodes.value = laid.nodes;
  edges.value = laid.edges;
  applyHighlight();
  void nextTick(() => fitGraph());
}

function onNodeClick(event: NodeMouseEvent) {
  selectedNodeId.value = event.node.id === selectedNodeId.value ? null : event.node.id;
  applyHighlight();
}

function clearHighlight() {
  selectedNodeId.value = null;
  applyHighlight();
}

let flowStore: VueFlowStore | null = null;

function onFlowInit(store: VueFlowStore) {
  flowStore = store;
  fitGraph();
}

function fitGraph() {
  flowStore?.fitView({ padding: 0.18 });
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/key-bindings", {
      params: {
        productLineId: productLineId.value || undefined,
        enterpriseId: enterpriseId.value || undefined,
        q: keyword.value.trim() || undefined,
      },
    });
    if (!data.success) {
      throw new Error(data.message || "加载失败");
    }
    graph.value = data.data;
    selectedNodeId.value = null;
    renderGraph();
  } catch (error) {
    const err = error as { response?: { data?: { message?: string } }; message?: string };
    ElMessage.error(err.response?.data?.message || err.message || "绑定关系加载失败");
  } finally {
    loading.value = false;
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch([productLineId, enterpriseId], () => {
  load();
});
watch(bindingKind, () => {
  selectedNodeId.value = null;
  renderGraph();
});
watch(keyword, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    load();
  }, 300);
});

onMounted(load);
</script>

<style scoped>
.bindings-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.page-title {
  margin: 0;
}

.page-subtitle {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 13px;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.toolbar-card {
  flex-shrink: 0;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

.filter-item {
  width: 200px;
}

.filter-search {
  width: min(320px, 100%);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-top: 14px;
  color: #64748b;
  font-size: 12px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-count {
  margin-left: auto;
}

.swatch,
.line {
  display: inline-block;
  border-radius: 999px;
}

.swatch {
  width: 10px;
  height: 10px;
}

.swatch.enterprise {
  background: #4338ca;
}

.swatch.team {
  background: #0891b2;
}

.swatch.employee {
  background: #0f766e;
}

.tier-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
}

.tier-dot.light {
  background: #64748b;
}

.tier-dot.standard {
  background: #2563eb;
}

.tier-dot.heavy {
  background: #dc2626;
}

.swatch.virtual {
  background: #2563eb;
}

.swatch.bound {
  background: #c2410c;
}

.swatch.pending {
  background: #ca8a04;
}

.swatch.cooling {
  background: #d97706;
}

.swatch.disabled {
  background: #94a3b8;
}

.line {
  width: 18px;
  height: 2px;
}

.line.grant {
  background: #2563eb;
}

.line.pool {
  background: repeating-linear-gradient(90deg, #94a3b8 0 6px, transparent 6px 10px);
}

.canvas-card {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.canvas-card :deep(.el-empty) {
  margin: auto;
}

.canvas-card :deep(.vue-flow) {
  width: 100%;
  height: 100%;
  background: #f8fafc;
}

.canvas-card :deep(.vue-flow__node) {
  width: 250px;
  height: 92px;
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  text-align: left;
}

.canvas-card :deep(.vue-flow__handle) {
  top: 46px;
  transform: translate(-50%, -50%);
}

.canvas-card :deep(.vue-flow__handle-right) {
  transform: translate(50%, -50%);
}

.graph-node {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  width: 250px;
  height: 92px;
  padding: 10px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}

.graph-node strong {
  font-size: 13px;
  font-weight: 650;
  color: #0f172a;
}

.graph-node span {
  color: #64748b;
  font-size: 12px;
  line-height: 1.35;
}

.graph-node .mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #334155;
}

.graph-node.enterprise {
  border-left: 3px solid #4338ca;
}

.graph-node.team {
  border-left: 3px solid #0891b2;
}

.graph-node.employee {
  border-left: 3px solid #0f766e;
}

.graph-node .tier {
  align-self: flex-start;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  font-style: normal;
}

.graph-node .tier.light {
  color: #475569;
  background: #f1f5f9;
}

.graph-node .tier.standard {
  color: #1d4ed8;
  background: #dbeafe;
}

.graph-node .tier.heavy {
  color: #b91c1c;
  background: #fee2e2;
}

.graph-node.virtual {
  border-left: 3px solid #2563eb;
}

.lane-header {
  width: 250px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #0f172a;
  color: #f8fafc;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.02em;
  text-align: center;
}

.graph-node.credential.bound {
  border-left: 3px solid #c2410c;
}

.graph-node.credential.pending {
  border-left: 3px solid #ca8a04;
}

.graph-node.credential.cooling {
  border-left: 3px solid #d97706;
}

.graph-node.credential.disabled {
  border-left: 3px solid #94a3b8;
  opacity: 0.78;
}

.graph-node.active {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.16);
}

.graph-node.dimmed {
  opacity: 0.22;
}

.canvas-card :deep(.vue-flow__handle) {
  width: 8px;
  height: 8px;
  border: 0;
  background: #94a3b8;
  opacity: 0.9;
}
</style>
