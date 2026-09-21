<template>
  <div class="charts-page" v-loading="loading">
    <div class="toolbar">
      <el-button link type="primary" @click="router.push('/admin/usage')">用量分析</el-button>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card accent">
        <span class="kpi-label">今日 Tokens</span>
        <strong class="kpi-value">{{ formatTokenCompact(today.tokens) }}</strong>
        <span class="kpi-foot">{{ formatChangeFoot(today.tokensChange) }}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">今日请求</span>
        <strong class="kpi-value">{{ formatNumber(today.requests) }}</strong>
        <span class="kpi-foot">{{ formatChangeFoot(today.requestsChange) }}</span>
      </div>
      <div class="kpi-card" :class="{ danger: today.errors > 0 }">
        <span class="kpi-label">失败</span>
        <strong class="kpi-value">{{ formatNumber(today.errors) }}</strong>
        <span class="kpi-foot">
          {{ today.requests > 0 ? formatPercent(today.errors / today.requests) : "—" }}
          失败率
        </span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">活跃员工</span>
        <strong class="kpi-value">{{ formatNumber(today.activeEmployees) }}</strong>
        <span class="kpi-foot">今日有调用的人</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">缓存命中</span>
        <strong class="kpi-value">{{ formatPercent(today.cacheHitRate) }}</strong>
        <span class="kpi-foot">输入里命中的比例</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">次均 Token</span>
        <strong class="kpi-value">{{ today.avgTokens == null ? "—" : formatTokenCompact(today.avgTokens) }}</strong>
        <span class="kpi-foot">Token / 次</span>
      </div>
    </div>

    <section class="page-card mix-card">
      <div class="mix-row">
        <div class="mix-block">
          <div class="mix-legend">
            <span><i class="dot prompt" />未缓存输入 {{ formatTokenCompact(composition.uncachedPrompt) }}</span>
            <span><i class="dot cache" />缓存命中 {{ formatTokenCompact(composition.cacheRead) }}</span>
            <span><i class="dot completion" />输出 {{ formatTokenCompact(composition.completion) }}</span>
          </div>
          <div class="mix-bar" aria-label="Token 构成">
            <span class="seg prompt" :style="{ width: mixWidth(composition.uncachedPrompt, compositionTotal) }" />
            <span class="seg cache" :style="{ width: mixWidth(composition.cacheRead, compositionTotal) }" />
            <span class="seg completion" :style="{ width: mixWidth(composition.completion, compositionTotal) }" />
          </div>
        </div>
        <div class="mix-block">
          <div class="mix-legend">
            <span v-for="row in productTypeRows" :key="row.key">
              {{ row.label }} {{ formatPercent(row.share) }}
            </span>
            <span v-if="peakLabel" class="peak">{{ peakLabel }}</span>
          </div>
          <div class="mix-bar" aria-label="产品类型">
            <span
              v-for="row in productTypeRows"
              :key="row.key"
              class="seg"
              :class="row.key"
              :style="{ width: mixWidth(row.totalTokens, productTypeTotal) }"
            />
          </div>
        </div>
      </div>
    </section>

    <div class="chart-grid">
      <section class="page-card chart-card">
        <div class="chart-head">
          <h3>Token 趋势</h3>
          <span>今天 · 小时</span>
        </div>
        <UsageChart :option="tokenTrendOption" height="280px" />
      </section>
      <section class="page-card chart-card">
        <div class="chart-head">
          <h3>调用趋势</h3>
          <span>{{ formatNumber(today.requests) }} 次</span>
        </div>
        <UsageChart :option="requestTrendOption" height="280px" />
      </section>
    </div>

    <div class="chart-grid">
      <section class="page-card chart-card">
        <div class="chart-head">
          <h3>组织消耗</h3>
          <el-radio-group v-model="rankLevel">
            <el-radio-button
              v-for="level in rankLevels"
              :key="level.value"
              :value="level.value"
            >
              {{ level.label }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <el-empty v-if="!orgRows.length" description="今日暂无组织用量" :image-size="64" />
        <div v-else class="rank-list">
          <button
            v-for="row in orgRows"
            :key="row.key"
            type="button"
            class="rank-row"
            @click="openLogs"
          >
            <span class="rank-label">
              <span class="rank-title">{{ row.name }}</span>
              <span v-if="row.sub" class="rank-sub">{{ row.sub }}</span>
            </span>
            <span class="rank-meta">{{ formatNumber(row.requestCount) }} 次 · {{ formatPercent(row.share) }}</span>
            <span class="rank-value">{{ formatTokenCompact(row.totalTokens) }}</span>
          </button>
        </div>
      </section>
      <section class="page-card chart-card">
        <div class="chart-head">
          <h3>模型消耗</h3>
        </div>
        <el-empty v-if="!modelRows.length" description="今日暂无模型用量" :image-size="64" />
        <div v-else class="rank-list">
          <div v-for="row in modelRows" :key="row.key" class="rank-row static">
            <span class="rank-title">{{ row.name }}</span>
            <span class="rank-meta">{{ formatNumber(row.requestCount) }} 次 · {{ formatPercent(row.share) }}</span>
            <span class="rank-value">{{ formatTokenCompact(row.totalTokens) }}</span>
          </div>
        </div>
      </section>
    </div>

    <div class="chart-grid">
      <section class="page-card chart-card">
        <div class="chart-head">
          <h3>渠道消耗</h3>
        </div>
        <el-empty v-if="!channelRows.length" description="今日暂无渠道用量" :image-size="64" />
        <div v-else class="rank-list">
          <button
            v-for="row in channelRows"
            :key="row.key"
            type="button"
            class="rank-row"
            @click="openLogs"
          >
            <span class="rank-title">{{ row.name }}</span>
            <span class="rank-meta">
              {{ formatNumber(row.requestCount) }} 次
              <template v-if="row.errors > 0"> · 失败 {{ formatNumber(row.errors) }}</template>
              · {{ formatPercent(row.share) }}
            </span>
            <span class="rank-value">{{ formatTokenCompact(row.totalTokens) }}</span>
          </button>
        </div>
      </section>
      <section class="page-card chart-card">
        <div class="chart-head">
          <h3>今天的问题</h3>
          <el-button v-if="today.errors > 0" link type="primary" @click="openErrorLogs">
            报错日志
          </el-button>
        </div>
        <el-empty v-if="!hasIssues" description="今日暂无失败" :image-size="64" />
        <div v-else class="issue-stack">
          <div v-if="errorStatusRows.length" class="mix-block">
            <div class="mix-legend">
              <span v-for="row in errorStatusRows" :key="row.key">
                {{ row.label }} {{ formatNumber(row.requestCount) }}
              </span>
            </div>
            <div class="mix-bar" aria-label="失败类型">
              <span
                v-for="row in errorStatusRows"
                :key="row.key"
                class="seg"
                :class="row.key"
                :style="{ width: mixWidth(row.requestCount, errorStatusTotal) }"
              />
            </div>
          </div>
          <button
            v-for="row in recentErrors"
            :key="row.requestId || row.createdAt"
            type="button"
            class="issue-row"
            @click="openErrorLogs"
          >
            <span class="issue-title">{{ row.employeeName || "—" }} · {{ row.clientModel || "—" }}</span>
            <span class="issue-sub">
              {{ [row.enterpriseName, row.departmentName].filter(Boolean).join(" · ") || "—" }}
              · {{ errorStatusLabel(row.status) }}
              · {{ formatClock(row.createdAt) }}
            </span>
          </button>
          <button
            v-if="unavailableChannels > 0"
            type="button"
            class="issue-row warn"
            @click="openChannels"
          >
            <span class="issue-title">{{ unavailableChannels }} 条启用渠道没有可调度 Key</span>
            <span class="issue-sub">去上游处理</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import type { EChartsCoreOption } from "echarts/core";
import { http } from "@/api/http";
import UsageChart from "@/components/UsageChart.vue";
import { formatTokenCompact } from "@/lib/tokens";
import { formatChangeFoot, formatPercent } from "@/lib/workbench-today";

type RankLevel = "enterprise" | "department" | "employee";

type TrendPoint = {
  day: string;
  promptTokens: number;
  cacheReadTokens?: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  errorCount: number;
};

type NamedCount = {
  key: string;
  totalTokens?: number;
  requestCount?: number;
};

type WorkbenchData = {
  range?: { timezone?: string; granularity?: "day" | "hour" };
  today?: {
    requests?: number;
    tokens?: number;
    errors?: number;
    promptTokens?: number;
    cacheReadTokens?: number;
    completionTokens?: number;
    cacheHitRate?: number | null;
    avgTokens?: number | null;
    activeEmployees?: number;
    tokensChange?: number | null;
    requestsChange?: number | null;
  };
  composition?: {
    uncachedPrompt?: number;
    cacheRead?: number;
    completion?: number;
  };
  peakHour?: { hour?: string; totalTokens?: number } | null;
  productTypes?: NamedCount[];
  errorsByStatus?: Array<{ key?: string; requestCount?: number }>;
  trend?: TrendPoint[];
  byModel?: NamedCount[];
  topEnterprisesToday?: Array<{
    enterpriseName?: string;
    totalTokens?: number;
    requestCount?: number;
  }>;
  topDepartmentsToday?: Array<{
    departmentName?: string;
    enterpriseName?: string;
    totalTokens?: number;
    requestCount?: number;
  }>;
  topMembersToday?: Array<{
    employeeName?: string;
    departmentName?: string;
    enterpriseName?: string;
    totalTokens?: number;
    requestCount?: number;
  }>;
  byProviderToday?: Array<{
    providerCode?: string | null;
    requests?: number;
    tokens?: number;
    errors?: number;
  }>;
  recentErrors?: Array<{
    requestId?: string;
    enterpriseName?: string;
    departmentName?: string;
    employeeName?: string;
    clientModel?: string;
    status?: string;
    createdAt?: string;
  }>;
  channels?: { unavailable?: number };
};

const PROVIDER_META: Record<string, string> = {
  glm: "智谱/GLM",
  kimi: "月之暗面/Kimi",
  deepseek: "深度求索/DeepSeek",
  minimax: "MiniMax",
};

const PRODUCT_TYPE_LABEL: Record<string, string> = {
  api: "按量 API",
  coding_plan: "编程套餐",
  unknown: "未知",
};

const ERROR_STATUS_LABEL: Record<string, string> = {
  upstream_error: "上游失败",
  client_error: "客户端失败",
  cancelled: "已取消",
};

const router = useRouter();
const loading = ref(false);
const data = ref<WorkbenchData | null>(null);
const rankLevel = ref<RankLevel>("enterprise");
const rankLevels = [
  { value: "enterprise" as const, label: "企业" },
  { value: "department" as const, label: "部门" },
  { value: "employee" as const, label: "员工" },
];

const today = computed(() => ({
  requests: Number(data.value?.today?.requests) || 0,
  tokens: Number(data.value?.today?.tokens) || 0,
  errors: Number(data.value?.today?.errors) || 0,
  cacheHitRate: data.value?.today?.cacheHitRate ?? null,
  avgTokens: data.value?.today?.avgTokens ?? null,
  activeEmployees: Number(data.value?.today?.activeEmployees) || 0,
  tokensChange: data.value?.today?.tokensChange ?? null,
  requestsChange: data.value?.today?.requestsChange ?? null,
}));

const composition = computed(() => ({
  uncachedPrompt: Number(data.value?.composition?.uncachedPrompt) || 0,
  cacheRead: Number(data.value?.composition?.cacheRead) || 0,
  completion: Number(data.value?.composition?.completion) || 0,
}));

const compositionTotal = computed(() =>
  composition.value.uncachedPrompt + composition.value.cacheRead + composition.value.completion,
);

const productTypeRows = computed(() => {
  const rows = (data.value?.productTypes ?? []).map((row) => ({
    key: row.key || "unknown",
    label: PRODUCT_TYPE_LABEL[row.key || ""] ?? row.key ?? "未知",
    totalTokens: Number(row.totalTokens) || 0,
    share: shareOf(Number(row.totalTokens) || 0, productTypeTotal.value),
  }));
  return rows.filter((row) => row.totalTokens > 0);
});

const productTypeTotal = computed(() =>
  (data.value?.productTypes ?? []).reduce((sum, row) => sum + (Number(row.totalTokens) || 0), 0),
);

const peakLabel = computed(() => {
  const hour = data.value?.peakHour?.hour;
  if (!hour) return "";
  const start = Number(hour.slice(0, 2));
  if (!Number.isFinite(start)) return `高峰 ${hour}`;
  const end = start === 23 ? "24:00" : `${String(start + 1).padStart(2, "0")}:00`;
  return `高峰 ${hour}–${end}`;
});

const axisLabels = computed(() =>
  (data.value?.trend ?? []).map((row) => formatBucket(row.day)),
);

const tokenTrendOption = computed<EChartsCoreOption>(() => {
  const splits = (data.value?.trend ?? []).map((row) => {
    const prompt = Number(row.promptTokens) || 0;
    const cache = Math.min(prompt, Number(row.cacheReadTokens) || 0);
    return {
      uncachedPrompt: prompt - cache,
      cacheRead: cache,
      completion: Number(row.completionTokens) || 0,
    };
  });
  return {
    color: ["#2563eb", "#0d9488", "#7c3aed"],
    tooltip: {
      trigger: "axis",
      confine: true,
      formatter: tokenTooltip,
    },
    legend: { top: 0 },
    grid: { left: 12, right: 16, bottom: 8, top: 36, containLabel: true },
    xAxis: { type: "category", data: axisLabels.value, axisLabel: { hideOverlap: true } },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (value: number) => formatTokenCompact(value) },
    },
    series: [
      { name: "未缓存输入", type: "bar", stack: "tokens", data: splits.map((row) => row.uncachedPrompt) },
      { name: "缓存命中", type: "bar", stack: "tokens", data: splits.map((row) => row.cacheRead) },
      { name: "输出 Token", type: "bar", stack: "tokens", data: splits.map((row) => row.completion) },
    ],
  };
});

