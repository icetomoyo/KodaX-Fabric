<template>
  <div class="bindings-page">
    <section class="page-card toolbar-card">
      <div class="page-head">
        <div>
          <h2 class="page-title">Key 绑定</h2>
          <p class="page-subtitle">员工 → 虚拟 Key → 智谱 Key，查看实际可调用关系</p>
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
          placeholder="搜索员工 / Key 前缀 / 智谱 Key"
          class="filter-search"
        />
      </div>

      <div class="legend">
        <span class="legend-item"><i class="swatch employee" />员工</span>
        <span class="legend-item"><i class="swatch virtual" />虚拟 Key</span>
        <span class="legend-item"><i class="swatch credential" />智谱 Key</span>
        <span class="legend-item"><i class="line grant" />指定授权</span>
        <span class="legend-item"><i class="line pool" />公共池</span>
        <span class="legend-count">
          {{ displayed?.employees.length ?? 0 }} 人 ·
          {{ displayed?.virtualKeys.length ?? 0 }} 把虚拟 Key ·
          {{ displayed?.credentials.length ?? 0 }} 把智谱 Key
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
        :min-zoom="0.3"
        :max-zoom="1.6"
        :default-viewport="{ zoom: 0.85 }"
        :nodes-connectable="false"
        :edges-updatable="false"
        :elements-selectable="true"
        fit-view-on-init
        @node-click="onNodeClick"
        @pane-click="clearHighlight"
        @init="onFlowInit"
      >
        <template #node-employee="{ data }">
          <div class="graph-node employee" :class="{ dimmed: data.dimmed, active: data.active }">
            <Handle type="source" :position="Position.Right" :connectable="false" />
            <strong>{{ data.name }}</strong>
            <span>{{ data.enterpriseName || "未加入企业" }}{{ data.teamName ? ` · ${data.teamName}` : "" }}</span>
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
        <template #node-credential="{ data }">
          <div class="graph-node credential" :class="{ dimmed: data.dimmed, active: data.active }">
            <Handle type="target" :position="Position.Left" :connectable="false" />
            <strong>{{ data.label }}</strong>
            <span class="mono">…{{ data.secretSuffix }}</span>
            <span>{{ data.productLineName }} · {{ credentialStatusLabel(data.status) }}</span>
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

type BindingKind = "owns" | "grant" | "pool";
type KindFilter = "all" | "grant" | "pool";
type NodeKind = "employee" | "virtual_key" | "credential";

type GraphEmployee = {
  id: number;
  name: string;
  enterpriseId: number | null;
  enterpriseName: string | null;
  teamId: number | null;
  teamName: string | null;
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
  virtualKeys: GraphVirtualKey[];
  credentials: GraphCredential[];
  edges: GraphEdge[];
  channels: Array<{ id: number; name: string; providerCode: string; providerName: string }>;
  enterprises: Array<{ id: number; name: string }>;
};

const COL_X = { employee: 0, virtual_key: 360, credential: 740 } as const;
const NODE_H = 92;
const NODE_GAP = 18;
const GROUP_GAP = 36;

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

function nodeId(type: NodeKind, id: number): string {
  return `${type}:${id}`;
}

function protocolLabel(protocol: string): string {
  return relayProtocolLabel(protocol, true);
}

function credentialStatusLabel(status: GraphCredential["status"]): string {
  if (status === "cooling") return "冷却中";
  if (status === "auto_disabled") return "自动停用";
  if (status === "disabled") return "已停用";
  return "可用";
}

function visibleGraph(source: KeyBindingGraph, kind: KindFilter): KeyBindingGraph {
  if (kind === "all") return source;
  const useEdges = source.edges.filter((edge) => edge.kind === kind);
  const keyIds = new Set(useEdges.map((edge) => edge.sourceId));
  const credentialIds = new Set(useEdges.map((edge) => edge.targetId));
  const virtualKeys = source.virtualKeys.filter((row) => keyIds.has(row.id));
  const employeeIds = new Set(virtualKeys.map((row) => row.employeeId));
  return {
    ...source,
    employees: source.employees.filter((row) => employeeIds.has(row.id)),
    virtualKeys,
    credentials: source.credentials.filter((row) => credentialIds.has(row.id)),
    edges: [
      ...source.edges.filter((edge) => edge.kind === "owns" && keyIds.has(edge.targetId)),
      ...useEdges,
    ],
  };
}

