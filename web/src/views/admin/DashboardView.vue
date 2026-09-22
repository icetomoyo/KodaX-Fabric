<template>
  <AdminUsageDashboard v-if="auth.isSuperAdmin" />
  <div v-else class="dashboard-page">
    <div class="panels-grid" :class="{ single: !auth.isSuperAdmin }">
      <section class="page-card panel-card">
        <div class="panel-head">
          <h3 class="panel-title">今日消耗</h3>
          <div class="rank-tools">
            <el-radio-group v-if="rankLevels.length > 1" v-model="rankLevel">
              <el-radio-button
                v-for="level in rankLevels"
                :key="level.value"
                :value="level.value"
              >
                {{ level.label }}
              </el-radio-button>
            </el-radio-group>
            <el-button v-if="rankLink" link type="primary" @click="router.push(rankLink.to)">
              {{ rankLink.label }}
            </el-button>
          </div>
        </div>
        <el-empty
          v-if="!loading && !rankRows.length"
          description="今日暂无用量"
          :image-size="72"
        />
        <div v-else class="usage-tree">
          <div
            v-for="row in rankRows"
            :key="row.key"
            class="usage-tree-row"
            :class="{ root: !isDepartmentTree || row.depth === 0 }"
          >
            <span class="usage-tree-label">
              <span v-if="row.tree" class="usage-tree-prefix">{{ row.tree }}</span>
              <span class="usage-tree-title">{{ row.name }}</span>
              <span v-if="row.sub" class="usage-tree-sub">{{ row.sub }}</span>
            </span>
            <span class="usage-tree-value">{{ formatTokenCompact(row.totalTokens) }}</span>
          </div>
        </div>
      </section>
    </div>

    <section class="page-card hero-card">
      <div class="page-head">
        <div class="head-actions">
          <el-button :loading="loading" @click="load">刷新</el-button>
          <el-button type="primary" @click="router.push(primaryAction.to)">
            {{ primaryAction.label }}
          </el-button>
        </div>
      </div>

      <div v-loading="loading" class="kpi-grid">
        <div
          v-for="item in kpis"
          :key="item.label"
          class="kpi-card"
          :class="item.tone"
        >
          <span class="kpi-label">{{ item.label }}</span>
          <strong class="kpi-value">{{ item.value }}</strong>
          <span class="kpi-foot">
            {{ item.foot }}
            <b v-if="item.footStrong" :class="{ danger: item.danger }">{{ item.footStrong }}</b>
          </span>
        </div>
      </div>

      <div class="quick-links">
        <button
          v-for="link in quickLinks"
          :key="link.to"
          type="button"
          class="quick-link"
          @click="router.push(link.to)"
        >
          <span class="quick-dot" :class="link.dot" />
          <span>
            <strong>{{ link.title }}</strong>
            <small>{{ link.desc }}</small>
          </span>
        </button>
      </div>
    </section>

    <div v-if="auth.isSuperAdmin" class="panels-grid">
      <section class="page-card panel-card">
        <div class="panel-head">
          <h3 class="panel-title">今日按接入平台</h3>
          <el-button v-if="auth.isSuperAdmin" link type="primary" @click="router.push('/admin/temp-channels')">
            渠道
          </el-button>
        </div>
        <el-empty
          v-if="!loading && !(data?.byProviderToday?.length)"
          description="今日暂无调用"
          :image-size="72"
        />
        <div v-else class="provider-list">
          <div
            v-for="row in data?.byProviderToday ?? []"
            :key="String(row.providerCode ?? 'unknown')"
            class="provider-row"
          >
            <div class="provider-identity">
              <span class="provider-dot" :style="providerDotStyle(String(row.providerCode ?? ''))" />
              <div>
                <div class="provider-name">{{ providerLabel(String(row.providerCode ?? "")) }}</div>
                <div class="provider-code">{{ row.providerCode || "unknown" }}</div>
              </div>
            </div>
            <div class="provider-stats">
              <div>
                <span class="stat-label">请求</span>
                <b>{{ formatNumber(row.requests) }}</b>
              </div>
              <div>
                <span class="stat-label">Tokens</span>
                <b>{{ formatTokenCompact(row.tokens) }}</b>
              </div>
            </div>
            <div class="provider-bar-track">
              <div class="provider-bar" :style="{ width: providerBarWidth(row) }" />
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import AdminUsageDashboard from "@/views/admin/AdminUsageDashboard.vue";
import { http } from "@/api/http";
import { formatTokenCompact } from "@/lib/tokens";
import { departmentUsageRows } from "@/lib/department-usage-tree";
import {
  ranksFromMemberUsage,
  ranksFromTeamUsage,
  type MemberUsageRow,
  type TeamUsageRow,
} from "@/lib/workbench-ranks";