const requestTrendOption = computed<EChartsCoreOption>(() => {
  const trend = data.value?.trend ?? [];
  const hasErrors = trend.some((row) => (Number(row.errorCount) || 0) > 0);
  return {
    color: hasErrors ? ["#0f766e", "#dc2626"] : ["#0f766e"],
    tooltip: { trigger: "axis", confine: true },
    legend: { top: 0 },
    grid: { left: 12, right: 16, bottom: 8, top: 36, containLabel: true },
    xAxis: { type: "category", data: axisLabels.value, axisLabel: { hideOverlap: true } },
    yAxis: { type: "value", minInterval: 1 },
    series: [
      {
        name: "请求",
        type: "line",
        smooth: true,
        showSymbol: false,
        data: trend.map((row) => row.requestCount),
      },
      ...(hasErrors
        ? [{
          name: "失败",
          type: "line" as const,
          smooth: true,
          showSymbol: false,
          data: trend.map((row) => row.errorCount),
        }]
        : []),
    ],
  };
});

const orgRows = computed(() => {
  if (rankLevel.value === "department") {
    return (data.value?.topDepartmentsToday ?? []).map((row, index) => ({
      key: `dept-${index}`,
      name: [row.enterpriseName, row.departmentName].filter(Boolean).join(" · ") || "—",
      sub: "",
      totalTokens: Number(row.totalTokens) || 0,
      requestCount: Number(row.requestCount) || 0,
      share: shareOf(Number(row.totalTokens) || 0, today.value.tokens),
    }));
  }
  if (rankLevel.value === "employee") {
    return (data.value?.topMembersToday ?? []).map((row, index) => ({
      key: `emp-${index}`,
      name: row.employeeName || "—",
      sub: [row.enterpriseName, row.departmentName].filter(Boolean).join(" · "),
      totalTokens: Number(row.totalTokens) || 0,
      requestCount: Number(row.requestCount) || 0,
      share: shareOf(Number(row.totalTokens) || 0, today.value.tokens),
    }));
  }
  return (data.value?.topEnterprisesToday ?? []).map((row, index) => ({
    key: `ent-${index}`,
    name: row.enterpriseName || "—",
    sub: "",
    totalTokens: Number(row.totalTokens) || 0,
    requestCount: Number(row.requestCount) || 0,
    share: shareOf(Number(row.totalTokens) || 0, today.value.tokens),
  }));
});

