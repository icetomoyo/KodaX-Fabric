<template>
  <div class="bindings-page" v-loading="loading && !graph">
    <header class="canvas-toolbar">
      <el-radio-group v-model="windowMinutes" size="small" @change="() => load()">
        <el-radio-button v-for="row in WINDOW_OPTIONS" :key="row.value" :value="row.value">
          {{ row.label }}
        </el-radio-button>
      </el-radio-group>
      <el-select
        v-model="productLineId"
        clearable
        filterable
        size="small"
        placeholder="全部产品线"
        class="toolbar-select"
        @change="() => load()"
      >
        <el-option
          v-for="row in graph?.productLines ?? []"
          :key="row.id"
          :label="`${row.providerName} / ${row.name}`"
          :value="row.id"
        />
      </el-select>
      <el-input
        v-model="search"
        clearable
        size="small"
        placeholder="搜索员工 / Key"
        class="toolbar-search"
      />
      <span class="toolbar-stats" data-testid="canvas-stats">
        有通信虚拟 Key {{ stats.keys }} · 有流量渠道 Key {{ stats.busy }}/{{ stats.credentials }}<template v-if="stats.inFlight"> · 在途 {{ stats.inFlight }}</template>
      </span>
      <el-button size="small" :loading="loading" @click="() => load()">刷新</el-button>
    </header>

    <el-empty
      v-if="!loading && graph && !canvasNodes.length"
      class="canvas-empty"
      description="没有渠道 Key"
      :image-size="88"
    />
    <KeyBindingCanvas
      v-else-if="canvasNodes.length"
      :nodes="canvasNodes"
      :edges="canvasEdges"
      :selected-node-id="selectedNodeId"
      :live="lastLive"
      :fit-key="fitKey"
      :fit-node-ids="fitNodeIds"
      @node-click="onNodeClick"
      @pane-click="clearSelection"
    />

    <el-drawer
      v-model="credentialOpen"
      :title="selectedCredential?.label || '渠道 Key'"
      direction="rtl"
      size="420px"
      append-to-body
    >
      <template v-if="selectedCredential">
        <section class="detail-block">
          <div class="detail-top">
            <strong>{{ selectedCredential.label }}</strong>
            <el-tag effect="light" :type="laneTagType(selectedCredential.lane)">
              {{ laneLabel(selectedCredential) }}
            </el-tag>
          </div>
          <div class="detail-meta">
            <span class="mono">…{{ selectedCredential.secretSuffix }}</span>
            <span>{{ selectedCredential.providerName }} / {{ selectedCredential.productLineName }}</span>
          </div>
        </section>

        <section class="detail-block">
          <h3>绑定</h3>
          <p>席位主人：{{ selectedCredential.ownerName || "无" }}</p>
          <p v-if="selectedCredential.binding">
            当前挂在：{{ selectedCredential.binding.scopeName || selectedCredential.binding.scopeId }}
            · {{ selectedCredential.memberCount }} 人
          </p>
          <p v-else class="muted">当前没有绑定</p>
        </section>

        <section class="detail-block">
          <h3>额度</h3>
          <dl class="quota-list">
            <div>
              <dt>5 小时积分</dt>
              <dd>{{ formatQuotaPair(selectedCredential.fiveHourCredits, selectedCredential.fiveHourLimit) }}</dd>
            </div>
            <div>
              <dt>周积分</dt>
              <dd>{{ formatQuotaPair(selectedCredential.weeklyCredits, selectedCredential.weeklyLimit) }}</dd>
            </div>
            <div v-if="credentialInFlight">
              <dt>在途</dt>
              <dd>{{ credentialInFlight }} 路请求</dd>
            </div>
          </dl>
        </section>

        <section class="detail-block">
          <h3>{{ windowLabel }}内的调用</h3>
          <el-empty
            v-if="!credentialUsers.length"
            description="这段时间没有请求打到这把 Key"
            :image-size="56"
          />
          <ul v-else class="user-list" data-testid="credential-users">
            <li v-for="row in credentialUsers" :key="row.keyId">
              <div class="user-top">
                <strong>{{ row.employeeName }}</strong>
                <span class="mono">{{ row.requests }} 次</span>
              </div>
              <span>
                {{ row.owner ? "本人 Key" : "借用" }} · {{ row.keyName }}
                <template v-if="row.failures"> · 失败 {{ row.failures }}</template>
                <template v-if="row.lastAt"> · 最近 {{ formatTime(row.lastAt) }}</template>
                <template v-else> · 进行中</template>
              </span>
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
          释放绑定
        </el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import KeyBindingCanvas from "@/components/KeyBindingCanvas.vue";
