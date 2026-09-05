<template>
  <el-drawer
    :model-value="modelValue"
    :title="employee ? `${employee.name} 的用量` : '员工用量'"
    size="min(880px, 96vw)"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
    @opened="onOpened"
    @closed="onClosed"
  >
    <div v-loading="usageLoading" class="drawer-body">
      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        :closable="false"
        show-icon
      />

      <template v-if="employee">
        <p class="meta">
          {{ employee.phone }}
          <template v-if="employee.teamName"> · {{ employee.teamName }}</template>
          · {{ formatRoleLabel(employee.role) }}
        </p>

        <div class="today">
          <span>今日已用 Tokens</span>
          <strong>{{ formatTokenCount(usage?.quota.usedToday ?? 0) }}</strong>
        </div>
      </template>

      <div class="range-head">
        <div>
          <h3>Token 消耗</h3>
          <p>按 {{ usage?.range.timezone || "Asia/Shanghai" }} 自然日统计</p>
        </div>
        <el-radio-group v-model="rangePreset" size="small" @change="applyPreset">
          <el-radio-button value="today">今天</el-radio-button>
          <el-radio-button value="7d">近 7 天</el-radio-button>
          <el-radio-button value="30d">近 30 天</el-radio-button>
        </el-radio-group>
      </div>

      <div class="kpi-grid">
        <div class="kpi primary">
          <span>总 Token</span>
          <strong>{{ formatTokenCount(usage?.summary.totalTokens ?? 0) }}</strong>
        </div>
        <div class="kpi">
          <span>请求数</span>
          <strong>{{ formatTokenCount(usage?.summary.requestCount ?? 0) }}</strong>
        </div>
        <div class="kpi">
          <span>失败数</span>
          <strong>{{ formatTokenCount(usage?.summary.errorCount ?? 0) }}</strong>
        </div>
        <div class="kpi">
          <span>成功率</span>
          <strong>{{ formatPercent(usage?.summary.successRate ?? null) }}</strong>
        </div>
      </div>

      <el-empty
        v-if="!usageLoading && !hasUsage"
        description="所选日期范围内暂无调用数据"
        :image-size="72"
      />
      <UsageChart v-else-if="chartReady && hasUsage" :option="tokenTrendOption" height="200px" />

      <div class="records-head">
        <h3>消耗记录</h3>
        <p>{{ logTotal }} 条</p>
      </div>
      <el-table v-loading="logsLoading" :data="logItems" stripe size="small" empty-text="暂无消耗记录">
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="模型" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.clientModel || "—" }}</template>
        </el-table-column>
        <el-table-column label="Tokens" width="100" align="right">
          <template #default="{ row }">{{ formatTokenCount(row.totalTokens) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          v-model:current-page="logPage"
          background
          size="small"
          layout="total, prev, pager, next"
          :total="logTotal"
          :page-size="logPageSize"
          @current-change="loadLogs"
        />
      </div>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { EChartsCoreOption } from "echarts/core";
import { http } from "@/api/http";
import UsageChart from "@/components/UsageChart.vue";
import { formatDateTime } from "@/lib/date-time";
import { roleLabel as formatRoleLabel } from "@/lib/roles";
import { formatTokenCount } from "@/lib/tokens";

type Employee = {
  id: number;
  name: string;
  phone: string;
  role: "employee" | "admin" | "org_admin" | "dept_admin" | "team_admin";
  teamName?: string | null;
};

type UsageCounts = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  errorCount: number;
  successRate: number | null;
};

type UsageResponse = {
  range: { from: string; to: string; timezone: string };
  summary: UsageCounts;
  daily: Array<UsageCounts & { day: string }>;
  quota: { usedToday: number };
};

type LogStatus = "success" | "upstream_error" | "client_error" | "cancelled";

type LogRow = {
  requestId: string;
  clientModel: string | null;
  status: LogStatus;
  totalTokens: number | null;
  createdAt: string;
};

const props = defineProps<{
  modelValue: boolean;
  employee: Employee | null;
}>();
const emit = defineEmits<{ "update:modelValue": [boolean] }>();

type RangePreset = "today" | "7d" | "30d";

const usage = ref<UsageResponse | null>(null);
const usageLoading = ref(false);
const logsLoading = ref(false);
const errorMessage = ref("");
const rangePreset = ref<RangePreset>("30d");
const from = ref("");
const to = ref("");
const chartReady = ref(false);
const logItems = ref<LogRow[]>([]);
const logTotal = ref(0);
const logPage = ref(1);
const logPageSize = 10;
let usageSequence = 0;
let logsSequence = 0;

const hasUsage = computed(() =>
  Boolean(usage.value && (usage.value.summary.requestCount > 0 || usage.value.summary.totalTokens > 0)),
);

