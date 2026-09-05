<template>
  <div class="charts-page" v-loading="loading">
    <div class="toolbar">
      <el-radio-group v-model="rangePreset" size="small" @change="onPresetChange">
        <el-radio-button value="today">今天</el-radio-button>
        <el-radio-button value="7d">近 7 天</el-radio-button>
        <el-radio-button value="30d">近 30 天</el-radio-button>
      </el-radio-group>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-empty
      v-if="!loading && !hasUsage"
      description="所选范围内暂无调用"
      :image-size="88"
    />

    <template v-else>
      <div class="chart-grid">
        <section class="page-card chart-card">
          <div class="chart-head">
            <h3>Token 趋势</h3>
            <span>{{ formatTokenCompact(summary.totalTokens) }}</span>
          </div>
          <UsageChart :option="tokenTrendOption" height="280px" />
        </section>
        <section class="page-card chart-card">
          <div class="chart-head">
            <h3>调用趋势</h3>
            <span>{{ formatNumber(summary.requestCount) }} 次 · 失败 {{ formatNumber(summary.errorCount) }}</span>
          </div>
          <UsageChart :option="requestTrendOption" height="280px" />
        </section>
      </div>

      <div class="chart-grid">
        <section class="page-card chart-card">
          <div class="chart-head">
            <h3>模型消耗</h3>
          </div>
          <el-empty v-if="!data?.byModel.length" description="暂无模型用量" :image-size="64" />
          <UsageChart v-else :option="modelBarOption" height="300px" />
        </section>
        <section class="page-card chart-card">
          <div class="chart-head">
            <h3>渠道消耗</h3>
          </div>
          <el-empty v-if="!data?.byProvider.length" description="暂无渠道用量" :image-size="64" />
          <UsageChart v-else :option="providerBarOption" height="300px" />
        </section>
      </div>

      <div class="chart-grid">
        <section class="page-card chart-card">
          <div class="chart-head">
            <h3>组织消耗</h3>
            <el-radio-group v-model="rankLevel" size="small">
              <el-radio-button
                v-for="level in rankLevels"
                :key="level.value"
                :value="level.value"
              >
                {{ level.label }}
              </el-radio-button>
            </el-radio-group>
          </div>
          <el-empty v-if="!orgBarRows.length" description="暂无组织用量" :image-size="64" />
          <UsageChart v-else :option="orgBarOption" height="300px" />
        </section>
        <section class="page-card chart-card">
          <div class="chart-head">
            <h3>失败分布</h3>
          </div>
          <el-empty v-if="!data?.errorsByProvider.length" description="暂无失败" :image-size="64" />
          <UsageChart v-else :option="errorBarOption" height="300px" />
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import type { EChartsCoreOption } from "echarts/core";
import { http } from "@/api/http";
import UsageChart from "@/components/UsageChart.vue";
import { formatTokenCompact } from "@/lib/tokens";

type RangePreset = "today" | "7d" | "30d";
type RankLevel = "enterprise" | "department" | "team" | "employee";

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
};

type AnalyticsData = {
  range: { from: string; to: string; timezone: string; granularity: "day" | "hour" };
  summary: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    requestCount: number;
    errorCount: number;
  };
  trend: TrendPoint[];
  byModel: NamedCount[];
  byProvider: NamedCount[];
  errorsByProvider: NamedCount[];
  topEnterprisesToday: Array<{ enterpriseName?: string; totalTokens?: number; requestCount?: number }>;
  topDepartmentsToday: Array<{
    departmentName?: string;
    enterpriseName?: string;
    totalTokens?: number;
    requestCount?: number;
  }>;
  topTeamsToday: Array<{
    teamName?: string;
    departmentName?: string;
    enterpriseName?: string;
    totalTokens?: number;
    requestCount?: number;
  }>;
  topMembersToday: Array<{
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

const loading = ref(false);
const data = ref<AnalyticsData | null>(null);
const rangePreset = ref<RangePreset>("7d");
const from = ref("");
const to = ref("");
const rankLevel = ref<RankLevel>("enterprise");
const rankLevels = [
  { value: "enterprise" as const, label: "企业" },
  { value: "department" as const, label: "部门" },
  { value: "team" as const, label: "团队" },
  { value: "employee" as const, label: "员工" },
];

const summary = computed(() => data.value?.summary ?? {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  requestCount: 0,
  errorCount: 0,
});

const hasUsage = computed(() =>
  Boolean(data.value && (data.value.summary.requestCount > 0 || data.value.summary.totalTokens > 0)),
);

const axisLabels = computed(() =>
  (data.value?.trend ?? []).map((row) => formatBucket(row.day, data.value?.range.granularity)),
);

const tokenTrendOption = computed<EChartsCoreOption>(() => ({
  color: ["#2563eb", "#7c3aed"],
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
    {
      name: "输入 Token",
      type: "bar",
      stack: "tokens",
      data: data.value?.trend.map((row) => row.promptTokens) ?? [],
    },
    {
      name: "输出 Token",
      type: "bar",
      stack: "tokens",
      data: data.value?.trend.map((row) => row.completionTokens) ?? [],
    },
  ],
}));