import { useAuthStore } from "@/stores/auth";

type OverviewData = {
  role?: "admin" | "org_admin" | "dept_admin";
  enterprises?: { total: number; active: number };
  channels?: { total: number; enabled: number; unavailable: number };
  providers?: number;
  modelRoutesEnabled?: number;
  org?: {
    name?: string;
    teamCount?: number;
    employeeCount?: number;
    monthUsedTokens?: number;
  };
  team?: {
    teamCount?: number;
    memberCount?: number;
    monthUsedTokens?: number;
  };
  today?: { requests: number; tokens: number; errors: number };
  topEnterprisesToday?: Array<{
    enterpriseId?: number;
    enterpriseName?: string;
    totalTokens?: number;
    requestCount?: number;
  }>;
  topDepartmentsToday?: Array<{
    departmentId?: number;
    departmentName?: string;
    enterpriseName?: string;
    totalTokens?: number;
    requestCount?: number;
  }>;
  topTeamsToday?: Array<{
    teamId?: number;
    teamName?: string;
    departmentName?: string;
    enterpriseName?: string;
    totalTokens?: number;
    requestCount?: number;
  }>;
  topMembersToday?: Array<{
    employeeId?: number;
    employeeName?: string;
    teamName?: string;
    teamIsDefault?: boolean;
    departmentName?: string;
    enterpriseName?: string;
    totalTokens?: number;
    requestCount?: number;
  }>;
  departmentUsageTree?: Array<{
    id: number;
    name: string;
    prefix: string;
    depth: number;
    totalTokens: number;
    requestCount: number;
  }>;
  byProviderToday?: Array<{
    providerCode?: string | null;
    requests?: number;
    tokens?: number;
  }>;
  recentErrors?: Array<{
    requestId?: string;
    enterpriseName?: string;
    departmentName?: string;
    teamName?: string;
    teamIsDefault?: boolean;
    employeeName?: string;
    clientModel?: string;
    providerCode?: string | null;
    status?: string;
    createdAt?: string;
  }>;
};

type RankLevel = "enterprise" | "department" | "team" | "employee";

const PROVIDER_META: Record<string, { label: string; color: string }> = {
  glm: { label: "智谱/GLM", color: "#2563eb" },
  kimi: { label: "月之暗面/Kimi", color: "#7c3aed" },
  deepseek: { label: "深度求索/DeepSeek", color: "#0891b2" },
  minimax: { label: "MiniMax", color: "#ea580c" },
};

const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
const data = ref<OverviewData | null>(null);
const role = computed(() => data.value?.role ?? auth.user?.role ?? "admin");

const primaryAction = computed(() => {
  if (role.value === "org_admin" || role.value === "dept_admin") {
    return { to: "/admin/enterprises", label: "部门管理" };
  }
  return { to: "/admin/temp-channels", label: "管理渠道" };
});

type KpiCard = {
  label: string;
  value: string;
  foot: string;
  footStrong?: string;
  danger?: boolean;
  tone: string;
};

