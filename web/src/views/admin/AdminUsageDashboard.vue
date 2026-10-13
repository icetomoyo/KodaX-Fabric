<template>
  <div class="charts-page" v-loading="loading">
    <section class="page-card attention-card" data-testid="attention">
      <div class="chart-head">
        <h3>
          需要处理
          <em v-if="attention.length" class="attention-count">{{ attention.length }}</em>
        </h3>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
      <div v-if="!attention.length" class="attention-clear">
        <strong>一切正常</strong>
        <span>Key 池、渠道、磁盘和授权都没有要跟进的事</span>
      </div>
      <div v-else class="attention-list">
        <button
          v-for="item in attention"
          :key="item.key"
          type="button"
          class="attention-item"
          :class="item.level"
          data-testid="attention-item"
          @click="openAttention(item)"
        >
          <i class="attention-dot" />
          <span class="attention-text">
            <span class="attention-title">{{ item.title }}</span>
            <span class="attention-detail" :title="item.detail">{{ item.detail }}</span>
          </span>
          <span class="attention-go">去处理</span>
        </button>
      </div>
    </section>

    <div class="chart-grid">
      <section class="page-card chart-card" data-testid="key-pool">
        <div class="chart-head">
          <h3>渠道 Key 池</h3>
          <el-button link type="primary" @click="router.push('/admin/keys-board')">KEYS看板</el-button>
        </div>
        <div class="pool-stats">
          <div class="pool-stat">
            <span class="pool-label">可用</span>
            <strong class="pool-value" data-testid="pool-active">{{ keyPool.active }}</strong>
          </div>
          <div class="pool-stat">
            <span class="pool-label">冷却中</span>
            <strong class="pool-value" data-testid="pool-cooling">{{ keyPool.cooling }}</strong>
          </div>
          <div class="pool-stat" :class="{ danger: keyPool.autoDisabled > 0 }">
            <span class="pool-label">自动停用</span>
            <strong class="pool-value" data-testid="pool-auto-disabled">{{ keyPool.autoDisabled }}</strong>
          </div>
          <div class="pool-stat">
            <span class="pool-label">手动停用</span>
            <strong class="pool-value" data-testid="pool-disabled">{{ keyPool.disabled }}</strong>
          </div>
        </div>
        <div v-for="bar in poolBars" :key="bar.key" class="mix-block pool-bar">
          <div class="mix-legend">
            <span>{{ bar.label }}</span>
            <span class="peak">{{ formatPercent(bar.ratio) }}</span>
          </div>
          <div class="mix-bar" :aria-label="bar.label">
            <span class="seg" :class="loadLevel(bar.ratio)" :style="{ width: mixWidth(bar.used, bar.capacity) }" />
          </div>
        </div>
        <div v-if="loadedLines.length" class="rank-list pool-lines">
          <button
            v-for="line in loadedLines"
            :key="line.productLineId"
            type="button"
            class="rank-row"
            @click="openKeysBoard(line.productLineId)"
          >
            <span class="rank-title">{{ line.name }}</span>
            <span class="rank-meta">可调度 {{ line.schedulable }} / {{ line.total }}</span>
            <span class="rank-value" :class="loadLevel(line.peak)">
              <template v-if="line.fiveHour">5 小时 {{ formatPercent(line.fiveHour.ratio) }}</template>
              <template v-if="line.fiveHour && line.weekly"> · </template>
              <template v-if="line.weekly">周 {{ formatPercent(line.weekly.ratio) }}</template>
            </span>
          </button>
        </div>
      </section>

      <section class="page-card chart-card" data-testid="ops-status">
        <div class="chart-head">
          <h3>运行状态</h3>
        </div>
        <div class="rank-list">
          <button
            v-for="row in statusRows"
            :key="row.key"
            type="button"
            class="status-row"
            @click="router.push(row.to)"
          >
            <span class="status-label">{{ row.label }}</span>
            <span class="status-detail" :class="{ danger: row.danger }">{{ row.detail }}</span>
          </button>
        </div>
      </section>
    </div>

    <LogStorageCard id="log-storage" />

    <section class="usage-block" data-testid="today-usage">
      <div class="chart-head">
        <h3>今日用量</h3>
        <div class="head-actions">
          <el-button link type="primary" @click="router.push('/admin/usage?range=today')">今日排行</el-button>
          <el-button link type="primary" @click="router.push('/admin/usage')">用量分析</el-button>
        </div>
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import type { EChartsCoreOption } from "echarts/core";
import { http } from "@/api/http";
import UsageChart from "@/components/UsageChart.vue";
import LogStorageCard from "./LogStorageCard.vue";
import { formatTokenCompact } from "@/lib/tokens";
import { formatChangeFoot, formatPercent } from "@/lib/workbench-today";

type TrendPoint = {
  day: string;
  promptTokens: number;
  cacheReadTokens?: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  errorCount: number;
};

