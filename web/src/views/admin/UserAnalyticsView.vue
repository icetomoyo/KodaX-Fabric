<template>
  <div class="user-analytics" v-loading="loading">
    <div class="toolbar">
      <el-date-picker
        v-model="day"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="选择日期"
        :clearable="false"
        @change="onDayChange"
      />
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="split">
      <aside class="rank-pane page-card">
        <div class="pane-head">
          <h3>单日使用量</h3>
          <span>{{ day }} · {{ visibleRanks.length }}{{ nameQuery.trim() ? ` / ${ranks.length}` : "" }} 人</span>
        </div>
        <el-input
          v-model="nameQuery"
          class="rank-search"
          clearable
          placeholder="输入姓名"
        />
        <div class="rank-list">
        <el-empty v-if="!loading && !ranks.length" description="这一天还没有人调用" :image-size="64" />
        <el-empty v-else-if="!loading && !visibleRanks.length" description="没有匹配的人" :image-size="64" />
        <button
          v-for="row in visibleRanks"
          :key="row.employeeId"
          type="button"
          class="rank-row"
          :class="{ selected: row.employeeId === selectedId }"
          @click="selectEmployee(row.employeeId)"
        >
          <span class="rank-index">{{ row.rank }}</span>
          <span class="rank-who">
            <strong>{{ row.name }}</strong>
            <small>{{ rankSub(row) }}</small>
          </span>
          <span class="rank-meta">{{ formatNumber(row.requestCount) }} 次</span>
          <span class="rank-value">{{ formatTokenCompact(row.totalTokens) }}</span>
        </button>
        </div>
      </aside>

      <main ref="detailPane" class="detail-pane">
        <el-empty v-if="!loading && !selected" description="选择左侧的人查看用量" :image-size="80" />
        <template v-else-if="selected">
          <section class="page-card person-card">
            <div>
              <h2>{{ selected.employee.name }}</h2>
              <p>
                {{ selected.employee.phone }}
                <template v-if="selected.employee.enterpriseName">
                  · {{ selected.employee.enterpriseName }}
                </template>
                <template v-if="selected.employee.departmentName">
                  · {{ selected.employee.departmentName }}
                </template>
                · {{ usageTierLabel(selected.employee.usageTier) }}
              </p>
            </div>
            <dl class="year-stats">
              <div>
                <dt>近一年 Tokens</dt>
                <dd>{{ formatTokenCompact(selected.year.totalTokens) }}</dd>
              </div>
              <div>
                <dt>活跃天数</dt>
                <dd>{{ formatNumber(selected.year.activeDays) }}</dd>
              </div>
              <div>
                <dt>当前连续</dt>
                <dd>{{ formatNumber(selected.year.current) }} 天</dd>
              </div>
              <div>
                <dt>最长连续</dt>
                <dd>{{ formatNumber(selected.year.longest) }} 天</dd>
              </div>
            </dl>
          </section>

          <section class="page-card heatmap-card">
            <div class="pane-head">
              <h3>调用热力图</h3>
              <span>{{ selected.heatmap.from }} ~ {{ selected.heatmap.to }}</span>
            </div>
            <div class="contribution-graph" role="img" :aria-label="`${selected.employee.name} 近一年调用热力图`">
              <div class="months">
                <span
                  v-for="month in selected.heatmap.months"
                  :key="`${month.weekIndex}-${month.label}`"
                  class="month"
                  :style="{ left: `${month.weekIndex * 15}px` }"
                >
                  {{ month.label }}
                </span>
              </div>
              <div class="graph-body">
                <div class="wdays">
                  <span>一</span>
                  <span>三</span>
                  <span>五</span>
                </div>
                <div class="weeks">
                  <div v-for="(week, weekIndex) in selected.heatmap.weeks" :key="weekIndex" class="week">
                    <button
                      v-for="(cell, dayIndex) in week.days"
                      :key="dayIndex"
                      type="button"
                      class="cell"
                      :class="cell ? `level-${cell.level}` : 'is-empty'"
                      :disabled="!cell"
                      :title="cellTitle(cell)"
                      @click="cell && onHeatmapClick(cell.date)"
                    />
                  </div>
                </div>
              </div>
              <div class="legend">
                <span>少</span>
                <i class="cell level-0" />
                <i class="cell level-1" />
                <i class="cell level-2" />
                <i class="cell level-3" />
                <i class="cell level-4" />
                <span>多</span>
              </div>
            </div>
            <div class="week-split">
              <span>工作日 {{ formatTokenCompact(selected.year.weekdayTokens) }}</span>
              <span>周末 {{ formatTokenCompact(selected.year.weekendTokens) }}</span>
            </div>
          </section>

          <div class="kpi-grid">
            <div class="kpi-card accent">
              <span class="kpi-label">当日 Tokens</span>
              <strong class="kpi-value">{{ formatTokenCompact(selected.day.totalTokens) }}</strong>
              <span class="kpi-foot">{{ formatChangeFoot(dayChange, "较前一日") }}</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">请求</span>
              <strong class="kpi-value">{{ formatNumber(selected.day.requestCount) }}</strong>
              <span class="kpi-foot">失败 {{ formatNumber(selected.day.errorCount) }}</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">成功率</span>
              <strong class="kpi-value">{{ formatPercent(selected.day.successRate) }}</strong>
              <span class="kpi-foot">次均 {{ selected.day.avgTokens == null ? "—" : formatTokenCompact(selected.day.avgTokens) }}</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">积分</span>
              <strong class="kpi-value">{{ formatCredits(selected.day.credits) }}</strong>
              <span class="kpi-foot">
                高峰 {{ formatCredits(selected.day.peakCredits) }}
                <br>
                非高峰 {{ formatCredits(selected.day.offPeakCredits) }}
              </span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">缓存命中</span>
              <strong class="kpi-value">{{ formatPercent(selected.day.cacheHitRate) }}</strong>
              <span class="kpi-foot">{{ formatTokenCompact(selected.day.cacheReadTokens) }} Token</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">最忙小时</span>
              <strong class="kpi-value">{{ selected.day.peakHour?.hour || "—" }}</strong>
              <span class="kpi-foot">
                14–18 {{ formatTokenCompact(selected.day.peakTokens) }}
                <br>
                其余 {{ formatTokenCompact(selected.day.offPeakTokens) }}
              </span>
            </div>
          </div>

          <section class="page-card mix-card">
            <div class="mix-row">
              <div class="mix-block">
                <div class="mix-legend">
                  <span><i class="dot prompt" />未缓存输入 {{ formatTokenCompact(selected.day.composition.uncachedPrompt) }}</span>
                  <span><i class="dot cache" />缓存命中 {{ formatTokenCompact(selected.day.composition.cacheRead) }}</span>
                  <span><i class="dot completion" />输出 {{ formatTokenCompact(selected.day.composition.completion) }}</span>
                </div>
                <div class="mix-bar" aria-label="Token 构成">
                  <span class="seg prompt" :style="{ width: mixWidth(selected.day.composition.uncachedPrompt, compositionTotal) }" />
                  <span class="seg cache" :style="{ width: mixWidth(selected.day.composition.cacheRead, compositionTotal) }" />
                  <span class="seg completion" :style="{ width: mixWidth(selected.day.composition.completion, compositionTotal) }" />
                </div>
              </div>
              <div class="mix-block">
                <div class="mix-legend">
                  <span v-for="row in productTypeRows" :key="row.key">
                    {{ row.label }} {{ formatPercent(row.share) }}
                  </span>
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
              <div class="pane-head">
                <h3>当日时段</h3>
                <span>24 小时</span>
              </div>
              <UsageChart :option="hourlyOption" height="220px" />
            </section>
            <section class="page-card chart-card">
              <div class="pane-head">
                <h3>模型</h3>
              </div>
              <el-empty v-if="!selected.day.byModel.length" description="当日暂无模型用量" :image-size="48" />
              <div v-else class="mini-rank">
                <div v-for="row in selected.day.byModel" :key="row.key" class="mini-row">
                  <span>{{ row.key }}</span>
                  <span>{{ formatNumber(row.requestCount) }} 次</span>
                  <strong>{{ formatTokenCompact(row.totalTokens) }}</strong>
                </div>
              </div>
            </section>
          </div>

          <section class="page-card chart-card">
            <div class="pane-head">
              <h3>渠道</h3>
            </div>
            <el-empty v-if="!selected.day.byProvider.length" description="当日暂无渠道用量" :image-size="48" />
            <div v-else class="mini-rank">
              <div v-for="row in selected.day.byProvider" :key="row.key" class="mini-row">
                <span>{{ providerLabel(row.key) }}</span>
                <span>
                  {{ formatNumber(row.requestCount) }} 次
                  <template v-if="row.errorCount > 0"> · 失败 {{ formatNumber(row.errorCount) }}</template>
                </span>
                <strong>{{ formatTokenCompact(row.totalTokens) }}</strong>
              </div>
            </div>
          </section>
        </template>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import type { EChartsCoreOption } from "echarts/core";