const kpis = computed((): KpiCard[] => {
  const today = data.value?.today;
  const errors = Number(today?.errors ?? 0);
  const todayCards: KpiCard[] = [
    {
      label: "今日请求",
      value: formatNumber(today?.requests),
      foot: "失败",
      footStrong: formatNumber(errors),
      danger: errors > 0,
      tone: "",
    },
    {
      label: "今日 Tokens",
      value: formatTokenCompact(today?.tokens),
      foot: role.value === "admin" ? "全平台合计消耗" : "范围内合计消耗",
      tone: "accent",
    },
  ];
  if (role.value === "org_admin") {
    return [
      {
        label: "今日 Tokens",
        value: formatTokenCompact(today?.tokens),
        foot: "本企业今日消耗",
        tone: "accent",
      },
      {
        label: "本月 Tokens",
        value: formatTokenCompact(data.value?.org?.monthUsedTokens ?? 0),
        foot: "本企业本月消耗",
        tone: "",
      },
      {
        label: "团队",
        value: formatNumber(data.value?.org?.teamCount),
        foot: "本企业团队数",
        tone: "",
      },
      {
        label: "员工",
        value: formatNumber(data.value?.org?.employeeCount),
        foot: "本企业账号",
        tone: "success",
      },
    ];
  }
  if (role.value === "dept_admin") {
    return [
      {
        label: "今日 Tokens",
        value: formatTokenCompact(today?.tokens),
        foot: role.value === "dept_admin" ? "本部门今日消耗" : "所管团队今日消耗",
        tone: "accent",
      },
      {
        label: "本月 Tokens",
        value: formatTokenCompact(data.value?.team?.monthUsedTokens ?? 0),
        foot: "所管团队本月消耗",
        tone: "",
      },
      {
        label: "成员",
        value: formatNumber(data.value?.team?.memberCount),
        foot: "所管团队合计",
        tone: "",
      },
      {
        label: "团队",
        value: formatNumber(data.value?.team?.teamCount),
        foot: "所管团队数",
        tone: "success",
      },
    ];
  }
  return [
    ...todayCards,
    {
      label: "企业",
      value: formatNumber(data.value?.enterprises?.active),
      foot: `启用 / 共 ${formatNumber(data.value?.enterprises?.total)}`,
      tone: "",
    },
    {
      label: "启用渠道",
      value: formatNumber(data.value?.channels?.enabled),
      foot: `共 ${formatNumber(data.value?.channels?.total)} 个渠道`,
      tone: "success",
    },
    {
      label: "异常渠道",
      value: formatNumber(data.value?.channels?.unavailable),
      foot: "已启用但暂无可调度 Key",
      tone: (data.value?.channels?.unavailable ?? 0) > 0 ? "danger" : "",
    },
    {
      label: "接入平台",
      value: formatNumber(data.value?.providers),
      foot: `启用路由 ${formatNumber(data.value?.modelRoutesEnabled)}`,
      tone: "muted",
    },
  ];
});

const quickLinks = computed(() => {
  if (role.value === "org_admin") {
    return [
      { to: "/admin/enterprises", title: "部门管理", desc: "部门 · 员工", dot: "blue" },
      { to: "/admin/keys", title: "API Key", desc: "我的调用凭据", dot: "teal" },
      { to: "/admin/profile", title: "个人中心", desc: "账号、密码与渠道 KEY", dot: "amber" },
    ];
  }
  if (role.value === "dept_admin") {
    return [
      { to: "/admin/enterprises", title: "部门管理", desc: "部门 · 员工", dot: "blue" },
      { to: "/admin/keys", title: "API Key", desc: "我的调用凭据", dot: "teal" },
      { to: "/admin/profile", title: "个人中心", desc: "账号、密码与渠道 KEY", dot: "amber" },
    ];
  }
  return [
    { to: "/admin/temp-channels", title: "上游渠道", desc: "渠道 · 席位 · KEY", dot: "blue" },
    { to: "/admin/enterprises", title: "企业管理", desc: "企业 · 部门 · 团队 · 员工", dot: "violet" },
    { to: "/admin/logs", title: "调用日志", desc: "按企业 / 部门 / 团队 / 员工排障", dot: "teal" },
    { to: "/admin/model-prices", title: "模型列表", desc: "渠道可用模型", dot: "amber" },
  ];
});

const rankLevels = computed(() => {
  if (role.value === "admin") {
    return [
      { value: "enterprise" as const, label: "企业" },
      { value: "department" as const, label: "部门" },
      { value: "team" as const, label: "团队" },
      { value: "employee" as const, label: "员工" },
    ];
  }
  if (role.value === "org_admin" || role.value === "dept_admin") {
    return [
      { value: "department" as const, label: "部门" },
      { value: "employee" as const, label: "员工" },
    ];
  }
  return [
    { value: "department" as const, label: "部门" },
    { value: "employee" as const, label: "员工" },
  ];
});