const tokenTrendOption = computed<EChartsCoreOption>(() => ({
  color: ["#2563eb", "#7c3aed"],
  tooltip: { trigger: "axis", confine: true },
  legend: { top: 0 },
  grid: { left: 16, right: 16, bottom: 16, top: 36, containLabel: true },
  xAxis: { type: "category", data: usage.value?.daily.map((row) => row.day.slice(5)) ?? [] },
  yAxis: { type: "value" },
  series: [
    { name: "输入 Token", type: "bar", stack: "tokens", data: usage.value?.daily.map((row) => row.promptTokens) ?? [] },
    { name: "输出 Token", type: "bar", stack: "tokens", data: usage.value?.daily.map((row) => row.completionTokens) ?? [] },
  ],
}));

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

function setPresetDates(preset: RangePreset, timeZone = usage.value?.range.timezone ?? "Asia/Shanghai") {
  const end = dateOnlyInTimeZone(timeZone);
  from.value = preset === "today" ? end : shiftDateOnly(end, preset === "7d" ? -6 : -29);
  to.value = end;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function statusText(status: LogStatus): string {
  return {
    success: "成功",
    upstream_error: "上游错误",
    client_error: "请求错误",
    cancelled: "已取消",
  }[status];
}

function statusTagType(status: LogStatus): "success" | "danger" | "warning" | "info" {
  const tags = {
    success: "success",
    upstream_error: "danger",
    client_error: "warning",
    cancelled: "info",
  } as const;
  return tags[status];
}

async function loadUsage() {
  if (!props.employee) return;
  const sequence = ++usageSequence;
  usageLoading.value = true;
  errorMessage.value = "";
  try {
    const { data } = await http.get(`/api/admin/users/${props.employee.id}/usage`, {
      params: { from: from.value, to: to.value },
    });
    if (sequence !== usageSequence) return;
    if (data.success) usage.value = data.data as UsageResponse;
  } catch (error: unknown) {
    if (sequence !== usageSequence) return;
    usage.value = null;
    errorMessage.value = (error as { response?: { data?: { message?: string } } })
      .response?.data?.message ?? "员工用量加载失败";
  } finally {
    if (sequence === usageSequence) usageLoading.value = false;
  }
}

async function loadLogs() {
  if (!props.employee) return;
  const sequence = ++logsSequence;
  logsLoading.value = true;
  try {
    const { data } = await http.get(`/api/admin/users/${props.employee.id}/logs`, {
      params: {
        from: from.value,
        to: to.value,
        limit: logPageSize,
        offset: (logPage.value - 1) * logPageSize,
      },
    });
    if (sequence !== logsSequence) return;
    if (data.success) {
      logItems.value = data.data.items;
      logTotal.value = data.data.total;
    }
  } catch {
    if (sequence !== logsSequence) return;
    logItems.value = [];
    logTotal.value = 0;
  } finally {
    if (sequence === logsSequence) logsLoading.value = false;
  }
}

function applyPreset(value: string | number | boolean | undefined) {
  setPresetDates(value as RangePreset);
  logPage.value = 1;
  void Promise.all([loadUsage(), loadLogs()]);
}

function resetAndLoad() {
  usageSequence += 1;
  logsSequence += 1;
  usage.value = null;
  logItems.value = [];
  logTotal.value = 0;
  logPage.value = 1;
  errorMessage.value = "";
  rangePreset.value = "30d";
  setPresetDates("30d");
  void Promise.all([loadUsage(), loadLogs()]);
}

function onOpened() {
  chartReady.value = true;
}

function onClosed() {
  chartReady.value = false;
  usage.value = null;
  logItems.value = [];
  logTotal.value = 0;
  errorMessage.value = "";
}

watch(
  () => [props.modelValue, props.employee?.id] as const,
  ([open]) => {
    if (open && props.employee) resetAndLoad();
  },
);
</script>

<style scoped>
.drawer-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 240px;
}
.meta {
  margin: 0;
  color: #64748b;
  font-size: 13px;
}
.today {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #eff6ff;
}
.today span { color: #64748b; font-size: 12px; }
.today strong { color: #1d4ed8; font-size: 22px; font-variant-numeric: tabular-nums; }
.range-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.range-head h3,
.records-head h3 {
  margin: 0;
  font-size: 15px;
}
.range-head p,
.records-head p {
  margin: 4px 0 0;
  color: #94a3b8;
  font-size: 12px;
}
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.kpi {
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 9px;
  background: #f8fafc;
}
.kpi span { display: block; color: #64748b; font-size: 12px; }
.kpi strong {
  display: block;
  margin-top: 6px;
  color: #0f172a;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}
.kpi.primary { background: #eff6ff; border-color: #bfdbfe; }
.kpi.primary strong { color: #1d4ed8; }
.records-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 4px;
}
.pager {
  display: flex;
  justify-content: flex-end;
}
@media (max-width: 760px) {
  .range-head { flex-direction: column; }
  .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
