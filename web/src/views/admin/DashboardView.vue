<template>
  <div class="dashboard-page">
    <section class="page-card hero-card">
      <div class="page-head">
        <div>
          <h2 class="page-title">管理概览</h2>
          <p class="page-subtitle">今日运行概况 · 渠道与员工状态一目了然</p>
        </div>
        <div class="head-actions">
          <el-button :loading="loading" @click="load">刷新</el-button>
          <el-button v-if="auth.isAdmin" type="primary" @click="router.push('/admin/credentials')">
            管理渠道
          </el-button>
        </div>
      </div>

      <div v-loading="loading" class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-label">今日请求</span>
          <strong class="kpi-value">{{ formatNumber(data?.today?.requests) }}</strong>
          <span class="kpi-foot">
            失败
            <b :class="{ danger: (data?.today?.errors ?? 0) > 0 }">
              {{ formatNumber(data?.today?.errors) }}
            </b>
          </span>
        </div>
        <div class="kpi-card accent">
          <span class="kpi-label">今日 Tokens</span>
          <strong class="kpi-value">{{ formatCompact(data?.today?.tokens) }}</strong>
          <span class="kpi-foot">全员合计消耗</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">员工</span>
          <strong class="kpi-value">{{ formatNumber(data?.employees?.active) }}</strong>
          <span class="kpi-foot">启用 / 共 {{ formatNumber(data?.employees?.total) }}</span>
        </div>
        <div class="kpi-card success">
          <span class="kpi-label">启用渠道</span>
          <strong class="kpi-value">{{ formatNumber(data?.credentials?.active) }}</strong>
          <span class="kpi-foot">共 {{ formatNumber(data?.credentials?.total) }} 个渠道</span>
        </div>
        <div class="kpi-card" :class="{ danger: (data?.credentials?.autoDisabled ?? 0) > 0 }">
          <span class="kpi-label">异常渠道</span>
          <strong class="kpi-value">{{ formatNumber(data?.credentials?.autoDisabled) }}</strong>
          <span class="kpi-foot">自动停用，需关注</span>
        </div>
        <div class="kpi-card muted">
          <span class="kpi-label">接入平台</span>
          <strong class="kpi-value">{{ formatNumber(data?.providers) }}</strong>
          <span class="kpi-foot">启用路由 {{ formatNumber(data?.modelRoutesEnabled) }}</span>
        </div>
      </div>

      <div class="quick-links">
        <button type="button" class="quick-link" @click="router.push('/admin/credentials')">
          <span class="quick-dot blue" />
          <span>
            <strong>上游渠道</strong>
            <small>{{ auth.isAdmin ? "凭证池 · 连通测试 · 启停" : "渠道状态 · 只读查看" }}</small>
          </span>
        </button>
        <button
          v-if="auth.isAdmin"
          type="button"
          class="quick-link"
          @click="router.push('/admin/users')"
        >
          <span class="quick-dot violet" />
          <span>
            <strong>员工管理</strong>
            <small>建号 · 启停 · 重置密码</small>
          </span>
        </button>
        <button type="button" class="quick-link" @click="router.push('/admin/logs')">
          <span class="quick-dot teal" />
          <span>
            <strong>调用日志</strong>
            <small>全文审计 · 用量追踪</small>
          </span>
        </button>
        <button
          v-if="auth.isAdmin"
          type="button"
          class="quick-link"
          @click="router.push('/admin/quota')"
        >
          <span class="quick-dot amber" />
          <span>
            <strong>配额策略</strong>
            <small>软上限 · RPM / 并发</small>
          </span>
        </button>
        <button
          v-if="!auth.isAdmin"
          type="button"
          class="quick-link"
          @click="router.push('/admin/profile')"
        >
          <span class="quick-dot amber" />
          <span>
            <strong>个人中心</strong>
            <small>账号信息 · 改密</small>
          </span>
        </button>
      </div>
    </section>

    <div class="panels-grid">
      <section class="page-card panel-card">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">今日消耗 Top 员工</h3>
            <p class="panel-desc">按 Tokens 排序</p>
          </div>
          <el-button link type="primary" @click="router.push('/admin/logs')">查看日志</el-button>
        </div>
        <el-empty
          v-if="!loading && !(data?.topUsersToday?.length)"
          description="今日暂无用量"
          :image-size="72"
        />
        <div v-else class="rank-list">
          <div
            v-for="(row, index) in data?.topUsersToday ?? []"
            :key="String(row.employeeId ?? index)"
            class="rank-row"
          >
            <span class="rank-index" :class="{ top: index < 3 }">{{ index + 1 }}</span>
            <div class="rank-main">
              <div class="rank-name">{{ row.name || "—" }}</div>
              <div class="rank-sub">{{ row.phone || "—" }}</div>
            </div>
            <div class="rank-metrics">
              <strong>{{ formatCompact(row.totalTokens) }}</strong>
              <span>{{ formatNumber(row.requestCount) }} 次</span>
            </div>
            <div class="rank-bar-track">
              <div class="rank-bar" :style="{ width: topUserBarWidth(row) }" />
            </div>
          </div>
        </div>
      </section>

      <section class="page-card panel-card">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">今日按接入平台</h3>
            <p class="panel-desc">请求量与 Tokens 分布</p>
          </div>
          <el-button link type="primary" @click="router.push('/admin/credentials')">渠道</el-button>
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
                <b>{{ formatCompact(row.tokens) }}</b>
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
        <div>
          <h3 class="panel-title">最近失败请求</h3>
          <p class="panel-desc">便于快速发现上游或客户端问题</p>
        </div>
        <el-button link type="primary" @click="router.push('/admin/logs')">全部日志</el-button>
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
        <el-table-column prop="employeeName" label="员工" min-width="90" />
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
        <el-table-column prop="errorCode" label="错误码" min-width="110" show-overflow-tooltip />
        <el-table-column prop="errorMessage" label="错误信息" min-width="220" show-overflow-tooltip />
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
import { useAuthStore } from "@/stores/auth";