const rankLevel = ref<RankLevel>("department");
const isDepartmentTree = computed(() =>
  rankLevel.value === "department" && Boolean(data.value?.departmentUsageTree?.length),
);
watch(
  rankLevels,
  (levels) => {
    if (!levels.some((level) => level.value === rankLevel.value)) {
      rankLevel.value = levels[0]?.value ?? "employee";
    }
  },
  { immediate: true },
);

const rankLink = computed(() => {
  if (role.value === "org_admin" || role.value === "dept_admin") {
    return { to: "/admin/enterprises", label: "部门管理" };
  }
  return { to: "/admin/logs", label: "查看日志" };
});

function rowsFor(level: RankLevel) {
  if (level === "enterprise") return data.value?.topEnterprisesToday ?? [];
  if (level === "department") {
    return data.value?.departmentUsageTree?.length
      ? data.value.departmentUsageTree
      : data.value?.topDepartmentsToday ?? [];
  }
  if (level === "team") return data.value?.topTeamsToday ?? [];
  return data.value?.topMembersToday ?? [];
}

const rankRows = computed(() => {
  if (rankLevel.value === "enterprise") {
    return (data.value?.topEnterprisesToday ?? []).map((row, index) => ({
      key: String(row.enterpriseId ?? index),
      name: row.enterpriseName || "—",
      tree: "",
      depth: 0,
      sub: "",
      totalTokens: Number(row.totalTokens) || 0,
      requestCount: Number(row.requestCount) || 0,
    }));
  }
  if (rankLevel.value === "department") {
    const tree = data.value?.departmentUsageTree ?? [];
    if (tree.length) {
      return tree.map((row) => ({
        key: `dept:${row.id}`,
        name: row.name,
        tree: row.prefix,
        depth: row.depth,
        sub: "",
        totalTokens: Number(row.totalTokens) || 0,
        requestCount: Number(row.requestCount) || 0,
      }));
    }
    return (data.value?.topDepartmentsToday ?? []).map((row, index) => ({
      key: String(row.departmentId ?? index),
      name: row.departmentName || "—",
      tree: "",
      depth: 0,
      sub: row.enterpriseName || "",
      totalTokens: Number(row.totalTokens) || 0,
      requestCount: Number(row.requestCount) || 0,
    }));
  }
  if (rankLevel.value === "team") {
    return (data.value?.topTeamsToday ?? []).map((row, index) => ({
      key: String(row.teamId ?? index),
      name: row.teamName || "—",
      tree: "",
      depth: 0,
      sub: orgPath({
        enterpriseName: row.enterpriseName,
        departmentName: row.departmentName,
      }),
      totalTokens: Number(row.totalTokens) || 0,
      requestCount: Number(row.requestCount) || 0,
    }));
  }
  return (data.value?.topMembersToday ?? []).map((row, index) => ({
    key: String(row.employeeId ?? index),
    name: row.employeeName || "—",
    tree: "",
    depth: 0,
    sub: orgPath(row),
    totalTokens: Number(row.totalTokens) || 0,
    requestCount: Number(row.requestCount) || 0,
  }));
});

const maxProviderRequests = computed(() => {
  const list = data.value?.byProviderToday ?? [];
  return Math.max(1, ...list.map((row) => Number(row.requests) || 0));
});

function orgPath(row: {
  enterpriseName?: string;
  departmentName?: string;
  teamName?: string;
  teamIsDefault?: boolean;
}): string {
  const parts = [row.enterpriseName, row.departmentName];
  if (row.teamName && !row.teamIsDefault) parts.push(row.teamName);
  return parts.filter(Boolean).join(" · ");
}

function formatNumber(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("zh-CN").format(n);
}

function providerLabel(code: string): string {
  if (!code || code === "—") return "—";
  return PROVIDER_META[code]?.label ?? code;
}

function providerDotStyle(code: string): Record<string, string> {
  return { background: PROVIDER_META[code]?.color ?? "#94a3b8" };
}

function providerBarWidth(row: { requests?: number }): string {
  const requests = Number(row.requests) || 0;
  return `${Math.max(6, Math.round((requests / maxProviderRequests.value) * 100))}%`;
}

type TeamListRow = TeamUsageRow & {
  memberCount?: number;
  todayTotalTokens?: number;
};

