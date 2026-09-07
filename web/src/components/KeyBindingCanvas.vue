<template>
  <section class="canvas-card">
    <el-empty v-if="!nodes.length" description="没有可展示的绑定关系" :image-size="72" />
    <VueFlow
      v-else
      :nodes="nodes"
      :edges="edges"
      :min-zoom="0.15"
      :max-zoom="1.6"
      :default-viewport="{ zoom: 0.45 }"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :edges-updatable="false"
      :elements-selectable="true"
      :select-nodes-on-drag="false"
      :auto-pan-on-node-drag="false"
      :only-render-visible-elements="true"
      :elevate-nodes-on-select="false"
      :elevate-edges-on-select="false"
      fit-view-on-init
      @node-click="onNodeClick"
      @pane-click="emit('pane-click')"
      @init="onFlowInit"
    >
      <template #edge-traffic="edgeProps">
        <KeyBindingTrafficEdge v-bind="edgeProps" />
      </template>
      <template #node-enterprise="{ data }">
        <div class="graph-node org enterprise" :class="{ dimmed: data.dimmed, active: data.active }">
          <Handle type="source" :position="Position.Right" :connectable="false" />
          <span class="kind">企业</span>
          <strong>{{ data.name }}</strong>
        </div>
      </template>
      <template #node-department="{ data }">
        <div class="graph-node org department" :class="{ dimmed: data.dimmed, active: data.active }">
          <Handle v-if="!data.root" type="target" :position="Position.Left" :connectable="false" />
          <Handle type="source" :position="Position.Right" :connectable="false" />
          <span class="kind">部门</span>
          <strong>{{ data.name }}</strong>
          <span v-if="data.root && data.enterpriseName">{{ data.enterpriseName }}</span>
        </div>
      </template>
      <template #node-team="{ data }">
        <div class="graph-node org team" :class="{ dimmed: data.dimmed, active: data.active }">
          <Handle type="target" :position="Position.Left" :connectable="false" />
          <Handle type="source" :position="Position.Right" :connectable="false" />
          <span class="kind">团队</span>
          <strong>{{ data.name }}</strong>
        </div>
      </template>
      <template #node-employee="{ data }">
        <div
          class="graph-node org employee"
          :class="{ dimmed: data.dimmed, active: data.active, working: data.working }"
        >
          <Handle type="target" :position="Position.Left" :connectable="false" />
          <Handle type="source" :position="Position.Right" :connectable="false" />
          <span class="kind">员工</span>
          <strong>{{ data.name }}</strong>
          <span class="tier" :class="data.usageTier">{{ usageTierLabel(data.usageTier) }}</span>
        </div>
      </template>
      <template #node-virtual_key="{ data }">
        <div
          class="graph-node virtual"
          :class="{
            dimmed: data.dimmed,
            active: data.active,
            working: data.working,
            afterglow: data.afterglow,
          }"
        >
          <Handle type="target" :position="Position.Left" :connectable="false" />
          <Handle type="source" :position="Position.Right" :connectable="false" />
          <span v-if="data.inFlight > 1" class="work-badge">×{{ data.inFlight }}</span>
          <span v-else-if="data.working && !data.afterglow" class="work-dot" title="干活中" />
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
          class="graph-node credential clickable"
          :class="[
            data.lane,
            {
              dimmed: data.dimmed,
              active: data.active,
              working: data.working,
              afterglow: data.afterglow,
            },
          ]"
        >
          <Handle type="target" :position="Position.Left" :connectable="false" />
          <span v-if="data.inFlight > 1" class="work-badge">×{{ data.inFlight }}</span>
          <span v-else-if="data.working && !data.afterglow" class="work-dot" title="干活中" />
          <strong>{{ data.label }}</strong>
          <span class="mono">…{{ data.secretSuffix }}</span>
          <span>{{ credentialCaption(data) }}</span>
        </div>
      </template>
      <Background :gap="18" pattern-color="#e5e7eb" />
      <Controls />
    </VueFlow>
  </section>
</template>