const modelRows = computed(() => {
  const source = data.value?.byModel ?? [];
  const total = source.reduce((sum, row) => sum + (Number(row.totalTokens) || 0), 0);
  return source.map((row) => ({
    key: row.key || "unknown",
    name: row.key === "other" ? "其他" : row.key || "—",
    totalTokens: Number(row.totalTokens) || 0,
    requestCount: Number(row.requestCount) || 0,
    share: shareOf(Number(row.totalTokens) || 0, total),
  })).filter((row) => row.totalTokens > 0);
});

const channelRows = computed(() => {
  const source = data.value?.byProviderToday ?? [];
  const total = source.reduce((sum, row) => sum + (Number(row.tokens) || 0), 0);
  return source.map((row) => ({
    key: String(row.providerCode ?? "unknown"),
    name: providerLabel(String(row.providerCode ?? "")),
    totalTokens: Number(row.tokens) || 0,
    requestCount: Number(row.requests) || 0,
    errors: Number(row.errors) || 0,
    share: shareOf(Number(row.tokens) || 0, total),
  })).filter((row) => row.totalTokens > 0 || row.requestCount > 0);
});

const errorStatusRows = computed(() =>
  (data.value?.errorsByStatus ?? []).map((row) => ({
    key: row.key || "unknown",
    label: errorStatusLabel(row.key),
    requestCount: Number(row.requestCount) || 0,
  })).filter((row) => row.requestCount > 0),
);