import { http } from "@/api/http";
import UsageChart from "@/components/UsageChart.vue";
import { formatTokenCompact } from "@/lib/tokens";
import { formatChangeFoot, formatPercent, quotaDayAt } from "@/lib/workbench-today";

type RankRow = {
  rank: number;
  employeeId: number;
  name: string;
  phone: string;
  usageTier: string;
  enterpriseName: string | null;
  departmentName: string | null;
  totalTokens: number;
  requestCount: number;
  errorCount: number;
};

type HeatCell = {
  date: string;
  totalTokens: number;
  requestCount: number;
  level: 0 | 1 | 2 | 3 | 4;
};

type SelectedUser = {
  employee: {
    id: number;
    name: string;
    phone: string;
    usageTier: string;
    enterpriseName: string | null;
    departmentName: string | null;
  };
  heatmap: {
    from: string;
    to: string;
    weeks: Array<{ days: Array<HeatCell | null> }>;
    months: Array<{ label: string; weekIndex: number }>;
  };
  year: {
    totalTokens: number;
    requestCount: number;
    activeDays: number;
    current: number;
    longest: number;
    weekdayTokens: number;
    weekendTokens: number;
  };
  day: {
    totalTokens: number;
    requestCount: number;
    errorCount: number;
    successRate: number | null;
    cacheReadTokens: number;
    cacheHitRate: number | null;
    avgTokens: number | null;
    credits: number;
    peakCredits: number;
    offPeakCredits: number;
    peakTokens: number;
    offPeakTokens: number;
    previousTokens: number;
    peakHour: { hour: string; totalTokens: number } | null;
    hourly: Array<{ hour: string; totalTokens: number; requestCount: number }>;
    composition: { uncachedPrompt: number; cacheRead: number; completion: number };
    byModel: Array<{ key: string; totalTokens: number; requestCount: number }>;
    byProvider: Array<{ key: string; totalTokens: number; requestCount: number; errorCount: number }>;
    byProductType: Array<{ key: string; totalTokens: number; requestCount: number }>;
  };
};