function layoutGraph(source: KeyBindingGraph): { nodes: Node[]; edges: Edge[] } {
  const keysByEmployee = new Map<number, GraphVirtualKey[]>();
  for (const key of source.virtualKeys) {
    const list = keysByEmployee.get(key.employeeId) ?? [];
    list.push(key);
    keysByEmployee.set(key.employeeId, list);
  }

  const laidNodes: Node[] = [];
  let employeeCursor = 0;
  for (const employee of source.employees) {
    const keys = keysByEmployee.get(employee.id) ?? [];
    const stack = Math.max(keys.length, 1);
    const blockH = stack * NODE_H + (stack - 1) * NODE_GAP;
    const employeeY = employeeCursor + Math.max(0, (blockH - NODE_H) / 2);
    laidNodes.push({
      id: nodeId("employee", employee.id),
      type: "employee",
      position: { x: COL_X.employee, y: employeeY },
      data: { ...employee, dimmed: false, active: false },
      draggable: true,
      connectable: false,
    });
    keys.forEach((key, index) => {
      laidNodes.push({
        id: nodeId("virtual_key", key.id),
        type: "virtual_key",
        position: { x: COL_X.virtual_key, y: employeeCursor + index * (NODE_H + NODE_GAP) },
        data: { ...key, dimmed: false, active: false },
        draggable: true,
        connectable: false,
      });
    });
    employeeCursor += blockH + GROUP_GAP;
  }

  const credentialsByLine = new Map<number, GraphCredential[]>();
  for (const credential of source.credentials) {
    const list = credentialsByLine.get(credential.productLineId) ?? [];
    list.push(credential);
    credentialsByLine.set(credential.productLineId, list);
  }
  let credentialCursor = 0;
  for (const group of credentialsByLine.values()) {
    for (const credential of group) {
      laidNodes.push({
        id: nodeId("credential", credential.id),
        type: "credential",
        position: { x: COL_X.credential, y: credentialCursor },
        data: { ...credential, dimmed: false, active: false },
        draggable: true,
        connectable: false,
      });
      credentialCursor += NODE_H + NODE_GAP;
    }
    credentialCursor += GROUP_GAP / 2;
  }

  const laidEdges: Edge[] = source.edges.map((edge) => {
    const grant = edge.kind === "grant";
    return {
      id: edge.id,
      source: nodeId(edge.sourceType, edge.sourceId),
      target: nodeId(edge.targetType, edge.targetId),
      type: "smoothstep",
      animated: grant,
      markerEnd: MarkerType.ArrowClosed,
      style: {
        stroke: grant ? "#2563eb" : edge.kind === "owns" ? "#64748b" : "#94a3b8",
        strokeWidth: grant ? 2 : 1.4,
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
  const kind = origin.split(":")[0];
  for (const edge of currentEdges) {
    if (kind === "employee" && edge.source === origin) {
      ids.add(edge.target);
      for (const next of currentEdges) {
        if (next.source === edge.target) ids.add(next.target);
      }
    } else if (kind === "credential" && edge.target === origin) {
      ids.add(edge.source);
      for (const next of currentEdges) {
        if (next.target === edge.source) ids.add(next.source);
      }
    } else if (kind === "virtual_key" && (edge.source === origin || edge.target === origin)) {
      ids.add(edge.source);
      ids.add(edge.target);
    }
  }
  return ids;
}

function applyHighlight() {
  const selected = selectedNodeId.value;
  const related = selected ? relatedIds(selected, edges.value) : null;
  for (const node of nodes.value) {
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

.swatch.employee {
  background: #0f766e;
}

.swatch.virtual {
  background: #2563eb;
}

.swatch.credential {
  background: #c2410c;
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
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  text-align: left;
}

.graph-node {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 250px;
  padding: 12px 14px;
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

.graph-node.employee {
  border-left: 3px solid #0f766e;
}

.graph-node.virtual {
  border-left: 3px solid #2563eb;
}

.graph-node.credential {
  border-left: 3px solid #c2410c;
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