import { MarkerType, type Edge, type Node, type NodeMouseEvent } from "@vue-flow/core";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";

type CoolingKind = "five_hour" | "weekly" | "other";
/** 渠道 Key 的状态色：有流量 / 空闲 / 冷却 / 停用。冷却优先于有没有流量。 */
type CredentialLane = "busy" | "idle" | "cooling_5h" | "cooling_weekly" | "disabled";

type GraphEmployee = { id: number; name: string; enterpriseName: string | null };

type GraphVirtualKey = {
  id: number;
  employeeId: number;
  name: string;
  keyPrefix: string;
  protocol: string;
  productLineId: number;
  productLineName: string;
  status: "active" | "revoked";
};

type GraphCredential = {
  id: number;
  label: string;
  secretSuffix: string;
  productLineId: number;
  productLineName: string;
  providerName: string;
  status: "active" | "disabled" | "auto_disabled" | "cooling";
  coolingKind: CoolingKind | null;
  coolUntil: string | null;
  fiveHourCredits: number;
  weeklyCredits: number;
  fiveHourLimit: number | null;
  weeklyLimit: number | null;
  binding: { scopeType: string; scopeId: number; scopeName: string } | null;
  memberCount: number;
  ownerEmployeeId: number | null;
  ownerName: string | null;
};

type GraphHop = {
  virtualKeyId: number;
  credentialId: number;
  requests: number;
  failures: number;
  credits: number;
  /** 窗口内最后一次请求；只在途、还没落审计时为 null。 */
  lastAt: string | null;
  owner: boolean;
};

type SchedulingGraph = {
  windowMinutes: number;
  since: string;
  productLines: Array<{ id: number; name: string; providerName: string }>;
  employees: GraphEmployee[];
  virtualKeys: GraphVirtualKey[];
  credentials: GraphCredential[];
  hops: GraphHop[];
};

type RelayLiveNode = { id: number; inFlight: number; afterglow: boolean };
type RelayLiveHop = { virtualKeyId: number; credentialId: number; inFlight: number; afterglow: boolean };
type RelayLiveLoad = { keys: RelayLiveNode[]; credentials: RelayLiveNode[]; hops: RelayLiveHop[] };

const WINDOW_OPTIONS = [
  { value: 30, label: "30 分钟" },
  { value: 120, label: "2 小时" },
  { value: 1440, label: "24 小时" },
] as const;

const COL_X = { employee: 0, virtual_key: 360, credential: 720 } as const;
const NODE_H = 92;
const NODE_GAP = 40;
const GROUP_GAP = 72;
const LIVE_POLL_MS = 4000;
/** 窗口是滑动的：定时静默重拉，过期的 Key 自然退出画布。 */
const GRAPH_REFRESH_MS = 60_000;
/** 实时快照里出现画布上没有的连线时，最快隔这么久重拉一次。 */
const UNKNOWN_HOP_RELOAD_MS = 5_000;
const IDLE_LANE_ORDER: CredentialLane[] = ["idle", "cooling_5h", "cooling_weekly", "disabled"];
const IDLE_MIN_ROWS = 6;
const IDLE_COL_W = 290;

const loading = ref(false);
const graph = ref<SchedulingGraph | null>(null);
const windowMinutes = ref<number>(30);
const productLineId = ref<number | null>(null);
const search = ref("");
const selectedNodeId = ref<string | null>(null);
const credentialOpen = ref(false);
const releasing = ref(false);
const lastLive = ref<RelayLiveLoad | null>(null);
let lastLiveStamp = "";
let lastUnknownHopReload = 0;

const windowLabel = computed(
  () => WINDOW_OPTIONS.find((row) => row.value === windowMinutes.value)?.label ?? `${windowMinutes.value} 分钟`,
);

function credentialLane(credential: GraphCredential, busy: boolean): CredentialLane {
  if (credential.status === "disabled" || credential.status === "auto_disabled") return "disabled";
  if (credential.coolingKind === "weekly") return "cooling_weekly";
  if (credential.coolingKind || credential.status === "cooling") return "cooling_5h";
  return busy ? "busy" : "idle";
}