type TeamMemberRow = {
  employeeId: number;
  name: string;
  todayTotalTokens?: number;
};

async function loadTeamUsage(): Promise<TeamListRow[]> {
  const res = await http.get("/api/admin/teams");
  return (res.data.success ? res.data.data : []) as TeamListRow[];
}

async function loadMemberUsage(teams: TeamListRow[]): Promise<MemberUsageRow[]> {
  const active = teams.filter((row) => (Number(row.todayTotalTokens) || 0) > 0);
  const groups = await Promise.all(
    active.map(async (team) => {
      try {
        const res = await http.get(`/api/admin/teams/${team.id}/members`);
        const members = (res.data.success ? res.data.data : []) as TeamMemberRow[];
        return members.map((member) => ({
          employeeId: member.employeeId,
          name: member.name,
          todayTotalTokens: member.todayTotalTokens,
          teamId: team.id,
          teamName: team.name,
          teamIsDefault: team.isDefault,
          departmentName: team.departmentName,
          enterpriseName: team.enterpriseName,
        }));
      } catch {
        return [];
      }
    }),
  );
  return groups.flat();
}

function withRequestCounts(
  teams: ReturnType<typeof ranksFromTeamUsage>["topTeamsToday"],
  source: NonNullable<OverviewData["topTeamsToday"]>,
) {
  const requests = new Map(
    source.map((row) => [row.teamId, Number(row.requestCount) || 0]),
  );
  return teams.map((row) => ({
    ...row,
    requestCount: requests.get(row.teamId) || row.requestCount,
  }));
}

async function load() {
  loading.value = true;
  try {
    const res = await http.get("/api/admin/overview");
    if (!res.data.success) return;
    const overview = res.data.data as OverviewData;
    let next = overview;
    const needsOrgRanks = !Array.isArray(overview.topEnterprisesToday)
      || !Array.isArray(overview.topDepartmentsToday);
    const needsMembers = !Array.isArray(overview.topMembersToday);
    const needsDepartmentTree = !Array.isArray(overview.departmentUsageTree);
    if (needsOrgRanks || needsMembers || needsDepartmentTree) {
      const teams = await loadTeamUsage();
      if (needsOrgRanks) {
        const ranks = ranksFromTeamUsage(teams);
        next = {
          ...next,
          ...ranks,
          topTeamsToday: withRequestCounts(ranks.topTeamsToday, overview.topTeamsToday ?? []),
        };
      }
      if (needsDepartmentTree) {
        try {
          const deptRes = await http.get("/api/admin/departments");
          const departments = deptRes.data.success
            ? (deptRes.data.data as Array<{
              id: number;
              name: string;
              parentId?: number | null;
              isDefault?: boolean;
            }>)
            : [];
          const own = new Map<number, { departmentId: number; totalTokens: number; requestCount: number }>();
          for (const team of teams) {
            if (team.departmentId == null) continue;
            const current = own.get(team.departmentId);
            const tokens = Number(team.todayTotalTokens) || 0;
            const requests = Number(team.requestCount) || 0;
            own.set(team.departmentId, {
              departmentId: team.departmentId,
              totalTokens: (current?.totalTokens ?? 0) + tokens,
              requestCount: (current?.requestCount ?? 0) + requests,
            });
          }
          next = {
            ...next,
            departmentUsageTree: departmentUsageRows(departments, [...own.values()]),
          };
        } catch {
          next = { ...next, departmentUsageTree: [] };
        }
      }
      if (needsMembers) {
        next = {
          ...next,
          topMembersToday: ranksFromMemberUsage(await loadMemberUsage(teams)),
        };
      }
    }
    data.value = next;
    if (!rowsFor(rankLevel.value).length) {
      const fallback = rankLevels.value.find((level) => rowsFor(level.value).length);
      if (fallback) rankLevel.value = fallback.value;
    }
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 403) return;
    const message = (error as { response?: { data?: { message?: unknown } } })
      ?.response?.data?.message;
    ElMessage.error(typeof message === "string" ? message : "加载工作台失败");
  } finally {
    loading.value = false;
  }
}

watch(
  () => [auth.user?.role, auth.user?.enterpriseId, auth.actAs?.departmentId, auth.actAs?.teamId],
  () => {
    if (!auth.isSuperAdmin) void load();
  },
);