<script setup lang="ts">
import { nextTick, unref, watch, type CSSProperties } from "vue";
import {
  VueFlow,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeMouseEvent,
  type VueFlowStore,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import KeyBindingTrafficEdge from "@/components/KeyBindingTrafficEdge.vue";
import { relayProtocolLabel } from "@/views/relay-protocol";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

type UsageTier = "idle" | "standard" | "heavy";
type CoolingKind = "five_hour" | "weekly" | "other";
type CredentialLane = "bound" | "pending" | "cooling_5h" | "cooling_weekly" | "disabled";

type LiveNode = { id: number; inFlight: number; afterglow: boolean };
type LiveHop = { virtualKeyId: number; credentialId: number; inFlight: number; afterglow: boolean };
type LiveLoad = { keys: LiveNode[]; credentials: LiveNode[]; hops: LiveHop[] };

const props = defineProps<{
  nodes: Node[];
  edges: Edge[];
  selectedNodeId?: string | null;
  live?: LiveLoad | null;
  active?: boolean;
}>();

const emit = defineEmits<{
  "node-click": [NodeMouseEvent];
  "pane-click": [];
}>();

let flowStore: VueFlowStore | null = null;

function onFlowInit(store: VueFlowStore) {
  flowStore = store;
  fit();
  syncSelection();
  syncLive();
}

function fit() {
  void nextTick(() => {
    requestAnimationFrame(() => flowStore?.fitView({ padding: 0.18 }));
  });
}

watch(
  () => [props.nodes.length, props.edges.length, props.active],
  () => {
    if (props.active !== false) fit();
  },
);

watch(
  () => props.nodes,
  () => {
    void nextTick(() => {
      syncSelection();
      syncLive();
    });
  },
);

watch(() => props.selectedNodeId, syncSelection);
watch(() => props.live, syncLive);

function relatedIds(origin: string, currentEdges: Array<{ source: string; target: string }>): Set<string> {
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

function parseNumericId(id: string): number | null {
  const value = Number(id.slice(id.indexOf(":") + 1));
  return Number.isSafeInteger(value) ? value : null;
}

function patchNode(
  id: string,
  patch: { active?: boolean; dimmed?: boolean; working?: boolean; afterglow?: boolean; inFlight?: number },
) {
  const store = flowStore;
  if (!store) return;
  const node = store.findNode(id);
  if (!node?.data) return;
  const data = node.data as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (data[key] === value) continue;
    store.updateNodeData(id, patch);
    return;
  }
}

function storeNodes() {
  return unref(flowStore?.nodes) ?? [];
}

function storeEdges() {
  return unref(flowStore?.edges) ?? [];
}

function syncSelection() {
  const store = flowStore;
  if (!store) return;
  const selected = props.selectedNodeId ?? null;
  const edges = storeEdges();
  const related = selected ? relatedIds(selected, edges.map((edge) => ({ source: edge.source, target: edge.target }))) : null;
  for (const node of storeNodes()) {
    if (node.type === "lane_header") continue;
    patchNode(node.id, {
      active: node.id === selected,
      dimmed: related != null && !related.has(node.id),
    });
  }
  for (const edge of edges) {
    const keep = related == null || (related.has(edge.source) && related.has(edge.target));
    const dimmed = !keep;
    const opacity = keep ? 1 : 0.12;
    if (edge.data?.dimmed !== dimmed) {
      store.updateEdgeData(edge.id, { dimmed });
    }
    const currentStyle = (edge.style ?? {}) as CSSProperties;
    if (currentStyle.opacity !== opacity) {
      edge.style = { ...currentStyle, opacity };
    }
  }
}

function syncLive() {
  const store = flowStore;
  if (!store) return;
  const live = props.live;
  const keyLoad = new Map((live?.keys ?? []).map((row) => [row.id, row]));
  const credLoad = new Map((live?.credentials ?? []).map((row) => [row.id, row]));
  const hopLoad = new Map(
    (live?.hops ?? []).map((row) => [`${row.virtualKeyId}:${row.credentialId}`, row]),
  );
  const workingEmployees = new Set<number>();
  const nodes = storeNodes();
  for (const node of nodes) {
    if (node.type !== "virtual_key") continue;
    const load = keyLoad.get(Number(node.data.id));
    const working = Boolean(load && (load.inFlight > 0 || load.afterglow));
    patchNode(node.id, {
      working,
      afterglow: Boolean(working && load && load.inFlight <= 0),
      inFlight: load?.inFlight ?? 0,
    });
    if (working && typeof node.data.employeeId === "number") {
      workingEmployees.add(node.data.employeeId);
    }
  }
  for (const node of nodes) {
    if (node.type === "credential") {
      const load = credLoad.get(Number(node.data.id));
      const working = Boolean(load && (load.inFlight > 0 || load.afterglow));
      patchNode(node.id, {
        working,
        afterglow: Boolean(working && load && load.inFlight <= 0),
        inFlight: load?.inFlight ?? 0,
      });
      continue;
    }
    if (node.type === "employee") {
      patchNode(node.id, {
        working: workingEmployees.has(Number(node.data.id)),
        afterglow: false,
        inFlight: 0,
      });
    }
  }
  for (const edge of storeEdges()) {
    const kind = edge.data?.kind as string | undefined;
    if (
      kind !== "dedicated"
      && kind !== "team_shared"
      && kind !== "department_shared"
      && kind !== "enterprise_shared"
      && kind !== "open_shared"
    ) {
      continue;
    }
    const sourceId = parseNumericId(String(edge.source));
    const targetId = parseNumericId(String(edge.target));
    const hop =
      sourceId != null && targetId != null ? hopLoad.get(`${sourceId}:${targetId}`) : undefined;
    const working = Boolean(hop && (hop.inFlight > 0 || hop.afterglow));
    const afterglow = Boolean(working && hop && hop.inFlight <= 0);
    const inFlight = hop?.inFlight ?? 0;
    if (
      edge.data?.working === working
      && edge.data?.afterglow === afterglow
      && edge.data?.inFlight === inFlight
    ) {
      continue;
    }
    store.updateEdgeData(edge.id, { working, afterglow, inFlight });
  }
}

function onNodeClick(event: NodeMouseEvent) {
  emit("node-click", event);
}

function protocolLabel(protocol: string) {
  return relayProtocolLabel(protocol, true);
}

function usageTierLabel(tier: UsageTier | undefined) {
  if (tier === "idle") return "闲置用户";
  if (tier === "heavy") return "重度用户";
  return "标准用户";
}

function formatCoolUntil(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function credentialCaption(data: {
  productLineName?: string;
  lane?: CredentialLane;
  coolingKind?: CoolingKind | null;
  coolUntil?: string | null;
}) {
  const lane =
    data.lane === "pending"
      ? "待绑定"
      : data.lane === "cooling_weekly"
        ? "周冷却"
        : data.lane === "cooling_5h"
          ? data.coolingKind === "other"
            ? "冷却中"
            : "5小时冷却"
          : data.lane === "disabled"
            ? "停用"
            : "绑定";
  if (data.lane === "cooling_5h" || data.lane === "cooling_weekly") {
    const until = formatCoolUntil(data.coolUntil);
    return until ? `${lane} · 至 ${until}` : lane;
  }
  return `${data.productLineName ?? ""} · ${lane}`;
}
</script>

<style scoped>
.canvas-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.canvas-card .el-empty {
  margin: auto;
}

.canvas-card :deep(.vue-flow) {
  width: 100%;
  flex: 1;
  min-height: 0;
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
  width: 8px;
  height: 8px;
  border: 0;
  background: #94a3b8;
  opacity: 0.9;
  transform: translate(-50%, -50%);
}

.canvas-card :deep(.vue-flow__handle-right) {
  transform: translate(50%, -50%);
}

.graph-node {
  position: relative;
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

.graph-node.org {
  gap: 2px;
}

.graph-node .kind {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
}

.graph-node.enterprise {
  border-left: 3px solid #4338ca;
}

.graph-node.department {
  border-left: 3px solid #7c3aed;
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

.graph-node .tier.idle {
  color: #94a3b8;
  background: #f8fafc;
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

.graph-node.credential.cooling_5h {
  border-left: 3px solid #d97706;
}

.graph-node.credential.cooling_weekly {
  border-left: 3px solid #b91c1c;
}

.graph-node.credential.disabled {
  border-left: 3px solid #94a3b8;
  opacity: 0.78;
}

.graph-node.active {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.16);
}

.graph-node.working {
  animation: node-work 1.8s ease-in-out infinite;
}

.graph-node.virtual.working {
  box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.35), 0 0 14px rgba(34, 211, 238, 0.22);
}

.graph-node.credential.working {
  box-shadow: 0 0 0 2px rgba(194, 65, 12, 0.32), 0 0 14px rgba(194, 65, 12, 0.2);
}

.graph-node.employee.working {
  animation: none;
  box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.22);
}

.graph-node.working.afterglow {
  animation: none;
  box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.18);
}

.graph-node.credential.working.afterglow {
  box-shadow: 0 0 0 2px rgba(194, 65, 12, 0.16);
}

.graph-node.clickable {
  cursor: pointer;
}

.graph-node.dimmed {
  opacity: 0.22;
}

.graph-node.dimmed.working {
  animation: none;
}

.work-badge,
.work-dot {
  position: absolute;
  top: 8px;
  right: 8px;
}

.work-badge {
  min-width: 22px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #0f172a;
  color: #e0f2fe;
  font-size: 11px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

.work-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #22d3ee;
  box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.22);
}

.graph-node.credential .work-dot {
  background: #f97316;
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.22);
}

@keyframes node-work {
  0%,
  100% {
    filter: brightness(1);
  }
  50% {
    filter: brightness(1.04);
  }
}

@media (prefers-reduced-motion: reduce) {
  .graph-node.working {
    animation: none;
  }
}
</style>
