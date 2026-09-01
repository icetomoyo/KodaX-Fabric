<template>
  <section class="canvas-card">
    <el-empty v-if="!nodes.length" description="没有可展示的绑定关系" :image-size="72" />
    <VueFlow
      v-else
      v-model:nodes="innerNodes"
      v-model:edges="innerEdges"
      :min-zoom="0.15"
      :max-zoom="1.6"
      :default-viewport="{ zoom: 0.45 }"
      :nodes-connectable="false"
      :edges-updatable="false"
      :elements-selectable="true"
      fit-view-on-init
      @node-click="onNodeClick"
      @pane-click="emit('pane-click')"
      @init="onFlowInit"
    >
      <template #edge-traffic="edgeProps">
        <KeyBindingTrafficEdge v-bind="edgeProps" />
      </template>
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
        <div
          class="graph-node employee"
          :class="{ dimmed: data.dimmed, active: data.active, working: data.working }"
        >
          <Handle type="target" :position="Position.Left" :connectable="false" />
          <Handle type="source" :position="Position.Right" :connectable="false" />
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
          class="graph-node credential"
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
import { computed, nextTick, watch } from "vue";
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

type UsageTier = "idle" | "light" | "standard" | "heavy";
type CoolingKind = "five_hour" | "weekly" | "other";
type CredentialLane = "bound" | "pending" | "cooling_5h" | "cooling_weekly" | "disabled";

const props = defineProps<{
  nodes: Node[];
  edges: Edge[];
  active?: boolean;
}>();

const emit = defineEmits<{
  "update:nodes": [Node[]];
  "update:edges": [Edge[]];
  "node-click": [NodeMouseEvent];
  "pane-click": [];
}>();

const innerNodes = computed({
  get: () => props.nodes,
  set: (value) => emit("update:nodes", value),
});
const innerEdges = computed({
  get: () => props.edges,
  set: (value) => emit("update:edges", value),
});

let flowStore: VueFlowStore | null = null;

function onFlowInit(store: VueFlowStore) {
  flowStore = store;
  fit();
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

function onNodeClick(event: NodeMouseEvent) {
  emit("node-click", event);
}

function protocolLabel(protocol: string) {
  return relayProtocolLabel(protocol, true);
}

function usageTierLabel(tier: UsageTier | undefined) {
  if (tier === "idle") return "闲置用户";
  if (tier === "light") return "轻度用户";
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

.canvas-card :deep(.el-empty) {
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

.graph-node .tier.idle {
  color: #94a3b8;
  background: #f8fafc;
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