const PRODUCT_TYPE_LABEL: Record<string, string> = {
  coding_plan: "套餐",
  api: "充值",
  unknown: "未知",
};

const PROVIDER_META: Record<string, string> = {
  glm: "智谱/GLM",
  kimi: "月之暗面/Kimi",
  deepseek: "深度求索/DeepSeek",
  minimax: "MiniMax",
};

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const day = ref(
  typeof route.query.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(route.query.day)
    ? route.query.day
    : quotaDayAt(new Date()),
);
const selectedId = ref<number | null>(
  Number(route.query.employeeId) > 0 ? Number(route.query.employeeId) : null,
);
const ranks = ref<RankRow[]>([]);
const nameQuery = ref("");
const selected = ref<SelectedUser | null>(null);
const detailPane = ref<HTMLElement | null>(null);

const visibleRanks = computed(() => {
  const q = nameQuery.value.trim().toLowerCase();
  if (!q) return ranks.value;
  return ranks.value.filter((row) => row.name.toLowerCase().includes(q));
});

const compositionTotal = computed(() => {
  const row = selected.value?.day.composition;
  if (!row) return 0;
  return row.uncachedPrompt + row.cacheRead + row.completion;
});

const productTypeTotal = computed(() =>
  (selected.value?.day.byProductType ?? []).reduce((sum, row) => sum + row.totalTokens, 0),
);

