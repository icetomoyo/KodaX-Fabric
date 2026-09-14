<template>
  <div class="charts-page" v-loading="loading">
    <div class="toolbar">
      <el-radio-group v-model="rangePreset" @change="onPresetChange">
        <el-radio-button value="7d">近 7 天</el-radio-button>
        <el-radio-button value="30d">近 30 天</el-radio-button>
      </el-radio-group>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card accent">
        <span class="kpi-label">Tokens</span>
        <strong class="kpi-value">{{ formatTokenCompact(summary.totalTokens) }}</strong>
        <span class="kpi-foot">{{ formatChangeFoot(summary.tokensChange, comparedTo) }}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">请求</span>
        <strong class="kpi-value">{{ formatNumber(summary.requestCount) }}</strong>
        <span class="kpi-foot">{{ formatChangeFoot(summary.requestsChange, comparedTo) }}</span>
      </div>
      <div class="kpi-card" :class="{ danger: summary.errorCount > 0 }">
        <span class="kpi-label">失败</span>
        <strong class="kpi-value">{{ formatNumber(summary.errorCount) }}</strong>
        <span class="kpi-foot">
          {{ summary.requestCount > 0 ? formatPercent(summary.errorCount / summary.requestCount) : "—" }}
          失败率
        </span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">活跃员工</span>
        <strong class="kpi-value">{{ formatNumber(summary.activeEmployees) }}</strong>
        <span class="kpi-foot">区间内有调用的人</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">缓存命中</span>
        <strong class="kpi-value">{{ formatPercent(summary.cacheHitRate) }}</strong>
        <span class="kpi-foot">输入里命中的比例</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">次均 Token</span>
        <strong class="kpi-value">{{ summary.avgTokens == null ? "—" : formatTokenCompact(summary.avgTokens) }}</strong>
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
            <span class="peak">{{ rangeLabel }}</span>
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
          <span>{{ rangeLabel }} · 日</span>
        </div>
        <UsageChart :option="tokenTrendOption" height="280px" />
      </section>
      <section class="page-card chart-card">
        <div class="chart-head">
          <h3>调用趋势</h3>
          <span>{{ formatNumber(summary.requestCount) }} 次</span>
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
        <el-empty v-if="!orgRows.length" description="区间内暂无组织用量" :image-size="64" />
        <div v-else class="rank-list">
          <div v-for="row in orgRows" :key="row.key" class="rank-row static">
            <span class="rank-label">
              <span class="rank-title">{{ row.name }}</span>
              <span v-if="row.sub" class="rank-sub">{{ row.sub }}</span>
            </span>
            <span class="rank-meta">{{ formatNumber(row.requestCount) }} 次 · {{ formatPercent(row.share) }}</span>
            <span class="rank-value">{{ formatTokenCompact(row.totalTokens) }}</span>
          </div>
        </div>
      </section>
      <section class="page-card chart-card">
        <div class="chart-head">
          <h3>模型消耗</h3>
        </div>
        <el-empty v-if="!modelRows.length" description="区间内暂无模型用量" :image-size="64" />
        <div v-else class="rank-list">
          <div v-for="row in modelRows" :key="row.key" class="rank-row static">
            <span class="rank-title">{{ row.name }}</span>
            <span class="rank-meta">{{ formatNumber(row.requestCount) }} 次 · {{ formatPercent(row.share) }}</span>
            <span class="rank-value">{{ formatTokenCompact(row.totalTokens) }}</span>
          </div>
        </div>
      </section>
    </div>

    <section class="page-card chart-card">
      <div class="chart-head">
        <h3>渠道消耗</h3>
      </div>
      <el-empty v-if="!channelRows.length" description="区间内暂无渠道用量" :image-size="64" />
      <div v-else class="rank-list">
        <div v-for="row in channelRows" :key="row.key" class="rank-row static">
          <span class="rank-title">{{ row.name }}</span>
          <span class="rank-meta">
            {{ formatNumber(row.requestCount) }} 次
            <template v-if="row.errors > 0"> · 失败 {{ formatNumber(row.errors) }}</template>
            · {{ formatPercent(row.share) }}
          </span>
          <span class="rank-value">{{ formatTokenCompact(row.totalTokens) }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import type { EChartsCoreOption } from "echarts/core";
import { http } from "@/api/http";
import UsageChart from "@/components/UsageChart.vue";
import { formatTokenCompact } from "@/lib/tokens";
import { analysisWindow, formatChangeFoot, formatPercent } from "@/lib/workbench-today";

type RangePreset = "7d" | "30d";
type RankLevel = "enterprise" | "department" | "employee";

type TrendPoint = {
  day: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  errorCount: number;
};

type NamedCount = {
  key: string;
  totalTokens?: number;
  requestCount?: number;
  errors?: number;
};

type AnalyticsData = {
  range?: { from?: string; to?: string; timezone?: string; granularity?: "day" | "hour" };
  summary?: {
    totalTokens?: number;
    requestCount?: number;
    errorCount?: number;
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
  productTypes?: NamedCount[];
  trend?: TrendPoint[];
  byModel?: NamedCount[];
  byProvider?: NamedCount[];
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

const loading = ref(false);
const data = ref<AnalyticsData | null>(null);
const rangePreset = ref<RangePreset>("7d");
const rankLevel = ref<RankLevel>("enterprise");
const rankLevels = [
  { value: "enterprise" as const, label: "企业" },
  { value: "department" as const, label: "部门" },
  { value: "employee" as const, label: "员工" },
];

const comparedTo = computed(() => (rangePreset.value === "7d" ? "较前 7 天" : "较前 30 天"));
const rangeLabel = computed(() => {
  const from = data.value?.range?.from;
  const to = data.value?.range?.to;
  return from && to ? `${from} ~ ${to}` : "";
});

const summary = computed(() => ({
  totalTokens: Number(data.value?.summary?.totalTokens) || 0,
  requestCount: Number(data.value?.summary?.requestCount) || 0,
  errorCount: Number(data.value?.summary?.errorCount) || 0,
  cacheHitRate: data.value?.summary?.cacheHitRate ?? null,
  avgTokens: data.value?.summary?.avgTokens ?? null,
  activeEmployees: Number(data.value?.summary?.activeEmployees) || 0,
  tokensChange: data.value?.summary?.tokensChange ?? null,
  requestsChange: data.value?.summary?.requestsChange ?? null,
}));

const composition = computed(() => ({
  uncachedPrompt: Number(data.value?.composition?.uncachedPrompt) || 0,
  cacheRead: Number(data.value?.composition?.cacheRead) || 0,
  completion: Number(data.value?.composition?.completion) || 0,
}));

const compositionTotal = computed(() =>
  composition.value.uncachedPrompt + composition.value.cacheRead + composition.value.completion,
);

const productTypeTotal = computed(() =>
  (data.value?.productTypes ?? []).reduce((sum, row) => sum + (Number(row.totalTokens) || 0), 0),
);

const productTypeRows = computed(() =>
  (data.value?.productTypes ?? []).map((row) => ({
    key: row.key || "unknown",
    label: PRODUCT_TYPE_LABEL[row.key || ""] ?? row.key ?? "未知",
    totalTokens: Number(row.totalTokens) || 0,
    share: shareOf(Number(row.totalTokens) || 0, productTypeTotal.value),
  })).filter((row) => row.totalTokens > 0),
);

const axisLabels = computed(() => (data.value?.trend ?? []).map((row) => formatDay(row.day)));

const tokenTrendOption = computed<EChartsCoreOption>(() => ({
  color: ["#2563eb", "#7c3aed"],
  tooltip: { trigger: "axis", confine: true, formatter: tokenTooltip },
  legend: { top: 0 },
  grid: { left: 12, right: 16, bottom: 8, top: 36, containLabel: true },
  xAxis: { type: "category", data: axisLabels.value, axisLabel: { hideOverlap: true } },
  yAxis: {
    type: "value",
    axisLabel: { formatter: (value: number) => formatTokenCompact(value) },
  },
  series: [
    { name: "输入 Token", type: "bar", stack: "tokens", data: (data.value?.trend ?? []).map((row) => row.promptTokens) },
    { name: "输出 Token", type: "bar", stack: "tokens", data: (data.value?.trend ?? []).map((row) => row.completionTokens) },
  ],
}));

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
      share: shareOf(Number(row.totalTokens) || 0, summary.value.totalTokens),
    }));
  }
  if (rankLevel.value === "employee") {
    return (data.value?.topMembersToday ?? []).map((row, index) => ({
      key: `emp-${index}`,
      name: row.employeeName || "—",
      sub: [row.enterpriseName, row.departmentName].filter(Boolean).join(" · "),
      totalTokens: Number(row.totalTokens) || 0,
      requestCount: Number(row.requestCount) || 0,
      share: shareOf(Number(row.totalTokens) || 0, summary.value.totalTokens),
    }));
  }
  return (data.value?.topEnterprisesToday ?? []).map((row, index) => ({
    key: `ent-${index}`,
    name: row.enterpriseName || "—",
    sub: "",
    totalTokens: Number(row.totalTokens) || 0,
    requestCount: Number(row.requestCount) || 0,
    share: shareOf(Number(row.totalTokens) || 0, summary.value.totalTokens),
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
  const source = data.value?.byProvider ?? [];
  const total = source.reduce((sum, row) => sum + (Number(row.totalTokens) || 0), 0);
  return source.map((row) => ({
    key: row.key || "unknown",
    name: providerLabel(row.key || ""),
    totalTokens: Number(row.totalTokens) || 0,
    requestCount: Number(row.requestCount) || 0,
    errors: Number(row.errors) || 0,
    share: shareOf(Number(row.totalTokens) || 0, total),
  })).filter((row) => row.totalTokens > 0 || row.requestCount > 0);
});

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

function formatDay(value: string) {
  return value.length >= 10 ? value.slice(5, 10) : value;
}

function formatNumber(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("zh-CN").format(n);
}

function providerLabel(code: string): string {
  if (!code || code === "unknown") return "未知渠道";
  return PROVIDER_META[code] ?? code;
}

function onPresetChange() {
  void load();
}

async function load() {
  loading.value = true;
  try {
    const { from, to } = analysisWindow(rangePreset.value);
    const res = await http.get("/api/admin/overview/analytics", { params: { from, to } });
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
  border-radius: 8px;
}
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
