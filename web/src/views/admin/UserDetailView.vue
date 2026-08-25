<template>
  <div class="user-usage-page" v-loading="loading">
    <div class="detail-nav">
      <el-button link type="primary" @click="router.push('/admin/users')">← 返回员工列表</el-button>
    </div>

    <el-alert
      v-if="errorMessage"
      :title="errorMessage"
      type="error"
      :closable="false"
      show-icon
      class="error-alert"
    />

    <template v-if="usage">
      <section class="page-card profile-card">
        <div class="profile-main">
          <div>
            <div class="profile-title-row">
              <h2 class="page-title">{{ usage.employee.name }}</h2>
              <el-tag
                :type="usage.employee.status === 'active' ? 'success' : usage.employee.status === 'pending' ? 'warning' : 'danger'"
              >
                {{ employeeStatusLabel(usage.employee.status) }}
              </el-tag>
            </div>
            <p class="profile-meta">
              {{ usage.employee.phone }} · {{ usage.employee.dept || "未设置部门" }} ·
              {{ roleLabel(usage.employee.role) }}
            </p>
            <p class="profile-meta">最近登录：{{ formatDateTime(usage.employee.lastLoginAt) }}</p>
          </div>
          <div class="quota-summary">
            <span>今日已用 Tokens</span>
            <strong>{{ formatNumber(usage.quota.usedToday) }}</strong>
            <small>
              {{ usage.range.timezone }} ·
              {{ formatDateTimeInTimeZone(usage.quota.resetAt, usage.range.timezone) }} 重置
            </small>
          </div>
        </div>
      </section>

      <section class="page-card team-quota-card">
        <h3>团队配额</h3>
        <el-empty
          v-if="!usage.quota.teams?.length"
          description="未加入团队，无团队配额"
          :image-size="72"
        />
        <el-table v-else :data="usage.quota.teams" stripe>
          <el-table-column prop="teamName" label="团队" min-width="140" />
          <el-table-column label="团队每月额度" min-width="140">
            <template #default="{ row }">
              <el-tag v-if="row.teamQuota === 0" type="danger" size="small">未分配</el-tag>
              <span v-else>{{ formatYuan(row.teamQuota) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="团队本月已用" min-width="130">
            <template #default="{ row }">{{ formatYuan(row.teamUsedMonth) }}</template>
          </el-table-column>
          <el-table-column label="个人每日上限" min-width="180">
            <template #default="{ row }">
              <span v-if="row.myLimit == null">不限（受团队池约束）</span>
              <span v-else>{{ formatNumber(row.myLimit) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="个人今日已用" min-width="130">
            <template #default="{ row }">{{ formatNumber(row.myUsedToday) }}</template>
          </el-table-column>
        </el-table>
      </section>

      <section class="page-card range-card">
        <div class="range-head">
          <div>
            <h3>Token 用量</h3>
            <p>所有日期按 {{ usage.range.timezone }} 的自然日统计</p>
          </div>
          <div class="range-controls">
            <el-radio-group v-model="rangePreset" size="small" @change="applyPreset">
              <el-radio-button value="today">今天</el-radio-button>
              <el-radio-button value="7d">近 7 天</el-radio-button>
              <el-radio-button value="30d">近 30 天</el-radio-button>
              <el-radio-button value="custom">自定义</el-radio-button>
            </el-radio-group>
            <el-date-picker
              v-if="rangePreset === 'custom'"
              v-model="customRange"
              type="daterange"
              value-format="YYYY-MM-DD"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              size="small"
              :clearable="false"
              @change="applyCustomRange"
            />
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card"><span>输入 Token</span><strong>{{ formatNumber(usage.summary.promptTokens) }}</strong></div>
          <div class="kpi-card"><span>输出 Token</span><strong>{{ formatNumber(usage.summary.completionTokens) }}</strong></div>
          <div class="kpi-card primary"><span>总 Token</span><strong>{{ formatNumber(usage.summary.totalTokens) }}</strong></div>
          <div class="kpi-card"><span>请求数</span><strong>{{ formatNumber(usage.summary.requestCount) }}</strong></div>
          <div class="kpi-card danger"><span>失败数</span><strong>{{ formatNumber(usage.summary.errorCount) }}</strong></div>
          <div class="kpi-card"><span>成功率</span><strong>{{ formatPercent(usage.summary.successRate) }}</strong></div>
        </div>

        <el-alert
          v-if="usage.unknownUsageCount > 0"
          :title="`${formatNumber(usage.unknownUsageCount)} 条调用记录缺少 Token 用量，渠道和模型分布可能低于总量。`"
          type="warning"
          :closable="false"
          show-icon
          class="usage-warning"
        />

        <el-empty v-if="!hasUsage" description="所选日期范围内暂无调用数据" :image-size="90" />
        <div v-else class="charts-grid">
          <article class="chart-card wide">
            <h4>每日输入 / 输出 Token</h4>
            <UsageChart :option="tokenTrendOption" />
          </article>
          <article class="chart-card wide">
            <h4>每日请求 / 失败趋势</h4>
            <UsageChart :option="requestTrendOption" />
          </article>
          <article class="chart-card">
            <h4>按上游渠道分布</h4>
            <el-empty v-if="!usage.byProvider.length" description="暂无渠道用量" :image-size="70" />
            <UsageChart v-else :option="providerOption" />
          </article>
          <article class="chart-card">
            <h4>客户端模型 Token 排名</h4>
            <el-empty v-if="!usage.byModel.length" description="暂无模型用量" :image-size="70" />
            <UsageChart v-else :option="modelOption" />
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import type { EChartsCoreOption } from "echarts/core";
import { http } from "@/api/http";
import UsageChart from "@/components/UsageChart.vue";
import { formatDateTime, formatDateTimeInTimeZone } from "@/lib/date-time";
import { formatYuan } from "@/lib/tokens";

type UsageCounts = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  errorCount: number;
  successRate: number | null;
};

type UsageResponse = {
  employee: {
    id: number;
    name: string;
    phone: string;
    dept: string | null;
    role: "employee" | "admin" | "org_admin" | "team_admin";
    status: "pending" | "active" | "disabled";
    lastLoginAt: string | null;
  };
  range: { from: string; to: string; timezone: string };
  summary: UsageCounts;
  daily: Array<UsageCounts & { day: string }>;
  byProvider: Array<{ key: string; totalTokens: number; requestCount: number }>;
  byModel: Array<{ key: string; totalTokens: number; requestCount: number }>;
  unknownUsageCount: number;
  quota: {
    usedToday: number;
    resetAt: string;
    teams: Array<{
      teamId: number;
      teamName: string;
      teamQuota: number;
      teamUsedMonth: number;
      myLimit: number | null;
      myUsedToday: number;
    }>;
  };
};

type RangePreset = "today" | "7d" | "30d" | "custom";

const route = useRoute();
const router = useRouter();
const usage = ref<UsageResponse | null>(null);
const loading = ref(false);
const errorMessage = ref("");
const rangePreset = ref<RangePreset>("30d");
const customRange = ref<[string, string] | null>(null);
const from = ref("");
const to = ref("");
let requestSequence = 0;
const numberFormatter = new Intl.NumberFormat("zh-CN");

function employeeStatusLabel(status: UsageResponse["employee"]["status"]) {
  return status === "pending" ? "待审核" : status === "active" ? "正常" : "已停用";
}

function dateOnlyInTimeZone(timeZone: string): string {
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

function presetDates(preset: Exclude<RangePreset, "custom">, timeZone: string) {
  const end = dateOnlyInTimeZone(timeZone);
  return {
    from: preset === "today" ? end : shiftDateOnly(end, preset === "7d" ? -6 : -29),
    to: end,
  };
}

function setPresetDates(
  preset: Exclude<RangePreset, "custom">,
  timeZone = usage.value?.range.timezone ?? "Asia/Shanghai",
) {
  const next = presetDates(preset, timeZone);
  from.value = next.from;
  to.value = next.to;
}

function inclusiveDays(start: string, end: string): number {
  const first = new Date(`${start}T00:00:00Z`).getTime();
  const last = new Date(`${end}T00:00:00Z`).getTime();
  return Math.floor((last - first) / 86_400_000) + 1;
}

async function loadUsage() {
  const id = Number(route.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    usage.value = null;
    errorMessage.value = "员工 ID 无效";
    return;
  }
  const sequence = ++requestSequence;
  loading.value = true;
  errorMessage.value = "";
  try {
    const { data } = await http.get(`/api/admin/users/${id}/usage`, {
      params: { from: from.value, to: to.value },
    });
    if (sequence !== requestSequence) return;
    if (data.success) {
      const next = data.data as UsageResponse;
      if (rangePreset.value !== "custom") {
        const expected = presetDates(rangePreset.value, next.range.timezone);
        if (expected.from !== from.value || expected.to !== to.value) {
          from.value = expected.from;
          to.value = expected.to;
          await loadUsage();
          return;
        }
      }
      usage.value = next;
    }
  } catch (error: unknown) {
    if (sequence !== requestSequence) return;
    usage.value = null;
    errorMessage.value = (error as { response?: { data?: { message?: string } } })
      .response?.data?.message ?? "员工用量加载失败";
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}

function applyPreset(value: string | number | boolean | undefined) {
  if (value === "custom") {
    customRange.value = [from.value, to.value];
    return;
  }
  setPresetDates(value as Exclude<RangePreset, "custom">);
  loadUsage();
}

function applyCustomRange(value: [string, string] | null) {
  if (!value) return;
  const days = inclusiveDays(value[0], value[1]);
  if (days < 1 || days > 366) {
    ElMessage.warning("自定义日期范围最多 366 天");
    return;
  }
  [from.value, to.value] = value;
  loadUsage();
}

function resetForUser() {
  requestSequence += 1;
  usage.value = null;
  errorMessage.value = "";
  rangePreset.value = "30d";
  customRange.value = null;
  setPresetDates("30d");
  loadUsage();
}

const hasUsage = computed(() => Boolean(
  usage.value && (usage.value.summary.requestCount > 0 || usage.value.summary.totalTokens > 0),
));

const commonTooltip = { trigger: "axis", confine: true } as const;
const tokenTrendOption = computed<EChartsCoreOption>(() => ({
  color: ["#2563eb", "#7c3aed"],
  tooltip: commonTooltip,
  legend: { top: 0 },
  grid: { left: 20, right: 20, bottom: 20, top: 42, containLabel: true },
  xAxis: { type: "category", data: usage.value?.daily.map((row) => row.day.slice(5)) ?? [] },
  yAxis: { type: "value" },
  series: [
    { name: "输入 Token", type: "bar", stack: "tokens", data: usage.value?.daily.map((row) => row.promptTokens) ?? [] },
    { name: "输出 Token", type: "bar", stack: "tokens", data: usage.value?.daily.map((row) => row.completionTokens) ?? [] },
  ],
}));

const requestTrendOption = computed<EChartsCoreOption>(() => ({
  color: ["#0f766e", "#dc2626"],
  tooltip: commonTooltip,
  legend: { top: 0 },
  grid: { left: 20, right: 20, bottom: 20, top: 42, containLabel: true },
  xAxis: { type: "category", data: usage.value?.daily.map((row) => row.day.slice(5)) ?? [] },
  yAxis: { type: "value", minInterval: 1 },
  series: [
    { name: "请求数", type: "line", smooth: true, data: usage.value?.daily.map((row) => row.requestCount) ?? [] },
    { name: "失败数", type: "line", smooth: true, data: usage.value?.daily.map((row) => row.errorCount) ?? [] },
  ],
}));

const providerOption = computed<EChartsCoreOption>(() => ({
  tooltip: { trigger: "item", confine: true },
  legend: { type: "scroll", bottom: 0 },
  series: [{
    type: "pie",
    radius: ["40%", "68%"],
    center: ["50%", "44%"],
    data: usage.value?.byProvider.map((row) => ({
      name: row.key === "other" ? "其他" : row.key === "unknown" ? "未知渠道" : row.key,
      value: row.totalTokens,
    })) ?? [],
  }],
}));

const modelOption = computed<EChartsCoreOption>(() => {
  const rows = [...(usage.value?.byModel ?? [])].reverse();
  return {
    tooltip: commonTooltip,
    grid: { left: 20, right: 20, bottom: 20, top: 12, containLabel: true },
    xAxis: { type: "value" },
    yAxis: {
      type: "category",
      data: rows.map((row) => row.key === "other" ? "其他" : row.key),
      axisLabel: { width: 150, overflow: "truncate" },
    },
    series: [{ type: "bar", data: rows.map((row) => row.totalTokens), itemStyle: { color: "#2563eb" } }],
  };
});

function formatNumber(value: number): string {
  return numberFormatter.format(value ?? 0);
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function roleLabel(role: UsageResponse["employee"]["role"]): string {
  return { employee: "员工", admin: "超级管理员", org_admin: "企业管理员", team_admin: "团队管理员" }[role];
}

watch(() => route.params.id, resetForUser, { immediate: true });
onBeforeUnmount(() => { requestSequence += 1; });
</script>

<style scoped>
.user-usage-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 320px;
}
.detail-nav { min-height: 24px; }
.error-alert { margin-bottom: 8px; }
.profile-card { padding: 20px 22px; }
.profile-main,
.range-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}
.profile-title-row { display: flex; align-items: center; gap: 10px; }
.profile-title-row .page-title { margin: 0; }
.profile-meta { margin: 7px 0 0; color: #64748b; font-size: 13px; }
.quota-summary {
  display: flex;
  flex-direction: column;
  min-width: 260px;
  padding: 14px 16px;
  border-radius: 10px;
  background: #eff6ff;
}
.quota-summary span { color: #64748b; font-size: 12px; }
.quota-summary strong { margin: 4px 0; color: #1d4ed8; font-size: 24px; }
.quota-summary small { color: #64748b; line-height: 1.6; }
.team-quota-card { padding: 20px 22px; }
.team-quota-card h3 { margin: 0 0 12px; font-size: 16px; }
.range-card { padding: 20px 22px; }
.range-head h3 { margin: 0; font-size: 18px; }
.range-head p { margin: 5px 0 0; color: #94a3b8; font-size: 12px; }
.range-controls { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin-top: 18px;
}
.kpi-card { padding: 14px; border: 1px solid #e5e7eb; border-radius: 9px; background: #f8fafc; }
.kpi-card span { display: block; color: #64748b; font-size: 12px; }
.kpi-card strong { display: block; margin-top: 7px; color: #0f172a; font-size: 21px; font-variant-numeric: tabular-nums; }
.kpi-card.primary { background: #eff6ff; border-color: #bfdbfe; }
.kpi-card.primary strong { color: #1d4ed8; }
.kpi-card.danger strong { color: #b42318; }
.usage-warning { margin-top: 14px; }
.charts-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 16px; }
.chart-card { min-width: 0; padding: 14px; border: 1px solid #e5e7eb; border-radius: 10px; }
.chart-card.wide { grid-column: 1 / -1; }
.chart-card h4 { margin: 0 0 4px; color: #334155; font-size: 14px; }
@media (max-width: 1100px) {
  .kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .profile-main,
  .range-head { flex-direction: column; }
  .quota-summary { width: 100%; min-width: 0; box-sizing: border-box; }
  .range-controls { justify-content: flex-start; }
  .kpi-grid,
  .charts-grid { grid-template-columns: 1fr; }
  .chart-card.wide { grid-column: auto; }
}
</style>