const productTypeRows = computed(() =>
  (selected.value?.day.byProductType ?? []).map((row) => ({
    key: row.key,
    label: PRODUCT_TYPE_LABEL[row.key] ?? row.key,
    totalTokens: row.totalTokens,
    share: productTypeTotal.value > 0 ? row.totalTokens / productTypeTotal.value : 0,
  })).filter((row) => row.totalTokens > 0),
);

const dayChange = computed(() => {
  const current = selected.value?.day.totalTokens ?? 0;
  const previous = selected.value?.day.previousTokens ?? 0;
  if (!(previous > 0)) return null;
  return (current - previous) / previous;
});

const hourlyOption = computed<EChartsCoreOption>(() => {
  const hours = selected.value?.day.hourly ?? [];
  return {
    color: ["#2563eb"],
    tooltip: { trigger: "axis", confine: true },
    grid: { left: 8, right: 8, bottom: 8, top: 16, containLabel: true },
    xAxis: {
      type: "category",
      data: hours.map((row) => row.hour),
      axisLabel: { interval: 3, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (value: number) => formatTokenCompact(value) },
    },
    series: [
      {
        name: "Tokens",
        type: "bar",
        data: hours.map((row) => row.totalTokens),
      },
    ],
  };
});

function rankSub(row: RankRow): string {
  return [row.enterpriseName, row.departmentName].filter(Boolean).join(" · ") || row.phone;
}

function usageTierLabel(tier: string): string {
  if (tier === "heavy") return "重度";
  if (tier === "standard") return "标准";
  if (tier === "idle") return "闲置";
  return tier || "—";
}

function providerLabel(code: string): string {
  if (!code || code === "unknown") return "未知渠道";
  return PROVIDER_META[code] ?? code;
}

function mixWidth(part: number, total: number): string {
  if (!(total > 0) || !(part > 0)) return "0%";
  return `${Math.max(2, Math.round((part / total) * 100))}%`;
}

function formatNumber(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("zh-CN").format(n);
}

function formatCredits(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 10_000) return formatTokenCompact(n);
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(n);
}

function cellTitle(cell: HeatCell | null): string {
  if (!cell) return "";
  return `${cell.date} · ${formatTokenCompact(cell.totalTokens)} · ${formatNumber(cell.requestCount)} 次`;
}

function selectEmployee(id: number) {
  if (selectedId.value === id) return;
  selectedId.value = id;
  void load();
}

function scrollDetailToTop() {
  void nextTick(() => {
    detailPane.value?.scrollTo({ top: 0 });
  });
}

function onDayChange() {
  void load();
}