const requestTrendOption = computed<EChartsCoreOption>(() => ({
  color: ["#0f766e", "#dc2626"],
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
      data: data.value?.trend.map((row) => row.requestCount) ?? [],
    },
    {
      name: "失败",
      type: "line",
      smooth: true,
      showSymbol: false,
      data: data.value?.trend.map((row) => row.errorCount) ?? [],
    },
  ],
}));

const modelBarOption = computed(() => horizontalBar(
  (data.value?.byModel ?? []).map((row) => ({
    name: row.key,
    value: Number(row.totalTokens) || 0,
  })),
  "#2563eb",
  true,
));

const providerBarOption = computed(() => horizontalBar(
  (data.value?.byProvider ?? []).map((row) => ({
    name: providerLabel(row.key),
    value: Number(row.totalTokens) || 0,
  })),
  "#0d9488",
  true,
));

const orgBarRows = computed(() => {
  if (rankLevel.value === "department") {
    return (data.value?.topDepartmentsToday ?? []).map((row) => ({
      name: row.departmentName || "—",
      value: Number(row.totalTokens) || 0,
    }));
  }
  if (rankLevel.value === "team") {
    return (data.value?.topTeamsToday ?? []).map((row) => ({
      name: row.teamName || "—",
      value: Number(row.totalTokens) || 0,
    }));
  }
  if (rankLevel.value === "employee") {
    return (data.value?.topMembersToday ?? []).map((row) => ({
      name: row.employeeName || "—",
      value: Number(row.totalTokens) || 0,
    }));
  }
  return (data.value?.topEnterprisesToday ?? []).map((row) => ({
    name: row.enterpriseName || "—",
    value: Number(row.totalTokens) || 0,
  }));
});

const orgBarOption = computed(() => horizontalBar(orgBarRows.value, "#7c3aed", true));

const errorBarOption = computed(() => horizontalBar(
  (data.value?.errorsByProvider ?? []).map((row) => ({
    name: providerLabel(row.key),
    value: Number(row.requestCount) || 0,
  })),
  "#dc2626",
  false,
));

function horizontalBar(
  rows: Array<{ name: string; value: number }>,
  color: string,
  compactTokens: boolean,
): EChartsCoreOption {
  const dataRows = [...rows].reverse();
  return {
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "shadow" },
      valueFormatter: (value: number | string) =>
        compactTokens ? formatTokenCompact(Number(value)) : formatNumber(value),
    },
    grid: { left: 8, right: 24, bottom: 8, top: 8, containLabel: true },
    xAxis: {
      type: "value",
      axisLabel: {
        formatter: (value: number) => (compactTokens ? formatTokenCompact(value) : formatNumber(value)),
      },
    },
    yAxis: {
      type: "category",
      data: dataRows.map((row) => row.name),
      axisLabel: { width: 120, overflow: "truncate" },
    },
    series: [{ type: "bar", data: dataRows.map((row) => row.value), itemStyle: { color } }],
  };
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

function formatBucket(value: string, granularity?: "day" | "hour") {
  if (granularity === "hour") return value.slice(-5);
  return value.slice(5);
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

function dateOnlyInTimeZone(timeZone = "Asia/Shanghai"): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const valueOf = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
}

function shiftDateOnly(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function setPresetDates(preset: RangePreset) {
  const end = dateOnlyInTimeZone(data.value?.range.timezone ?? "Asia/Shanghai");
  from.value = preset === "today" ? end : shiftDateOnly(end, preset === "7d" ? -6 : -29);
  to.value = end;
}

function onPresetChange() {
  setPresetDates(rangePreset.value);
  void load();
}

async function load() {
  if (!from.value || !to.value) setPresetDates(rangePreset.value);
  loading.value = true;
  try {
    const res = await http.get("/api/admin/overview/analytics", {
      params: { from: from.value, to: to.value },
    });
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
@media (max-width: 1100px) {
  .chart-grid {
    grid-template-columns: 1fr;
  }
}
</style>