const errorStatusTotal = computed(() =>
  errorStatusRows.value.reduce((sum, row) => sum + row.requestCount, 0),
);

const recentErrors = computed(() => (data.value?.recentErrors ?? []).slice(0, 5));
const unavailableChannels = computed(() => Number(data.value?.channels?.unavailable) || 0);
const hasIssues = computed(() =>
  Boolean(errorStatusRows.value.length || recentErrors.value.length || unavailableChannels.value > 0),
);

function shareOf(part: number, total: number): number | null {
  if (!(total > 0)) return null;
  return part / total;
}

function mixWidth(part: number, total: number): string {
  if (!(total > 0) || !(part > 0)) return "0%";
  return `${Math.max(2, Math.round((part / total) * 100))}%`;
}

function tokenTooltip(params: unknown) {
  const items = Array.isArray(params) ? params : [];
  if (!items.length) return "";
  const first = items[0] as { axisValue?: string };
  const lines = items.map((item) => {
    const row = item as { marker?: string; seriesName?: string; value?: number };
    return `${row.marker ?? ""}${row.seriesName ?? ""} ${formatTokenCompact(Number(row.value))}`;
  });
  return [first.axisValue ?? "", ...lines].join("<br/>");
}

function formatBucket(value: string) {
  return value.slice(-5);
}

