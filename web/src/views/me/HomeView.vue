<template>
  <div class="dashboard-page">
    <el-alert
      v-if="!hasEnterprise"
      class="join-alert"
      title="当前是普通注册用户，没有员工权限"
      type="warning"
      show-icon
      :closable="false"
    >
      <p>等待已有企业的团队管理员用你的注册手机号邀请进团队。</p>
    </el-alert>
    <el-alert
      v-else-if="hasEnterprise && !hasTeam"
      class="join-alert"
      title="尚未加入部门，仍是普通注册用户。被邀请进部门后才有员工权限（API Key / 调用）。"
      type="info"
      show-icon
      :closable="false"
    />

    <section class="page-card tips-card" aria-label="友情提示">
      <h3 class="tips-title">友情提示</h3>
      <ol class="tips-list">
        <li>
          <button type="button" class="tip-link" @click="router.push('/me/guide')">
            <strong>教程看了吗？</strong>
            <span>先看教程，复制 Base URL 和部门 Key 填进客户端。</span>
          </button>
        </li>
        <li>
          <button type="button" class="tip-link" @click="router.push('/me/keys')">
            <strong>API Key 配置了吗？</strong>
            <span>创建后填进客户端。Base URL 不要带端口或接口路径。</span>
          </button>
        </li>
        <li>
          <button type="button" class="tip-link" @click="router.push('/me/logs')">
            <strong>调用突然失败？</strong>
            <span>到「调用记录」复制 Request ID，发给右下角 Token Bot，它会帮你分析原因。</span>
          </button>
        </li>
      </ol>
    </section>

    <section class="page-card hero-card">
      <div class="page-head">
        <div class="head-actions">
          <el-button :loading="loading" @click="loadUsage">刷新</el-button>
        </div>
      </div>

      <div v-loading="loading" class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-label">今日请求</span>
          <strong class="kpi-value">{{ formatNumber(usage?.today?.requestCount) }}</strong>
          <span class="kpi-foot">
            失败
            <b :class="{ danger: (usage?.today?.errorCount ?? 0) > 0 }">
              {{ formatNumber(usage?.today?.errorCount) }}
            </b>
          </span>
        </div>
        <div class="kpi-card accent">
          <span class="kpi-label">今日 Tokens</span>
          <strong class="kpi-value">{{ formatTokenCompact(usage?.today?.totalTokens) }}</strong>
          <span class="kpi-foot">本人合计消耗</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">本月 Tokens</span>
          <strong class="kpi-value">{{ formatTokenCompact(usage?.month?.totalTokens) }}</strong>
          <span class="kpi-foot">本月请求 {{ formatNumber(usage?.month?.requestCount) }}</span>
        </div>
      </div>

      <div class="quick-links">
        <button type="button" class="quick-link" @click="router.push('/me/keys')">
          <span class="quick-dot blue" />
          <span>
            <strong>API Key</strong>
            <small>创建 Key · 绑定渠道</small>
          </span>
        </button>
        <button type="button" class="quick-link" @click="router.push('/me/models')">
          <span class="quick-dot indigo" />
          <span>
            <strong>模型列表</strong>
            <small>可用模型</small>
          </span>
        </button>
        <button type="button" class="quick-link" @click="router.push('/me/guide')">
          <span class="quick-dot violet" />
          <span>
            <strong>教程</strong>
            <small>各客户端接入步骤</small>
          </span>
        </button>
        <button type="button" class="quick-link" @click="router.push('/me/logs')">
          <span class="quick-dot teal" />
          <span>
            <strong>调用记录</strong>
            <small>请求与消耗明细</small>
          </span>
        </button>
      </div>
    </section>

    <section class="analytics-section" aria-label="我的用量分析">
      <div class="analytics-toolbar">
        <div class="analytics-title">
          <h3>我的用量分析</h3>
          <span>点热力图格子可以切换日期</span>
        </div>
        <div class="head-actions">
          <el-date-picker
            v-model="analyticsDay"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择日期"
            :clearable="false"
            :disabled-date="isFutureDate"
            @change="onAnalyticsDayChange"
          />
          <el-button :loading="analyticsLoading" @click="loadAnalytics">刷新</el-button>
        </div>
      </div>

      <div v-loading="analyticsLoading" class="analytics-body">
        <el-empty
          v-if="!analyticsLoading && !stats"
          description="暂无用量数据"
          :image-size="80"
        />
        <template v-else-if="stats">
          <section class="page-card year-card">
            <div class="pane-head">
              <h3>近一年用量</h3>
              <span>{{ stats.heatmap.from }} ~ {{ stats.heatmap.to }}</span>
            </div>
            <dl class="year-stats">
              <div>
                <dt>近一年 Tokens</dt>
                <dd>{{ formatTokenCompact(stats.year.totalTokens) }}</dd>
              </div>
              <div>
                <dt>活跃天数</dt>
                <dd>{{ formatNumber(stats.year.activeDays) }}</dd>
              </div>
              <div>
                <dt>当前连续</dt>
                <dd>{{ formatNumber(stats.year.current) }} 天</dd>
              </div>
              <div>
                <dt>最长连续</dt>
                <dd>{{ formatNumber(stats.year.longest) }} 天</dd>
              </div>
            </dl>
            <div class="contribution-graph" role="img" aria-label="近一年调用热力图">
              <div class="months">
                <span
                  v-for="month in stats.heatmap.months"
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
                  <div v-for="(week, weekIndex) in stats.heatmap.weeks" :key="weekIndex" class="week">
                    <button
                      v-for="(cell, dayIndex) in week.days"
                      :key="dayIndex"
                      type="button"
                      class="cell"
                      :class="[cell ? `level-${cell.level}` : 'is-empty', { today: cell?.date === analyticsDay }]"
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
              <span>工作日 {{ formatTokenCompact(stats.year.weekdayTokens) }}</span>
              <span>周末 {{ formatTokenCompact(stats.year.weekendTokens) }}</span>
            </div>
          </section>

          <div class="kpi-grid analytics-kpi">
            <div class="kpi-card accent">
              <span class="kpi-label">{{ analyticsDay === todayKey ? '今日' : '当日' }} Tokens</span>
              <strong class="kpi-value">{{ formatTokenCompact(stats.day.totalTokens) }}</strong>
              <span class="kpi-foot">{{ formatChangeFoot(dayChange, "较前一日") }}</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">请求</span>
              <strong class="kpi-value">{{ formatNumber(stats.day.requestCount) }}</strong>
              <span class="kpi-foot">失败 {{ formatNumber(stats.day.errorCount) }}</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">成功率</span>
              <strong class="kpi-value">{{ formatPercent(stats.day.successRate) }}</strong>
              <span class="kpi-foot">次均 {{ stats.day.avgTokens == null ? "—" : formatTokenCompact(stats.day.avgTokens) }}</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">缓存命中</span>
              <strong class="kpi-value">{{ formatPercent(stats.day.cacheHitRate) }}</strong>
              <span class="kpi-foot">{{ formatTokenCompact(stats.day.cacheReadTokens) }} Token</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">最忙小时</span>
              <strong class="kpi-value">{{ stats.day.peakHour?.hour || "—" }}</strong>
              <span class="kpi-foot">
                高峰时段 {{ formatTokenCompact(stats.day.peakTokens) }}
                <br>
                其余 {{ formatTokenCompact(stats.day.offPeakTokens) }}
              </span>
            </div>
          </div>

          <section class="page-card mix-card">
            <div class="mix-row">
              <div class="mix-block">
                <div class="mix-legend">
                  <span><i class="dot prompt" />未缓存输入 {{ formatTokenCompact(stats.day.composition.uncachedPrompt) }}</span>
                  <span><i class="dot cache" />缓存命中 {{ formatTokenCompact(stats.day.composition.cacheRead) }}</span>
                  <span><i class="dot completion" />输出 {{ formatTokenCompact(stats.day.composition.completion) }}</span>
                </div>
                <div class="mix-bar" aria-label="Token 构成">
                  <span class="seg prompt" :style="{ width: mixWidth(stats.day.composition.uncachedPrompt, compositionTotal) }" />
                  <span class="seg cache" :style="{ width: mixWidth(stats.day.composition.cacheRead, compositionTotal) }" />
                  <span class="seg completion" :style="{ width: mixWidth(stats.day.composition.completion, compositionTotal) }" />
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
              <el-empty v-if="!stats.day.byModel.length" description="当日暂无模型用量" :image-size="48" />
              <div v-else class="mini-rank">
                <div v-for="row in stats.day.byModel" :key="row.key" class="mini-row">
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
            <el-empty v-if="!stats.day.byProvider.length" description="当日暂无渠道用量" :image-size="48" />
            <div v-else class="mini-rank">
              <div v-for="row in stats.day.byProvider" :key="row.key" class="mini-row">
                <span>{{ providerText(row.key) }}</span>
                <span>
                  {{ formatNumber(row.requestCount) }} 次
                  <template v-if="row.errorCount > 0"> · 失败 {{ formatNumber(row.errorCount) }}</template>
                </span>
                <strong>{{ formatTokenCompact(row.totalTokens) }}</strong>
              </div>
            </div>
          </section>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { EChartsCoreOption } from "echarts/core";