function laneLabel(row: { lane: CredentialLane; coolingKind: CoolingKind | null }): string {
  if (row.lane === "busy") return "有流量";
  if (row.lane === "idle") return "空闲";
  if (row.lane === "cooling_weekly") return "周冷却";
  if (row.lane === "cooling_5h") return row.coolingKind === "other" ? "冷却中" : "5小时冷却";
  return "停用";
}

function laneTagType(lane: CredentialLane): "info" | "warning" | "danger" | "success" {
  if (lane === "busy") return "success";
  if (lane === "cooling_5h" || lane === "cooling_weekly") return "danger";
  if (lane === "disabled") return "warning";
  return "info";
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

function includesQuery(value: string | null | undefined, q: string): boolean {
  return (value ?? "").toLowerCase().includes(q);
}

/** 搜索后留下的连线、虚拟 Key、员工和渠道 Key。没有搜索时渠道 Key 全部保留。 */
const visible = computed(() => {
  const source = graph.value;
  if (!source) return null;
  const keyById = new Map(source.virtualKeys.map((row) => [row.id, row]));
  const employeeById = new Map(source.employees.map((row) => [row.id, row]));
  const credentialById = new Map(source.credentials.map((row) => [row.id, row]));
  const q = search.value.trim().toLowerCase();

  const hops = source.hops.filter((hop) => {
    const key = keyById.get(hop.virtualKeyId);
    const credential = credentialById.get(hop.credentialId);
    if (!key || !credential) return false;
    if (!q) return true;
    const employee = employeeById.get(key.employeeId);
    return (
      includesQuery(employee?.name, q)
      || includesQuery(key.name, q)
      || includesQuery(key.keyPrefix, q)
      || includesQuery(credential.label, q)
      || includesQuery(credential.secretSuffix, q)
    );
  });
  const keyIds = new Set(hops.map((hop) => hop.virtualKeyId));
  const usedCredentialIds = new Set(hops.map((hop) => hop.credentialId));
  const virtualKeys = source.virtualKeys.filter((row) => keyIds.has(row.id));
  const employeeIds = new Set(virtualKeys.map((row) => row.employeeId));
  const credentials = source.credentials.filter(
    (row) =>
      !q
      || usedCredentialIds.has(row.id)
      || includesQuery(row.label, q)
      || includesQuery(row.secretSuffix, q),
  );
  return {
    hops,
    virtualKeys,
    employees: source.employees.filter((row) => employeeIds.has(row.id)),
    credentials,
    usedCredentialIds,
  };
});

const stats = computed(() => {
  const view = visible.value;
  const shown = new Set(view?.credentials.map((row) => row.id) ?? []);
  const inFlight = (lastLive.value?.credentials ?? [])
    .filter((row) => shown.has(row.id))
    .reduce((sum, row) => sum + Math.max(0, row.inFlight), 0);
  return {
    keys: view?.virtualKeys.length ?? 0,
    busy: view?.usedCredentialIds.size ?? 0,
    credentials: view?.credentials.length ?? 0,
    inFlight,
  };
});

function makeNode(type: string, id: number | string, x: number, y: number, data: Record<string, unknown>): Node {
  return {
    id: `${type}:${id}`,
    type,
    position: { x, y },
    data: { ...data, dimmed: false, active: false },
    draggable: false,
    connectable: false,
  };
}

function hopEdgeStyle(hop: GraphHop): Record<string, string | number> {
  const width = 1.5 + Math.min(3, Math.log2(1 + hop.requests) / 2);
  return hop.owner
    ? { stroke: "#2563eb", strokeWidth: width }
    : { stroke: "#7c3aed", strokeWidth: width, strokeDasharray: "6 4" };
}

const layout = computed((): { nodes: Node[]; edges: Edge[] } => {
  const view = visible.value;
  if (!view) return { nodes: [], edges: [] };

  const requestsByKey = new Map<number, number>();
  const requestsByCredential = new Map<number, number>();
  for (const hop of view.hops) {
    requestsByKey.set(hop.virtualKeyId, (requestsByKey.get(hop.virtualKeyId) ?? 0) + hop.requests);
    requestsByCredential.set(hop.credentialId, (requestsByCredential.get(hop.credentialId) ?? 0) + hop.requests);
  }
  const keysByEmployee = new Map<number, GraphVirtualKey[]>();
  for (const key of view.virtualKeys) {
    const list = keysByEmployee.get(key.employeeId) ?? [];
    list.push(key);
    keysByEmployee.set(key.employeeId, list);
  }

  const nodes: Node[] = [];
  const keyY = new Map<number, number>();
  let cursor = 0;
  const employees = [...view.employees].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  for (const employee of employees) {
    const keys = (keysByEmployee.get(employee.id) ?? []).sort((a, b) => a.id - b.id);
    const height = keys.length * NODE_H + Math.max(0, keys.length - 1) * NODE_GAP;
    nodes.push(
      makeNode("employee", employee.id, COL_X.employee, cursor + (height - NODE_H) / 2, employee),
    );
    keys.forEach((key, index) => {
      const y = cursor + index * (NODE_H + NODE_GAP);
      keyY.set(key.id, y);
      nodes.push(
        makeNode("virtual_key", key.id, COL_X.virtual_key, y, {
          ...key,
          caption: `${key.productLineName} · ${requestsByKey.get(key.id) ?? 0} 次`,
        }),
      );
    });
    cursor += height + NODE_GAP;
  }

  // 有流量的渠道 Key 放在调用它的虚拟 Key 的中间高度，往下错开不重叠；没流量的按状态排在下面。
  const targetYs = new Map<number, number[]>();
  for (const hop of view.hops) {
    const y = keyY.get(hop.virtualKeyId);
    if (y == null) continue;
    const list = targetYs.get(hop.credentialId) ?? [];
    list.push(y);
    targetYs.set(hop.credentialId, list);
  }
  const credentialData = (credential: GraphCredential) => {
    const busy = view.usedCredentialIds.has(credential.id);
    const lane = credentialLane(credential, busy);
    const state = laneLabel({ lane, coolingKind: credential.coolingKind });
    const until = lane === "cooling_5h" || lane === "cooling_weekly" ? formatTime(credential.coolUntil) : "";
    const requests = requestsByCredential.get(credential.id) ?? 0;
    const tail = until ? `${state} · 至 ${until}` : busy ? `${requests} 次` : state;
    return {
      ...credential,
      lane,
      caption: `${credential.productLineName} · ${tail}`,
    };
  };

  const used = view.credentials
    .filter((row) => view.usedCredentialIds.has(row.id))
    .map((credential) => {
      const ys = targetYs.get(credential.id) ?? [0];
      return { credential, desiredY: (Math.min(...ys) + Math.max(...ys)) / 2 };
    })
    .sort((a, b) => a.desiredY - b.desiredY || a.credential.id - b.credential.id);
  let credentialCursor = Number.NEGATIVE_INFINITY;
  for (const item of used) {
    const y = Math.max(item.desiredY, credentialCursor);
    nodes.push(makeNode("credential", item.credential.id, COL_X.credential, y, credentialData(item.credential)));
    credentialCursor = y + NODE_H + NODE_GAP;
  }

  const idle = view.credentials
    .filter((row) => !view.usedCredentialIds.has(row.id))
    .map(credentialData)
    .sort(
      (a, b) =>
        IDLE_LANE_ORDER.indexOf(a.lane) - IDLE_LANE_ORDER.indexOf(b.lane)
        || a.productLineId - b.productLineId
        || a.id - b.id,
    );
  // 没流量的排成网格放在右侧，不把有流量的部分挤出视口；行数跟有流量那部分一样高。
  if (idle.length) {
    const activeBottom = Math.max(cursor, Number.isFinite(credentialCursor) ? credentialCursor : 0);
    const rows = Math.max(IDLE_MIN_ROWS, Math.floor(activeBottom / (NODE_H + NODE_GAP)));
    const left = used.length || employees.length ? COL_X.credential + IDLE_COL_W + GROUP_GAP : 0;
    nodes.push({
      id: "header:idle",
      type: "lane_header",
      position: { x: left, y: -56 },
      data: { label: `${windowLabel.value}内没有流量 · ${idle.length} 把`, dimmed: false, active: false },
      draggable: false,
      selectable: false,
      connectable: false,
    });
    idle.forEach((data, index) => {
      const x = left + Math.floor(index / rows) * IDLE_COL_W;
      const y = (index % rows) * (NODE_H + NODE_GAP);
      nodes.push(makeNode("credential", data.id, x, y, data));
    });
  }

  const edges: Edge[] = [];
  for (const key of view.virtualKeys) {
    edges.push({
      id: `owns:${key.employeeId}:${key.id}`,
      source: `employee:${key.employeeId}`,
      target: `virtual_key:${key.id}`,
      type: "step",
      markerEnd: MarkerType.ArrowClosed,
      style: { stroke: "#94a3b8", strokeWidth: 1.5 },
      data: { dimmed: false },
    });
  }
  for (const hop of view.hops) {
    edges.push({
      id: `hop:${hop.virtualKeyId}:${hop.credentialId}`,
      source: `virtual_key:${hop.virtualKeyId}`,
      target: `credential:${hop.credentialId}`,
      type: "traffic",
      markerEnd: MarkerType.ArrowClosed,
      style: hopEdgeStyle(hop),
      data: {
        owner: hop.owner,
        requests: hop.requests,
        working: false,
        afterglow: false,
        inFlight: 0,
        dimmed: false,
      },
    });
  }
  return { nodes, edges };
});

const canvasNodes = computed(() => layout.value.nodes);
/** 默认视口框住有流量的部分（员工、虚拟 Key 和它们打到的渠道 Key）；全无流量时框住全部。 */
const fitNodeIds = computed(() => {
  const view = visible.value;
  if (!view?.hops.length) return [];
  return layout.value.nodes
    .filter((node) => node.type !== "credential" || view.usedCredentialIds.has(Number(node.data.id)))
    .filter((node) => node.type !== "lane_header")
    .map((node) => node.id);
});
const canvasEdges = computed(() => layout.value.edges);
/** 前台加载（换窗口、产品线、手动刷新）的新数据到了，或者换了搜索词，才重新适配视口。 */
const fitSeq = ref(0);
const fitKey = computed(() => `${fitSeq.value}|${search.value.trim()}`);

const selectedCredential = computed(() => {
  if (!credentialOpen.value || !selectedNodeId.value?.startsWith("credential:")) return null;
  const id = Number(selectedNodeId.value.slice("credential:".length));
  const node = canvasNodes.value.find((row) => row.id === selectedNodeId.value);
  const row = graph.value?.credentials.find((item) => item.id === id);
  if (!row || !node) return null;
  return { ...row, lane: node.data.lane as CredentialLane };
});

const credentialInFlight = computed(() => {
  const id = selectedCredential.value?.id;
  if (id == null) return 0;
  return Math.max(0, lastLive.value?.credentials.find((row) => row.id === id)?.inFlight ?? 0);
});

const credentialUsers = computed(() => {
  const credentialId = selectedCredential.value?.id;
  const source = graph.value;
  if (credentialId == null || !source) return [];
  const keyById = new Map(source.virtualKeys.map((row) => [row.id, row]));
  const employeeById = new Map(source.employees.map((row) => [row.id, row]));
  return source.hops
    .filter((hop) => hop.credentialId === credentialId && keyById.has(hop.virtualKeyId))
    .map((hop) => {
      const key = keyById.get(hop.virtualKeyId)!;
      return {
        keyId: key.id,
        keyName: key.name,
        employeeName: employeeById.get(key.employeeId)?.name ?? `员工 ${key.employeeId}`,
        owner: hop.owner,
        requests: hop.requests,
        failures: hop.failures,
        lastAt: hop.lastAt,
      };
    })
    .sort((a, b) => b.requests - a.requests || a.keyId - b.keyId);
});

function onNodeClick(event: NodeMouseEvent) {
  if (event.node.type === "lane_header") return;
  if (selectedNodeId.value === event.node.id) {
    clearSelection();
    return;
  }
  selectedNodeId.value = event.node.id;
  credentialOpen.value = event.node.type === "credential";
}

function clearSelection() {
  selectedNodeId.value = null;
  credentialOpen.value = false;
}

async function releaseSelectedCredential() {
  const credential = selectedCredential.value;
  if (!credential?.binding) return;
  try {
    await ElMessageBox.confirm(
      "释放后这把渠道 Key 回到资源池，正在用它的员工下次请求时重新挂 Key。",
      "释放绑定",
      { type: "warning", confirmButtonText: "释放", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  releasing.value = true;
  try {
    const { data } = await http.post(`/api/admin/key-bindings/credentials/${credential.id}/release`);
    if (!data.success) throw new Error(data.message || "释放失败");
    ElMessage.success("已释放绑定");
    await load({ silent: true });
  } catch (error) {
    const err = error as { response?: { data?: { message?: string } }; message?: string };
    ElMessage.error(err.response?.data?.message || err.message || "释放失败");
  } finally {
    releasing.value = false;
  }
}

let loadSeq = 0;

/** silent：后台刷新，不显示加载态、不清掉当前选中。 */
async function load(options: { silent?: boolean } = {}) {
  const seq = ++loadSeq;
  if (!options.silent) loading.value = true;
  try {
    const { data } = await http.get("/api/admin/key-bindings", {
      params: {
        windowMinutes: windowMinutes.value,
        ...(productLineId.value != null ? { productLineId: productLineId.value } : {}),
      },
    });
    if (seq !== loadSeq) return;
    if (!data.success) throw new Error(data.message || "加载失败");
    graph.value = data.data as SchedulingGraph;
    if (!options.silent) {
      clearSelection();
      fitSeq.value += 1;
    }
    else if (selectedNodeId.value && !canvasNodes.value.some((row) => row.id === selectedNodeId.value)) {
      clearSelection();
    }
  } catch (error) {
    if (seq !== loadSeq || options.silent) return;
    const err = error as { response?: { data?: { message?: string } }; message?: string };
    ElMessage.error(err.response?.data?.message || err.message || "调度画布加载失败");
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

/** 实时快照里有画布上没有的连线（刚开始、还没落审计的请求），就重拉一次图。 */
function reloadForUnknownHops(live: RelayLiveLoad) {
  const source = graph.value;
  if (!source || loading.value) return;
  const known = new Set(source.hops.map((hop) => `${hop.virtualKeyId}:${hop.credentialId}`));
  const credentialIds = new Set(source.credentials.map((row) => row.id));
  const unknown = live.hops.some(
    (hop) => credentialIds.has(hop.credentialId) && !known.has(`${hop.virtualKeyId}:${hop.credentialId}`),
  );
  if (!unknown || Date.now() - lastUnknownHopReload < UNKNOWN_HOP_RELOAD_MS) return;
  lastUnknownHopReload = Date.now();
  void load({ silent: true });
}

async function pollLive() {
  if (typeof document !== "undefined" && document.hidden) return;
  try {
    const { data } = await http.get("/api/admin/key-bindings/live");
    if (!data.success) return;
    const stamp = JSON.stringify(data.data);
    if (stamp === lastLiveStamp) return;
    lastLiveStamp = stamp;
    lastLive.value = data.data;
    reloadForUnknownHops(data.data as RelayLiveLoad);
  } catch {
    // Keep the last snapshot; a missed poll should not toast.
  }
}

let liveTimer: ReturnType<typeof setInterval> | null = null;
let graphTimer: ReturnType<typeof setInterval> | null = null;

function onVisibilityChange() {
  if (document.hidden) return;
  void pollLive();
  void load({ silent: true });
}

onMounted(() => {
  void load();
  void pollLive();
  liveTimer = setInterval(() => void pollLive(), LIVE_POLL_MS);
  graphTimer = setInterval(() => {
    if (!document.hidden) void load({ silent: true });
  }, GRAPH_REFRESH_MS);
  document.addEventListener("visibilitychange", onVisibilityChange);
});

onUnmounted(() => {
  if (liveTimer) clearInterval(liveTimer);
  if (graphTimer) clearInterval(graphTimer);
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

.canvas-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
}

.toolbar-select {
  width: 200px;
}

.toolbar-search {
  width: 160px;
}

.toolbar-stats {
  margin-left: auto;
  color: #64748b;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.canvas-empty {
  margin: auto;
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
  margin: 0 0 4px;
  color: #334155;
  font-size: 13px;
}

.detail-block .muted {
  color: #94a3b8;
}

.detail-top,
.user-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.detail-top strong {
  color: #0f172a;
  font-size: 14px;
}

.detail-meta {
  display: flex;
  gap: 12px;
  margin-top: 6px;
  color: #94a3b8;
  font-size: 12px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #475569;
}

.quota-list {
  display: grid;
  gap: 8px;
  margin: 0;
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