function formatNumber(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("zh-CN").format(n);
}

function formatClock(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: data.value?.range?.timezone ?? "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function providerLabel(code: string): string {
  if (!code || code === "unknown") return "未知渠道";
  return PROVIDER_META[code] ?? code;
}

function errorStatusLabel(code?: string): string {
  if (!code) return "失败";
  return ERROR_STATUS_LABEL[code] ?? code;
}

function openLogs() {
  void router.push("/admin/logs");
}

function openErrorLogs() {
  void router.push("/admin/error-logs");
}

function openChannels() {
  void router.push("/admin/temp-channels");
}

async function load() {
  loading.value = true;
  try {
    const res = await http.get("/api/admin/overview");
    if (res.data.success) data.value = res.data.data;
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 403) return;
    const message = (error as { response?: { data?: { message?: unknown } } })
      ?.response?.data?.message;
    ElMessage.error(typeof message === "string" ? message : "加载用量失败");
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.charts-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
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
.kpi-card.danger {
  border-color: #fecaca;
  background: linear-gradient(180deg, #fef2f2 0%, #fff7f7 100%);
}
.kpi-label {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
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
.mix-card {
  padding: 16px 20px;
}
.mix-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 24px;
}
.mix-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.mix-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  color: #64748b;
  font-size: 12px;
}
.mix-legend .peak {
  margin-left: auto;
  color: #0f172a;
  font-weight: 600;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 50%;
}
.dot.prompt { background: #2563eb; }
.dot.cache { background: #0d9488; }
.dot.completion { background: #7c3aed; }
.mix-bar {
  display: flex;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #e2e8f0;
}
.seg { height: 100%; }
.seg.prompt { background: #2563eb; }
.seg.cache { background: #0d9488; }
.seg.completion { background: #7c3aed; }
.seg.api { background: #2563eb; }
.seg.coding_plan { background: #7c3aed; }
.seg.unknown { background: #94a3b8; }
.seg.upstream_error { background: #dc2626; }
.seg.client_error { background: #ea580c; }
.seg.cancelled { background: #64748b; }
.chart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.chart-card {
  min-width: 0;
}
.chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.chart-head h3 {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
  font-weight: 650;
}
.chart-head span {
  color: #94a3b8;
  font-size: 12px;
}
.rank-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rank-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto;
  gap: 12px;
  align-items: baseline;
  width: 100%;
  min-height: 36px;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}
button.rank-row {
  cursor: pointer;
}
.rank-row:hover,
.rank-row.static:hover {
  background: #f1f5f9;
}
.rank-label {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
}
.rank-title {
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-sub,
.rank-meta {
  overflow: hidden;
  color: #94a3b8;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-value {
  color: #0f172a;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}
.issue-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.issue-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #eef2f7;
  border-radius: 8px;
  background: #f8fafc;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.issue-row.warn {
  border-color: #fed7aa;
  background: #fff7ed;
}
.issue-title {
  color: #0f172a;
  font-size: 13px;
  font-weight: 600;
}
.issue-sub {
  color: #94a3b8;
  font-size: 12px;
}
@media (max-width: 1100px) {
  .kpi-grid,
  .chart-grid,
  .mix-row {
    grid-template-columns: 1fr;
  }
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
