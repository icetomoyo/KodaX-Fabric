<template>
  <div class="bindings-page">
    <section class="page-card toolbar-card">
      <div class="page-head">
        <h2 class="page-title">调度画布</h2>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
    </section>

    <section class="page-card canvas-shell" v-loading="loading">
      <el-empty
        v-if="!loading && !boards.length"
        description="没有可展示的绑定关系"
        :image-size="88"
      />
      <el-tabs
        v-else
        v-model="activeBoardKey"
        class="board-tabs"
        @tab-change="onTabChange"
      >
        <el-tab-pane
          v-for="board in boards"
          :key="board.key"
          :name="board.key"
          :label="board.title"
          lazy
        >
          <KeyBindingCanvas
            v-model:nodes="board.nodes"
            v-model:edges="board.edges"
            :active="activeBoardKey === board.key"
            @node-click="(event) => onNodeClick(board.key, event)"
            @pane-click="() => onPaneClick(board.key)"
          />
        </el-tab-pane>
      </el-tabs>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import KeyBindingCanvas from "@/components/KeyBindingCanvas.vue";
import { MarkerType, type Edge, type Node, type NodeMouseEvent } from "@vue-flow/core";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";

type BindingKind = "org" | "owns" | "dedicated" | "team_shared" | "enterprise_shared" | "open_shared";
type UseBindingKind = "dedicated" | "team_shared" | "enterprise_shared" | "open_shared";
type NodeKind = "enterprise" | "team" | "employee" | "virtual_key" | "credential" | "lane_header";
type CoolingKind = "five_hour" | "weekly" | "other";
type CredentialLane = "bound" | "pending" | "cooling_5h" | "cooling_weekly" | "disabled";

type UsageTier = "idle" | "standard" | "heavy";

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
  coolingKind?: CoolingKind | null;
  coolUntil?: string | null;
  supportedProtocols: string[];
  bound?: boolean;
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

type CanvasBoard = {
  key: string;
  title: string;
  mode: "enterprise" | "pool";
  nodes: any[];
  edges: any[];
};