function onHeatmapClick(date: string) {
  if (date === day.value) return;
  day.value = date;
  void load();
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/user-analytics", {
      params: {
        day: day.value,
        employeeId: selectedId.value || undefined,
      },
    });
    if (!data.success) throw new Error(data.message || "加载失败");
    ranks.value = data.data.ranks ?? [];
    selected.value = data.data.selected ?? null;
    if (data.data.day) day.value = data.data.day;
    selectedId.value = selected.value?.employee.id ?? ranks.value[0]?.employeeId ?? null;
    scrollDetailToTop();
    await router.replace({
      query: {
        day: day.value,
        ...(selectedId.value ? { employeeId: String(selectedId.value) } : {}),
      },
    });
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 403) return;
    const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
    ElMessage.error(typeof message === "string" ? message : "加载用户分析失败");
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.user-analytics {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.toolbar {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 8px;
}
.split {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
  overflow: hidden;
}
.page-card {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
}
.rank-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.rank-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.pane-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 8px;
}
.pane-head h3,
.person-card h2 {
  margin: 0;
  font-size: 15px;
}
.pane-head span {
  color: #94a3b8;
  font-size: 12px;
}
.rank-search {
  padding: 0 12px 8px;
}
.rank-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 10px 16px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.rank-row:hover,
.rank-row.selected {
  background: #f8fafc;
}
.rank-row.selected {
  box-shadow: inset 3px 0 0 #2563eb;
}
.rank-index {
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}
.rank-who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.rank-who strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-who small,
.rank-meta {
  color: #94a3b8;
  font-size: 12px;
}
.rank-value {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}
.detail-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
  padding-bottom: 88px;
}
.person-card {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
}
.person-card p {
  margin: 6px 0 0;
  color: #64748b;
}
.year-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(72px, auto));
  gap: 12px 20px;
  margin: 0;
}
.year-stats dt {
  color: #94a3b8;
  font-size: 12px;
}
.year-stats dd {
  margin: 4px 0 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.heatmap-card {
  padding: 0 16px 14px;
}
.contribution-graph {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-x: auto;
}
.months {
  position: relative;
  height: 16px;
  margin-left: 22px;
  color: #64748b;
  font-size: 11px;
}
.month {
  position: absolute;
  white-space: nowrap;
}
.graph-body {
  display: flex;
  gap: 6px;
}
.wdays {
  display: grid;
  grid-template-rows: 12px 12px 12px 12px 12px 12px 12px;
  gap: 3px;
  color: #64748b;
  font-size: 10px;
}
.wdays span:nth-child(1) { grid-row: 2; }
.wdays span:nth-child(2) { grid-row: 4; }
.wdays span:nth-child(3) { grid-row: 6; }
.weeks {
  display: flex;
  gap: 3px;
}
.week {
  display: grid;
  grid-template-rows: repeat(7, 12px);
  gap: 3px;
}
.cell {
  width: 12px;
  height: 12px;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: #ebedf0;
}
.cell.is-empty {
  background: transparent;
}
.cell.level-0 { background: #ebedf0; }
.cell.level-1 { background: #9be9a8; }
.cell.level-2 { background: #40c463; }
.cell.level-3 { background: #30a14e; }
.cell.level-4 { background: #216e39; }
.legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  color: #94a3b8;
  font-size: 11px;
}
.legend .cell {
  display: inline-block;
}
.week-split {
  display: flex;
  gap: 16px;
  margin-top: 10px;
  color: #64748b;
  font-size: 12px;
}
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.kpi-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 112px;
  padding: 14px 16px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: linear-gradient(180deg, #fff 0%, #f8fafc 100%);
}
.kpi-card.accent {
  border-color: #bfdbfe;
  background: linear-gradient(180deg, #eff6ff 0%, #f8fafc 100%);
}
.kpi-label {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}
.kpi-value {
  color: #0f172a;
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  overflow-wrap: anywhere;
}
.kpi-foot {
  margin-top: auto;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.45;
}
.mix-card,
.chart-card {
  padding: 16px;
}
.mix-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 24px;
}
.mix-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-bottom: 8px;
  color: #64748b;
  font-size: 12px;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-radius: 50%;
}
.dot.prompt { background: #2563eb; }
.dot.cache { background: #7c3aed; }
.dot.completion { background: #0f766e; }
.mix-bar {
  display: flex;
  height: 10px;
  overflow: hidden;
  border-radius: 99px;
  background: #f1f5f9;
}
.seg { height: 100%; }
.seg.prompt { background: #2563eb; }
.seg.cache { background: #7c3aed; }
.seg.completion { background: #0f766e; }
.seg.coding_plan { background: #2563eb; }
.seg.api { background: #f59e0b; }
.seg.unknown { background: #94a3b8; }
.chart-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
}
.mini-rank {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mini-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
  font-size: 13px;
}
.mini-row span:nth-child(2) {
  color: #94a3b8;
}
.mini-row strong {
  font-variant-numeric: tabular-nums;
}
@media (max-width: 1100px) {
  .split {
    grid-template-columns: 1fr;
    overflow: auto;
  }
  .rank-pane {
    max-height: 360px;
  }
  .chart-grid,
  .mix-row,
  .kpi-grid {
    grid-template-columns: 1fr;
  }
  .year-stats {
    grid-template-columns: repeat(2, auto);
  }
}
</style>