onMounted(() => {
  if (!auth.isSuperAdmin) void load();
});
</script>

<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.hero-card {
  padding-bottom: 18px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 18px;
}

.head-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}

.kpi-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 112px;
  padding: 14px 16px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}

.kpi-card.accent {
  border-color: #bfdbfe;
  background: linear-gradient(180deg, #eff6ff 0%, #f8fafc 100%);
}

.kpi-card.success {
  border-color: #bbf7d0;
  background: linear-gradient(180deg, #f0fdf4 0%, #f8fafc 100%);
}

.kpi-card.danger {
  border-color: #fecaca;
  background: linear-gradient(180deg, #fef2f2 0%, #fff7f7 100%);
}

.kpi-card.muted {
  background: linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%);
}

.kpi-label {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.kpi-value {
  color: #0f172a;
  font-size: 28px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.kpi-foot {
  margin-top: auto;
  color: #94a3b8;
  font-size: 12px;
}

.kpi-foot b {
  color: #334155;
  font-weight: 650;
}

.kpi-foot b.danger {
  color: #dc2626;
}

.quick-links {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
}

.quick-link {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 12px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.quick-link:hover {
  border-color: #93c5fd;
  background: #f8fbff;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
}

.quick-link strong {
  display: block;
  color: #0f172a;
  font-size: 14px;
}

.quick-link small {
  display: block;
  margin-top: 2px;
  color: #94a3b8;
  font-size: 12px;
}

.quick-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border-radius: 50%;
  box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.14);
}

.quick-dot.blue {
  background: #2563eb;
}

.quick-dot.violet {
  background: #7c3aed;
}

.quick-dot.teal {
  background: #0d9488;
}

.quick-dot.amber {
  background: #d97706;
}

.panels-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.panels-grid.single {
  grid-template-columns: 1fr;
}

.panel-card {
  min-width: 0;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.panel-title {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
  font-weight: 650;
}

.rank-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.provider-row {
  display: grid;
  gap: 8px 12px;
  padding: 12px;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  background: #f8fafc;
}

.usage-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0 8px;
}

.usage-tree-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 24px;
  min-height: 34px;
  padding: 4px 12px;
  border-radius: 8px;
}

.usage-tree-row:hover {
  background: #f1f5f9;
}

.usage-tree-label {
  display: flex;
  min-width: 0;
  align-items: baseline;
}

.usage-tree-prefix {
  flex: none;
  color: #94a3b8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre;
}

.usage-tree-title {
  overflow: hidden;
  color: #334155;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.6;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usage-tree-row.root .usage-tree-title {
  color: #0f172a;
  font-weight: 700;
}

.usage-tree-value {
  flex: none;
  color: #64748b;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.usage-tree-row.root .usage-tree-value {
  color: #0f172a;
  font-size: 14px;
}

.usage-tree-sub {
  overflow: hidden;
  margin-left: 8px;
  color: #94a3b8;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-name {
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
}

.provider-code {
  margin-top: 2px;
  color: #94a3b8;
  font-size: 12px;
}

.provider-bar-track {
  grid-column: 1 / -1;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: #e2e8f0;
}

.provider-bar {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #60a5fa, #2563eb);
}

.provider-row {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.provider-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.provider-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border-radius: 50%;
  box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.14);
}

.provider-stats {
  display: flex;
  gap: 18px;
  font-variant-numeric: tabular-nums;
}

.provider-stats .stat-label {
  display: block;
  margin-bottom: 2px;
  color: #94a3b8;
  font-size: 11px;
}

.provider-stats b {
  color: #0f172a;
  font-size: 14px;
}

.provider-bar {
  background: linear-gradient(90deg, #34d399, #059669);
}

.errors-card {
  overflow: hidden;
}

.errors-table {
  width: 100%;
}

.mono-cell {
  color: #475569;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

@media (max-width: 1280px) {
  .kpi-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .quick-links {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .panels-grid {
    grid-template-columns: 1fr;
  }

  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .page-head,
  .panel-head {
    flex-direction: column;
  }

  .kpi-grid,
  .quick-links {
    grid-template-columns: 1fr;
  }

  .head-actions {
    width: 100%;
  }
}
</style>