const COL_X = {
  enterprise: 0,
  team: 360,
  employee: 720,
  virtual_key: 1080,
  bound: 1440,
  pending: 1800,
  cooling_5h: 2160,
  cooling_weekly: 2520,
  disabled: 2880,
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
const LIVE_POLL_MS = 2000;

const loading = ref(false);
const graph = ref<KeyBindingGraph | null>(null);
const selectedNodeId = ref<string | null>(null);
const selectedBoardKey = ref<string | null>(null);
const activeBoardKey = ref("");
const boards = ref<CanvasBoard[]>([]);
const lastLive = ref<RelayLiveLoad | null>(null);

function nodeId(type: NodeKind, id: number): string {
  return `${type}:${id}`;
}

function useEdgeStyle(kind: BindingKind): Record<string, string | number | undefined> {
  if (kind === "dedicated") {
    return { stroke: "#2563eb", strokeWidth: 2 };
  }
  if (kind === "team_shared") {
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

function isUseEdgeKind(kind: BindingKind): kind is UseBindingKind {
  return (
    kind === "dedicated" ||
    kind === "team_shared" ||
    kind === "enterprise_shared" ||
    kind === "open_shared"
  );
}

function boundCredentialIds(source: KeyBindingGraph): Set<number> {
  const keyIds = new Set(source.virtualKeys.map((row) => row.id));
  const ids = new Set<number>();
  for (const edge of source.edges) {
    if (!isUseEdgeKind(edge.kind)) continue;
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

function subgraphForEmployees(source: KeyBindingGraph, employees: GraphEmployee[]): KeyBindingGraph {
  const employeeIds = new Set(employees.map((row) => row.id));
  const virtualKeys = source.virtualKeys.filter((row) => employeeIds.has(row.employeeId));
  const keyIds = new Set(virtualKeys.map((row) => row.id));
  const teamIds = new Set(
    employees.map((row) => row.teamId).filter((id): id is number => id != null),
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
    teams: source.teams.filter((row) => teamIds.has(row.id)),
    virtualKeys,
    credentials: source.credentials.filter((row) => useTargets.has(row.id)),
    edges,
    enterprises: source.enterprises.filter((row) => enterpriseIds.has(row.id)),
  };
}

function splitIntoBoards(source: KeyBindingGraph): Array<{
  key: string;
  title: string;
  mode: "enterprise" | "pool";
  graph: KeyBindingGraph;
}> {
  const byEnterprise = new Map<number | "none", GraphEmployee[]>();
  for (const employee of source.employees) {
    const key = employee.enterpriseId ?? "none";
    const list = byEnterprise.get(key) ?? [];
    list.push(employee);
    byEnterprise.set(key, list);
  }
  const named = [...byEnterprise.entries()].sort((a, b) => {
    const nameA = a[1][0]?.enterpriseName || "未加入企业";
    const nameB = b[1][0]?.enterpriseName || "未加入企业";
    if (a[0] === "none") return 1;
    if (b[0] === "none") return -1;
    return nameA.localeCompare(nameB, "zh");
  });
  const boards: Array<{
    key: string;
    title: string;
    mode: "enterprise" | "pool";
    graph: KeyBindingGraph;
  }> = named.map(([key, employees]) => {
    const graph = subgraphForEmployees(source, employees);
    return {
      key: key === "none" ? "none" : `ent:${key}`,
      title: employees[0]?.enterpriseName || "未加入企业",
      mode: "enterprise",
      graph,
    };
  });
  const boundIds = boundCredentialIds(source);
  const poolCredentials = source.credentials.filter(
    (row) => credentialLane(row, boundIds) !== "bound",
  );
  if (poolCredentials.length) {
    boards.push({
      key: "pool",
      title: "未绑定 Key 池",
      mode: "pool",
      graph: {
        ...source,
        employees: [],
        teams: [],
        virtualKeys: [],
        credentials: poolCredentials,
        edges: [],
        enterprises: [],
      },
    });
  }
  return boards;
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

function layoutGraph(
  source: KeyBindingGraph,
  mode: "enterprise" | "pool" = "enterprise",
): { nodes: Node[]; edges: Edge[] } {
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
  const virtualKeyY = new Map<number, number>();
  let cursor = 0;
  if (mode === "enterprise") for (const ent of entBlocks) {
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
    cooling_5h: [],
    cooling_weekly: [],
    disabled: [],
  };
  for (const credential of source.credentials) {
    credentialsByLane[credentialLane(credential, boundIds)].push(credential);
  }

  const boundTargets = new Map<number, number[]>();
  for (const edge of source.edges) {
    if (!isUseEdgeKind(edge.kind)) continue;
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
        makeNode("credential", item.credential.id, COL_X.bound, y, {
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

  const laidEdges: Edge[] = source.edges.map((edge) => {
    const useEdge = isUseEdgeKind(edge.kind);
    return {
      id: edge.id,
      source: nodeId(edge.sourceType, edge.sourceId),
      target: nodeId(edge.targetType, edge.targetId),
      type: useEdge ? "traffic" : "step",
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
  for (const board of boards.value) {
    const selected =
      selectedBoardKey.value === board.key ? selectedNodeId.value : null;
    const related = selected ? relatedIds(selected, board.edges) : null;
    for (const node of board.nodes) {
      if (node.type === "lane_header") continue;
      node.data.active = node.id === selected;
      node.data.dimmed = related != null && !related.has(node.id);
    }
    for (const edge of board.edges) {
      const keep = related == null || (related.has(edge.source) && related.has(edge.target));
      edge.style = {
        ...(edge.style ?? {}),
        opacity: keep ? 1 : 0.12,
      };
      if (edge.data) edge.data.dimmed = !keep;
    }
  }
}

function parseNodeNumericId(id: string): number | null {
  const value = Number(id.slice(id.indexOf(":") + 1));
  return Number.isSafeInteger(value) ? value : null;
}

function patchGraphData(
  target: { data?: any },
  patch: { working: boolean; afterglow: boolean; inFlight: number },
) {
  const current = target.data ?? {};
  if (
    current.working === patch.working &&
    current.afterglow === patch.afterglow &&
    current.inFlight === patch.inFlight
  ) {
    return;
  }
  target.data = { ...current, ...patch };
}

function applyLiveLoad() {
  const live = lastLive.value;
  const keyLoad = new Map((live?.keys ?? []).map((row) => [row.id, row]));
  const credLoad = new Map((live?.credentials ?? []).map((row) => [row.id, row]));
  const hopLoad = new Map(
    (live?.hops ?? []).map((row) => [`${row.virtualKeyId}:${row.credentialId}`, row]),
  );
  const workingEmployees = new Set<number>();
  const allNodes: any[] = [];
  const allEdges: any[] = [];
  for (const board of boards.value) {
    for (const node of board.nodes) allNodes.push(node);
    for (const edge of board.edges) allEdges.push(edge);
  }

  for (const node of allNodes) {
    if (node.type === "lane_header") continue;
    if (node.type === "virtual_key") {
      const load = keyLoad.get(Number(node.data.id));
      const working = Boolean(load && (load.inFlight > 0 || load.afterglow));
      patchGraphData(node, {
        working,
        afterglow: Boolean(working && load && load.inFlight <= 0),
        inFlight: load?.inFlight ?? 0,
      });
      if (working && typeof node.data.employeeId === "number") {
        workingEmployees.add(node.data.employeeId);
      }
      continue;
    }
    if (node.type === "credential") {
      const load = credLoad.get(Number(node.data.id));
      const working = Boolean(load && (load.inFlight > 0 || load.afterglow));
      patchGraphData(node, {
        working,
        afterglow: Boolean(working && load && load.inFlight <= 0),
        inFlight: load?.inFlight ?? 0,
      });
      continue;
    }
    patchGraphData(node, { working: false, afterglow: false, inFlight: 0 });
  }
  for (const node of allNodes) {
    if (node.type !== "employee") continue;
    patchGraphData(node, {
      working: workingEmployees.has(Number(node.data.id)),
      afterglow: false,
      inFlight: 0,
    });
  }

  for (const edge of allEdges) {
    const kind = edge.data?.kind as BindingKind | undefined;
    if (!kind || !isUseEdgeKind(kind) || !edge.data) {
      if (edge.data) patchGraphData(edge, { working: false, afterglow: false, inFlight: 0 });
      continue;
    }
    const sourceId = parseNodeNumericId(String(edge.source));
    const targetId = parseNodeNumericId(String(edge.target));
    const hop =
      sourceId != null && targetId != null ? hopLoad.get(`${sourceId}:${targetId}`) : undefined;
    const working = Boolean(hop && (hop.inFlight > 0 || hop.afterglow));
    patchGraphData(edge, {
      working,
      afterglow: Boolean(working && hop && hop.inFlight <= 0),
      inFlight: hop?.inFlight ?? 0,
    });
  }
}

function renderGraph() {
  if (!graph.value) {
    boards.value = [];
    activeBoardKey.value = "";
    return;
  }
  const nextBoards = splitIntoBoards(graph.value).map((item) => {
    const laid = layoutGraph(item.graph, item.mode);
    return {
      key: item.key,
      title: item.title,
      mode: item.mode,
      nodes: laid.nodes,
      edges: laid.edges,
    };
  });
  boards.value = nextBoards;
  if (!nextBoards.some((board) => board.key === activeBoardKey.value)) {
    activeBoardKey.value = nextBoards[0]?.key ?? "";
  }
  applyHighlight();
  applyLiveLoad();
}

function onTabChange() {
  selectedNodeId.value = null;
  selectedBoardKey.value = null;
  applyHighlight();
}

function onNodeClick(boardKey: string, event: NodeMouseEvent) {
  if (selectedBoardKey.value === boardKey && selectedNodeId.value === event.node.id) {
    selectedBoardKey.value = null;
    selectedNodeId.value = null;
  } else {
    selectedBoardKey.value = boardKey;
    selectedNodeId.value = event.node.id;
  }
  applyHighlight();
}

function onPaneClick(boardKey: string) {
  if (selectedBoardKey.value !== boardKey) return;
  selectedBoardKey.value = null;
  selectedNodeId.value = null;
  applyHighlight();
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/key-bindings");
    if (!data.success) {
      throw new Error(data.message || "加载失败");
    }
    graph.value = data.data;
    selectedNodeId.value = null;
    selectedBoardKey.value = null;
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
    lastLive.value = data.data;
    applyLiveLoad();
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

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.toolbar-card {
  flex-shrink: 0;
}

.canvas-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.canvas-shell :deep(.el-empty) {
  margin: auto;
}

.board-tabs {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.board-tabs :deep(.el-tabs__header) {
  flex-shrink: 0;
  margin: 0;
  padding: 8px 16px 0;
}

.board-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.board-tabs :deep(.el-tab-pane) {
  height: 100%;
}
</style>