import { http } from "@/api/http";
import UsageChart from "@/components/UsageChart.vue";
import { formatTokenCompact } from "@/lib/tokens";
import { formatChangeFoot, formatPercent, quotaDayAt } from "@/lib/workbench-today";

type UsageResponse = {
  today?: { totalTokens: number; requestCount: number; errorCount?: number };
  month?: { totalTokens: number; requestCount: number };
};

type HeatCell = {
  date: string;
  totalTokens: number;
  requestCount: number;
  level: 0 | 1 | 2 | 3 | 4;
};

type MyAnalytics = {
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

const providerNames: Record<string, string> = {
  glm: "智谱/GLM",
  kimi: "月之暗面/Kimi",
  deepseek: "深度求索/DeepSeek",
  minimax: "MiniMax",
};

const router = useRouter();
const loading = ref(false);
const hasEnterprise = ref(false);
const hasTeam = ref(false);
const usage = ref<UsageResponse | null>(null);

const todayKey = quotaDayAt(new Date());
const analyticsDay = ref(todayKey);
const stats = ref<MyAnalytics | null>(null);
const analyticsLoading = ref(false);

const compositionTotal = computed(() => {
  const row = stats.value?.day.composition;
  if (!row) return 0;
  return row.uncachedPrompt + row.cacheRead + row.completion;
});

const productTypeTotal = computed(() =>
  (stats.value?.day.byProductType ?? []).reduce((sum, row) => sum + row.totalTokens, 0),
);

const productTypeRows = computed(() =>
  (stats.value?.day.byProductType ?? []).map((row) => ({
    key: row.key,
    label: PRODUCT_TYPE_LABEL[row.key] ?? row.key,
    totalTokens: row.totalTokens,
    share: productTypeTotal.value > 0 ? row.totalTokens / productTypeTotal.value : 0,
  })).filter((row) => row.totalTokens > 0),
);

const dayChange = computed(() => {
  const current = stats.value?.day.totalTokens ?? 0;
  const previous = stats.value?.day.previousTokens ?? 0;
  if (!(previous > 0)) return null;
  return (current - previous) / previous;
});

const hourlyOption = computed<EChartsCoreOption>(() => {
  const hours = stats.value?.day.hourly ?? [];
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

function formatNumber(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("zh-CN").format(n);
}

function providerText(code: string | null): string {
  if (!code) return "—";
  return providerNames[code.toLowerCase()] ?? code;
}

function isFutureDate(value: Date): boolean {
  return quotaDayAt(value) > todayKey;
}

function cellTitle(cell: HeatCell | null): string {
  if (!cell) return "";
  return `${cell.date} · ${formatTokenCompact(cell.totalTokens)} · ${formatNumber(cell.requestCount)} 次`;
}

function mixWidth(part: number, total: number): string {
  if (!(total > 0) || !(part > 0)) return "0%";
  return `${Math.max(2, Math.round((part / total) * 100))}%`;
}

function onAnalyticsDayChange() {
  void loadAnalytics();
}

function onHeatmapClick(date: string) {
  if (date === analyticsDay.value) return;
  analyticsDay.value = date;
  void loadAnalytics();
}

// 请求序号守卫：日期快速切换时只认最后一次响应
let analyticsSeq = 0;

async function loadAnalytics() {
  const seq = ++analyticsSeq;
  analyticsLoading.value = true;
  try {
    const { data } = await http.get("/api/me/analytics", {
      params: { day: analyticsDay.value },
    });
    if (seq !== analyticsSeq) return;
    if (data.success) {
      stats.value = data.data.selected ?? null;
      if (data.data.day) analyticsDay.value = data.data.day;
    }
  } catch {
    if (seq !== analyticsSeq) return;
    stats.value = null;
  } finally {
    if (seq === analyticsSeq) analyticsLoading.value = false;
  }
}

async function loadUsage() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/me/usage");
    if (data.success) usage.value = data.data;
    const org = await http.get("/api/me/org");
    if (org.data.success) {
      hasEnterprise.value = org.data.data.enterprise?.status === "active";
      hasTeam.value = (org.data.data.departments ?? org.data.data.teams ?? []).length > 0;
    } else {
      hasEnterprise.value = false;
      hasTeam.value = false;
    }
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadUsage();
  void loadAnalytics();
});
</script>

<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.tips-card {
  padding: 16px 18px 8px;
  border: 1px solid #93c5fd;
  background: linear-gradient(180deg, #eff6ff 0%, #ffffff 100%);
}

.tips-title {
  margin: 0 0 10px;
  color: #1d4ed8;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.tips-list {
  margin: 0;
  padding: 0 0 8px 20px;
  color: #1e3a8a;
}

.tips-list li + li {
  margin-top: 6px;
}

.tip-link {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tip-link strong {
  color: #0f172a;
  font-size: 14px;
}

.tip-link span {
  color: #1e3a8a;
  font-size: 13px;
  line-height: 1.55;
}

.tip-link:hover strong {
  color: #1d4ed8;
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
.quick-dot.blue { background: #2563eb; }
.quick-dot.indigo { background: #4f46e5; }
.quick-dot.violet { background: #7c3aed; }
.quick-dot.teal { background: #0d9488; }
.join-alert {
  margin: 0;
}
.join-alert p {
  margin: 8px 0 12px;
}
.analytics-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.analytics-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.analytics-title h3 {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
}
.analytics-title span {
  color: #94a3b8;
  font-size: 12px;
}
.analytics-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.page-card {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
}
.pane-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 8px;
}
.pane-head h3 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
}
.pane-head span {
  color: #94a3b8;
  font-size: 12px;
}
.year-card {
  padding: 0 16px 14px;
}
.year-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(72px, 1fr));
  gap: 12px 20px;
  margin: 0;
}
.year-stats dt {
  color: #94a3b8;
  font-size: 12px;
}
.year-stats dd {
  margin: 4px 0 0;
  color: #0f172a;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.contribution-graph {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
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
.cell.today {
  box-shadow: 0 0 0 1.5px #2563eb;
}
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
.analytics-kpi {
  grid-template-columns: repeat(5, minmax(0, 1fr));
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
@media (max-width: 1280px) {
  .quick-links {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 1100px) {
  .chart-grid,
  .mix-row,
  .analytics-kpi {
    grid-template-columns: 1fr;
  }
  .year-stats {
    grid-template-columns: repeat(2, auto);
  }
}
@media (max-width: 760px) {
  .kpi-grid,
  .quick-links {
    grid-template-columns: 1fr;
  }
}
</style>