type WindowLoad = {
  used?: number;
  capacity?: number;
  ratio?: number;
  nextResetAt?: string | null;
};

type KeyPoolLine = {
  productLineId: number;
  name?: string;
  total?: number;
  schedulable?: number;
  fiveHour?: WindowLoad | null;
  weekly?: WindowLoad | null;
};

type AttentionItem = {
  key: string;
  level: "danger" | "warn";
  title: string;
  detail: string;
  to: string;
};

type WorkbenchData = {
  range?: { timezone?: string; granularity?: "day" | "hour" };
  today?: {
    requests?: number;
    tokens?: number;
    errors?: number;
    cacheHitRate?: number | null;
    avgTokens?: number | null;
    activeEmployees?: number;
    tokensChange?: number | null;
    requestsChange?: number | null;
  };
  errorsByStatus?: Array<{ key?: string; requestCount?: number }>;
  trend?: TrendPoint[];
  keyPool?: {
    active?: number;
    cooling?: number;
    autoDisabled?: number;
    disabled?: number;
    fiveHour?: WindowLoad | null;
    weekly?: WindowLoad | null;
    lines?: KeyPoolLine[];
  };
  seats?: { registered?: number; submitted?: number; capacity?: number };
  tidal?: {
    enabled?: boolean;
    windowOpen?: boolean;
    windowStart?: string;
    windowEnd?: string;
    inFlight?: number;
    grants?: { total?: number; expired?: number; expiringSoon?: number };
  };
  sensitive?: { detectToday?: number; interceptToday?: number };
  attention?: AttentionItem[];
};

const ERROR_STATUS_LABEL: Record<string, string> = {
  upstream_error: "上游失败",
  client_error: "客户端失败",
  cancelled: "已取消",
};

const router = useRouter();
const loading = ref(false);
const data = ref<WorkbenchData | null>(null);

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

const attention = computed(() => data.value?.attention ?? []);

const keyPool = computed(() => ({
  active: Number(data.value?.keyPool?.active) || 0,
  cooling: Number(data.value?.keyPool?.cooling) || 0,
  autoDisabled: Number(data.value?.keyPool?.autoDisabled) || 0,
  disabled: Number(data.value?.keyPool?.disabled) || 0,
}));

const poolBars = computed(() => {
  const pool = data.value?.keyPool;
  return [
    { key: "fiveHour", label: "5 小时积分（设了上限的套餐合计）", load: pool?.fiveHour },
    { key: "weekly", label: "周积分（设了上限的套餐合计）", load: pool?.weekly },
  ]
    .filter((bar) => bar.load)
    .map((bar) => ({
      key: bar.key,
      label: bar.label,
      used: Number(bar.load?.used) || 0,
      capacity: Number(bar.load?.capacity) || 0,
      ratio: Number(bar.load?.ratio) || 0,
    }));
});

/** 设了积分上限的渠道，用得最多的排前面。 */
const loadedLines = computed(() =>
  (data.value?.keyPool?.lines ?? [])
    .filter((line) => line.fiveHour || line.weekly)
    .map((line) => ({
      productLineId: line.productLineId,
      name: line.name || "—",
      total: Number(line.total) || 0,
      schedulable: Number(line.schedulable) || 0,
      fiveHour: line.fiveHour ?? null,
      weekly: line.weekly ?? null,
      peak: Math.max(Number(line.fiveHour?.ratio) || 0, Number(line.weekly?.ratio) || 0),
    }))
    .sort((a, b) => b.peak - a.peak)
    .slice(0, 6),
);

