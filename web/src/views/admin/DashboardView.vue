<template>
  <div class="dashboard-page">
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

    <div class="panels-grid" :class="{ single: !auth.isSuperAdmin }">
      <section class="page-card panel-card">
        <div class="panel-head">
          <h3 class="panel-title">{{ rankTitle }}</h3>
          <el-button v-if="rankLink" link type="primary" @click="router.push(rankLink.to)">
            {{ rankLink.label }}
          </el-button>
        </div>
        <el-empty
          v-if="!loading && !rankRows.length"
          description="今日暂无用量"
          :image-size="72"
        />
        <div v-else class="rank-list">
          <div
            v-for="(row, index) in rankRows"
            :key="row.key"
            class="rank-row"
          >
            <span class="rank-index" :class="{ top: index < 3 }">{{ index + 1 }}</span>
            <div class="rank-main">
              <div class="rank-name">{{ row.name }}</div>
              <div class="rank-sub">{{ row.sub }}</div>
            </div>
            <div class="rank-metrics">
              <strong>{{ formatTokenCompact(row.totalTokens) }}</strong>
              <span v-if="row.requestCount">{{ formatNumber(row.requestCount) }} 次</span>
            </div>
            <div class="rank-bar-track">
              <div class="rank-bar" :style="{ width: topUserBarWidth(row) }" />
            </div>
          </div>
        </div>
      </section>


      <section v-if="auth.isSuperAdmin" class="page-card panel-card">
        <div class="panel-head">
          <h3 class="panel-title">今日按接入平台</h3>
          <el-button v-if="auth.isSuperAdmin" link type="primary" @click="router.push('/admin/credentials')">
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

    <section class="page-card panel-card errors-card">
      <div class="panel-head">
        <h3 class="panel-title">最近失败请求</h3>
        <el-button link type="primary" @click="router.push('/admin/error-logs')">
          报错日志
        </el-button>
      </div>

      <el-empty
        v-if="!loading && !(data?.recentErrors?.length)"
        description="暂无失败记录"
        :image-size="72"
      />
      <el-table
        v-else
        v-loading="loading"
        :data="data?.recentErrors ?? []"
        size="small"
        class="errors-table"
        empty-text="暂无失败记录"
      >
        <el-table-column label="时间" min-width="170">
          <template #default="{ row }">
            <span class="mono-cell">{{ formatDateTime(row.createdAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="企业 / 团队" min-width="160">
          <template #default="{ row }">
            {{ row.enterpriseName || "—" }}
            <span v-if="row.teamName"> · {{ row.teamName }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="clientModel" label="模型" min-width="120" show-overflow-tooltip />
        <el-table-column label="上游" min-width="100">
          <template #default="{ row }">
            {{ providerLabel(String(row.providerCode ?? "—")) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag type="danger" size="small" effect="light">
              {{ statusLabel(String(row.status ?? "")) }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";
import { formatTokenCompact } from "@/lib/tokens";

import { useAuthStore } from "@/stores/auth";

type OverviewData = {
  role?: "admin" | "org_admin" | "dept_admin" | "team_admin";
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
  topTeamsToday?: Array<{
    teamId?: number;
    teamName?: string;
    enterpriseName?: string;
    totalTokens?: number;
    requestCount?: number;
  }>;
  topMembersToday?: Array<{
    employeeId?: number;
    employeeName?: string;
    sub?: string;
    totalTokens?: number;
    requestCount?: number;
  }>;
  byProviderToday?: Array<{
    providerCode?: string | null;
    requests?: number;
    tokens?: number;
  }>;
  recentErrors?: Array<{
    requestId?: string;
    enterpriseName?: string;
    teamName?: string;
    employeeName?: string;
    clientModel?: string;
    providerCode?: string | null;
    status?: string;
    createdAt?: string;
  }>;
};

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
  if (role.value === "org_admin") return { to: "/admin/enterprises", label: "本企业编制" };
  if (role.value === "dept_admin") return { to: "/admin/enterprises", label: "本部门编制" };
  if (role.value === "team_admin") return { to: "/admin/enterprises", label: "员工" };
  return { to: "/admin/credentials", label: "管理渠道" };
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
  if (role.value === "dept_admin" || role.value === "team_admin") {
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
      { to: "/admin/enterprises", title: "本企业编制", desc: "部门 · 团队 · 员工", dot: "blue" },
      { to: "/admin/error-logs", title: "报错日志", desc: "本企业异常", dot: "violet" },
      { to: "/admin/keys", title: "API Key", desc: "我的调用凭据", dot: "teal" },
      { to: "/admin/profile", title: "个人中心", desc: "账号与密码", dot: "amber" },
    ];
  }
  if (role.value === "dept_admin") {
    return [
      { to: "/admin/enterprises", title: "本部门编制", desc: "团队 · 员工", dot: "blue" },
      { to: "/admin/error-logs", title: "报错日志", desc: "本部门异常", dot: "violet" },
      { to: "/admin/keys", title: "API Key", desc: "我的调用凭据", dot: "teal" },
      { to: "/admin/profile", title: "个人中心", desc: "账号与密码", dot: "amber" },
    ];
  }
  if (role.value === "team_admin") {
    return [
      { to: "/admin/enterprises", title: "员工", desc: "本团队成员", dot: "blue" },
      { to: "/admin/error-logs", title: "报错日志", desc: "本团队异常", dot: "violet" },
      { to: "/admin/keys", title: "API Key", desc: "我的调用凭据", dot: "teal" },
      { to: "/admin/profile", title: "个人中心", desc: "账号与密码", dot: "amber" },
    ];
  }
  return [
    { to: "/admin/credentials", title: "上游渠道", desc: "凭证池 · 连通测试 · 启停", dot: "blue" },
    { to: "/admin/enterprises", title: "企业管理", desc: "启停企业", dot: "violet" },
    { to: "/admin/logs", title: "调用日志", desc: "按企业 / 团队 / 员工排障", dot: "teal" },
    { to: "/admin/model-prices", title: "模型列表", desc: "渠道可用模型", dot: "amber" },
  ];
});

const rankTitle = computed(() =>
  role.value === "team_admin" || role.value === "dept_admin"
    ? "今日消耗 Top 成员"
    : "今日消耗 Top 团队",
);
const rankLink = computed(() => {
  if (role.value === "org_admin") return { to: "/admin/enterprises", label: "编制" };
  if (role.value === "dept_admin") return { to: "/admin/enterprises", label: "编制" };
  if (role.value === "team_admin") return { to: "/admin/enterprises", label: "员工" };
  return { to: "/admin/logs", label: "查看日志" };
});

const rankRows = computed(() => {
  if (role.value === "team_admin" || role.value === "dept_admin") {
    return (data.value?.topMembersToday ?? []).map((row, index) => ({
      key: String(row.employeeId ?? index),
      name: row.employeeName || "—",
      sub: row.sub || "成员",
      totalTokens: Number(row.totalTokens) || 0,
      requestCount: Number(row.requestCount) || 0,
    }));
  }
  return (data.value?.topTeamsToday ?? []).map((row, index) => ({
    key: String(row.teamId ?? index),
    name: row.teamName || "—",
    sub: row.enterpriseName || "—",
    totalTokens: Number(row.totalTokens) || 0,
    requestCount: Number(row.requestCount) || 0,
  }));
});

const maxTopTokens = computed(() => {
  const list = rankRows.value;
  return Math.max(1, ...list.map((row) => Number(row.totalTokens) || 0));
});

const maxProviderRequests = computed(() => {
  const list = data.value?.byProviderToday ?? [];
  return Math.max(1, ...list.map((row) => Number(row.requests) || 0));
});

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

function topUserBarWidth(row: { totalTokens?: number }): string {
  const tokens = Number(row.totalTokens) || 0;
  return `${Math.max(6, Math.round((tokens / maxTopTokens.value) * 100))}%`;
}

function providerBarWidth(row: { requests?: number }): string {
  const requests = Number(row.requests) || 0;
  return `${Math.max(6, Math.round((requests / maxProviderRequests.value) * 100))}%`;
}

function statusLabel(status: string): string {
  return (
    {
      upstream_error: "上游错误",
      client_error: "客户端错误",
      cancelled: "已取消",
      success: "成功",
    }[status] ?? (status || "失败")
  );
}

type TeamListRow = {
  id: number;
  name: string;
  enterpriseName?: string;
  memberCount?: number;
  todayTotalTokens?: number;
  monthTotalTokens?: number;
};

type TeamMemberRow = {
  employeeId: number;
  name: string;
  role?: "member" | "team_admin";
  todayTotalTokens?: number;
};

function sumNumber(rows: TeamListRow[], pick: (row: TeamListRow) => unknown): number {
  return rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);
}

async function loadScopedWorkbench() {
  const teamsRes = await http.get("/api/admin/teams");
  const teams = (teamsRes.data.success ? teamsRes.data.data : []) as TeamListRow[];
  let employeeCount = 0;
  if (auth.isOrgAdmin) {
    const usersRes = await http.get("/api/admin/users", { params: { limit: 200 } });
    employeeCount = usersRes.data.success ? (usersRes.data.data as unknown[]).length : 0;
  }
  let topMembers: NonNullable<OverviewData["topMembersToday"]> = [];
  if (auth.isTeamAdmin || auth.isDeptAdmin) {
    const memberLists = await Promise.all(
      teams.map(async (team) => {
        try {
          const res = await http.get(`/api/admin/teams/${team.id}/members`);
          const members = (res.data.success ? res.data.data : []) as TeamMemberRow[];
          return members.map((member) => ({
            employeeId: member.employeeId,
            employeeName: member.name,
            sub: `${team.name} · ${member.role === "team_admin" ? "团队管理员" : "成员"}`,
            totalTokens: Number(member.todayTotalTokens) || 0,
            requestCount: 0,
          }));
        } catch {
          return [];
        }
      }),
    );
    topMembers = memberLists
      .flat()
      .sort((left, right) => (right.totalTokens || 0) - (left.totalTokens || 0))
      .slice(0, 10);
  }
  const topTeams = [...teams]
    .sort((left, right) => (Number(right.todayTotalTokens) || 0) - (Number(left.todayTotalTokens) || 0))
    .slice(0, 10)
    .map((row) => ({
      teamId: row.id,
      teamName: row.name,
      enterpriseName: row.enterpriseName,
      totalTokens: Number(row.todayTotalTokens) || 0,
      requestCount: 0,
    }));
  data.value = {
    role: auth.isOrgAdmin ? "org_admin" : auth.isDeptAdmin ? "dept_admin" : "team_admin",
    org: {
      teamCount: teams.length,
      employeeCount,
      monthUsedTokens: sumNumber(teams, (row) => row.monthTotalTokens),
    },
    team: {
      teamCount: teams.length,
      memberCount: sumNumber(teams, (row) => row.memberCount),
      monthUsedTokens: sumNumber(teams, (row) => row.monthTotalTokens),
    },
    today: {
      requests: 0,
      tokens: sumNumber(teams, (row) => row.todayTotalTokens),
      errors: 0,
    },
    topTeamsToday: topTeams,
    topMembersToday: topMembers,
    byProviderToday: [],
    recentErrors: [],
  };
}

async function load() {
  loading.value = true;
  try {
    if (auth.isSuperAdmin) {
      const res = await http.get("/api/admin/overview");
      if (res.data.success) data.value = res.data.data;
      return;
    }
    await loadScopedWorkbench();
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

onMounted(load);
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

.rank-list,
.provider-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rank-row,
.provider-row {
  display: grid;
  gap: 8px 12px;
  padding: 12px;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  background: #f8fafc;
}

.rank-row {
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
}

.rank-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: #e2e8f0;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
}

.rank-index.top {
  background: #dbeafe;
  color: #1d4ed8;
}

.rank-main {
  min-width: 0;
}

.rank-name,
.provider-name {
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
}

.rank-sub,
.provider-code {
  margin-top: 2px;
  color: #94a3b8;
  font-size: 12px;
}

.rank-metrics {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}

.rank-metrics strong {
  color: #0f172a;
  font-size: 14px;
}

.rank-metrics span {
  color: #94a3b8;
  font-size: 12px;
}

.rank-bar-track,
.provider-bar-track {
  grid-column: 1 / -1;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: #e2e8f0;
}

.rank-bar,
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