type OverviewData = {
  employees?: { total: number; active: number };
  credentials?: { total: number; active: number; autoDisabled: number };
  providers?: number;
  modelRoutesEnabled?: number;
  today?: { requests: number; tokens: number; errors: number };
  topUsersToday?: Array<{
    employeeId?: number;
    name?: string;
    phone?: string;
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
    employeeName?: string;
    clientModel?: string;
    providerCode?: string | null;
    status?: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    createdAt?: string;
  }>;
};

const PROVIDER_META: Record<string, { label: string; color: string }> = {
  glm: { label: "智谱 GLM", color: "#2563eb" },
  kimi: { label: "Kimi / Moonshot", color: "#7c3aed" },
  deepseek: { label: "DeepSeek", color: "#0891b2" },
  minimax: { label: "MiniMax", color: "#ea580c" },
};

const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
const data = ref<OverviewData | null>(null);

const maxTopTokens = computed(() => {
  const list = data.value?.topUsersToday ?? [];
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

function formatCompact(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) < 1000) return formatNumber(n);
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
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

async function load() {
  loading.value = true;
  try {
    const res = await http.get("/api/admin/overview");
    if (res.data.success) data.value = res.data.data;
  } catch (error) {
    const message = (error as { response?: { data?: { message?: unknown } } })
      ?.response?.data?.message;
    ElMessage.error(typeof message === "string" ? message : "加载概览失败");
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.page-title {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  color: #0f172a;
}

.page-subtitle {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 13px;
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

.panel-card {
  min-width: 0;
}

.panel-head {
  display: flex;
  align-items: flex-start;
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

.panel-desc {
  margin: 4px 0 0;
  color: #94a3b8;
  font-size: 12px;
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