const statusRows = computed(() => {
  const seats = data.value?.seats;
  const registered = Number(seats?.registered) || 0;
  const submitted = Number(seats?.submitted) || 0;
  const capacity = Number(seats?.capacity) || 0;
  const tidal = data.value?.tidal;
  const grants = tidal?.grants;
  const expiredGrants = Number(grants?.expired) || 0;
  const intercepts = Number(data.value?.sensitive?.interceptToday) || 0;
  return [
    {
      key: "seats",
      label: "席位",
      detail: [
        capacity > 0 ? `已登记 ${registered} / ${capacity}` : `已登记 ${registered}`,
        `已提交 KEY ${submitted}`,
        registered > submitted ? `待提交 ${registered - submitted}` : "",
      ].filter(Boolean).join(" · "),
      danger: false,
      to: "/admin/temp-channels",
    },
    {
      key: "tidal",
      label: "潮汐调度",
      detail: tidal?.enabled
        ? [
          `${tidal.windowOpen ? "开放中" : "未到开放时段"} ${tidalWindow(tidal.windowStart, tidal.windowEnd)}`,
          `在途 ${Number(tidal.inFlight) || 0}`,
          `授权 ${Number(grants?.total) || 0} 人`,
          expiredGrants > 0 ? `已过期 ${expiredGrants}` : "",
        ].filter(Boolean).join(" · ")
        : "未开启",
      danger: false,
      to: "/admin/tidal",
    },
    {
      key: "sensitive",
      label: "敏感词",
      detail: `今日拦截 ${intercepts} · 检测 ${Number(data.value?.sensitive?.detectToday) || 0}`,
      danger: intercepts > 0,
      to: intercepts > 0 ? "/admin/sensitive-intercept-records" : "/admin/sensitive-detect-records",
    },
    {
      key: "errors",
      label: "今日失败",
      detail: errorStatusRows.value.length
        ? errorStatusRows.value.map((row) => `${row.label} ${formatNumber(row.requestCount)}`).join(" · ")
        : "暂无",
      danger: false,
      to: "/admin/error-logs",
    },
  ];
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
    // 色板长度保持不变：vue-echarts 发现数组变短会按组件替换，而 color 不是组件，ECharts 会直接抛错。
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

const errorStatusRows = computed(() =>
  (data.value?.errorsByStatus ?? []).map((row) => ({
    key: row.key || "unknown",
    label: errorStatusLabel(row.key),
    requestCount: Number(row.requestCount) || 0,
  })).filter((row) => row.requestCount > 0),
);

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

function tidalWindow(start?: string, end?: string): string {
  if (!start || !end) return "";
  return start === end ? "全天" : `${start}–${end}`;
}

/** 与待办的提醒线一致：80% 提醒，95% 紧急。 */
function loadLevel(ratio: number): string {
  if (ratio >= 0.95) return "danger";
  if (ratio >= 0.8) return "warn";
  return "calm";
}

function errorStatusLabel(code?: string): string {
  if (!code) return "失败";
  return ERROR_STATUS_LABEL[code] ?? code;
}

function openKeysBoard(productLineId: number) {
  void router.push({ path: "/admin/keys-board", query: { channelId: String(productLineId) } });
}

function openAttention(item: AttentionItem) {
  if (item.to.startsWith("#")) {
    document.getElementById(item.to.slice(1))?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  void router.push(item.to);
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
.attention-count {
  display: inline-block;
  min-width: 20px;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: #dc2626;
  color: #ffffff;
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
  line-height: 20px;
  text-align: center;
  vertical-align: 2px;
}
.attention-clear {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  background: #f0fdf4;
}
.attention-clear strong {
  color: #15803d;
  font-size: 15px;
  font-weight: 650;
}
.attention-clear span {
  color: #64748b;
  font-size: 13px;
}
.attention-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.attention-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  background: #fff7ed;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.attention-item.danger {
  border-color: #fecaca;
  background: #fef2f2;
}
.attention-item:hover {
  filter: brightness(0.98);
}
.attention-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ea580c;
}
.attention-item.danger .attention-dot {
  background: #dc2626;
}
.attention-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.attention-title {
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
}
.attention-detail {
  overflow: hidden;
  color: #64748b;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attention-go {
  color: #2563eb;
  font-size: 13px;
  white-space: nowrap;
}
.pool-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}
.pool-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
}
.pool-stat.danger {
  border-color: #fecaca;
  background: #fef2f2;
}
.pool-label {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}
.pool-value {
  color: #0f172a;
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1.1;
}
.pool-stat.danger .pool-value {
  color: #dc2626;
}
.pool-bar {
  margin-bottom: 12px;
}
.pool-lines {
  margin-top: 4px;
  border-top: 1px solid #eef2f7;
  padding-top: 8px;
}
.usage-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
/* 这一块没有卡片边框，标题缩进到与上面卡片的标题对齐。 */
.usage-block > .chart-head {
  padding: 0 20px;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 4px;
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
.mix-bar {
  display: flex;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #e2e8f0;
}
.seg { height: 100%; }
.seg.calm { background: #2563eb; }
.seg.warn { background: #ea580c; }
.seg.danger { background: #dc2626; }
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
.chart-head > span {
  color: #94a3b8;
  font-size: 12px;
}
.rank-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rank-row,
.status-row {
  display: grid;
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
  cursor: pointer;
}
.rank-row {
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto;
}
.status-row {
  grid-template-columns: 72px minmax(0, 1fr);
  min-height: 44px;
}
.rank-row:hover,
.status-row:hover {
  background: #f1f5f9;
}
.rank-title {
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
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
.rank-value.warn { color: #c2410c; }
.rank-value.danger { color: #dc2626; }
.status-label {
  color: #64748b;
  font-size: 13px;
  font-weight: 600;
}
.status-detail {
  color: #0f172a;
  font-size: 14px;
}
.status-detail.danger {
  color: #dc2626;
}
@media (max-width: 1100px) {
  .chart-grid {
    grid-template-columns: 1fr;
  }
  .kpi-grid,
  .pool-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
