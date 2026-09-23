<template>
  <el-card class="logs-page" shadow="never">
    <el-form :inline="true" class="filters" @keyup.enter="search">
      <el-form-item>
        <el-select
          v-model="filters.employeeId"
          clearable
          filterable
          remote
          :remote-method="searchEmployees"
          :loading="employeesLoading"
          placeholder="按人搜索"
          style="width: 220px"
          @change="onEmployeeChange"
        >
          <el-option
            v-for="item in employees"
            :key="item.id"
            :label="employeeOptionLabel(item)"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-select
          v-model="filters.model"
          clearable
          filterable
          :loading="modelsLoading"
          placeholder="按模型筛选"
          style="width: 220px"
        >
          <el-option
            v-for="item in models"
            :key="item.model"
            :label="item.model"
            :value="item.model"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-select v-model="filters.status" clearable placeholder="按状态筛选" style="width: 140px">
          <el-option label="成功" value="success" />
          <el-option label="上游错误" value="upstream_error" />
          <el-option label="请求错误" value="client_error" />
          <el-option label="已取消" value="cancelled" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-date-picker
          v-model="timeRange"
          type="datetimerange"
          value-format="YYYY-MM-DD HH:mm:ss"
          :default-time="defaultTime"
          range-separator="~"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          style="width: 380px"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
      </el-form-item>
      <el-form-item v-if="hasFilters">
        <el-button @click="resetFilters">重置</el-button>
      </el-form-item>
    </el-form>

    <el-table
      :data="items"
      stripe
      empty-text="暂无日志"
      v-loading="loading"
    >
      <el-table-column label="员工" width="100" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.employeeName || "—" }}
        </template>
      </el-table-column>
      <el-table-column prop="clientModel" label="模型" min-width="120" show-overflow-tooltip />
      <el-table-column label="Tokens" width="200">
        <template #default="{ row }">
          <dl class="metric-stack">
            <div><dt>输入</dt><dd>{{ formatNumber(row.tokenBreakdown?.input ?? uncachedPrompt(row)) }}</dd></div>
            <div><dt>输出</dt><dd>{{ formatNumber(row.tokenBreakdown?.output ?? row.completionTokens) }}</dd></div>
            <div><dt>缓存命中</dt><dd>{{ formatNumber(row.tokenBreakdown?.cacheHit ?? row.cacheReadTokens) }}</dd></div>
            <div><dt>合计</dt><dd>{{ formatNumber(row.tokenBreakdown?.total ?? row.totalTokens) }}</dd></div>
          </dl>
        </template>
      </el-table-column>
      <el-table-column width="120">
        <template #header>
          <el-tooltip :content="CREDIT_DISCOUNT_HINT" placement="top">
            <span>折扣</span>
          </el-tooltip>
        </template>
        <template #default="{ row }">
          <div class="discount-cell">
            <strong>{{ discountPercentText(row.creditDiscount) }}</strong>
            <small>{{ discountKindText(row.creditDiscount) }}</small>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="积分" width="200">
        <template #default="{ row }">
          <dl class="metric-stack">
            <div><dt>输入</dt><dd>{{ formatCreditPart(row, "input") }}</dd></div>
            <div><dt>输出</dt><dd>{{ formatCreditPart(row, "output") }}</dd></div>
            <div><dt>缓存命中</dt><dd>{{ formatCreditPart(row, "cacheHit") }}</dd></div>
            <div><dt>合计</dt><dd>{{ formatCredits(row.creditBreakdown?.total ?? row.credits) }}</dd></div>
          </dl>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status)">
            {{ statusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="220" class-name="col-time">
        <template #default="{ row }">
          <span class="time-cell">{{ formatDateTime(row.createdAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="详情" width="80" align="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-size="limit"
        v-model:current-page="page"
        @current-change="load"
      />
    </div>

    <el-drawer
      v-model="showDetail"
      :title="detail?.requestId || '请求详情'"
      size="min(720px, 96vw)"
      destroy-on-close
    >
      <div v-loading="detailLoading" class="detail-body">
        <template v-if="detail">
          <el-alert
            v-if="detail.omittedBodies"
            type="warning"
            :closable="false"
            show-icon
            title="请求/响应正文过大，详情里已省略，请下载 JSON 查看全文"
          />
          <el-alert
            v-else-if="!detail.hasContextFile"
            type="info"
            :closable="false"
            show-icon
            title="该请求没有全文记录（部署前的旧日志没有文件）"
          />

          <el-descriptions :column="2" border>
            <el-descriptions-item label="Request ID">
              <el-button link type="primary" @click="copyRequestId(detail.requestId)">
                {{ detail.requestId }}
              </el-button>
            </el-descriptions-item>
            <el-descriptions-item label="员工">
              {{ detail.employeeName }} · {{ detail.employeePhone }}
            </el-descriptions-item>
            <el-descriptions-item label="企业 / 部门">
              {{ orgScopeLabel(detail) }}
            </el-descriptions-item>
            <el-descriptions-item label="模型">{{ detail.clientModel }}</el-descriptions-item>
            <el-descriptions-item label="渠道">
              {{ detail.providerCode || "—" }} · {{ productTypeText(detail.productType) }}
            </el-descriptions-item>
            <el-descriptions-item label="状态">{{ statusText(detail.status) }}</el-descriptions-item>
            <el-descriptions-item label="时间">{{ formatDateTime(detail.createdAt) }}</el-descriptions-item>
            <el-descriptions-item label="积分折扣">
              <el-tooltip :content="CREDIT_DISCOUNT_HINT" placement="top">
                <span>{{ discountSummary(detail.creditDiscount) }}</span>
              </el-tooltip>
            </el-descriptions-item>
            <el-descriptions-item v-if="contextRecord" label="耗时">
              {{ contextRecord.latencyMs ?? "—" }} ms
            </el-descriptions-item>
            <el-descriptions-item v-if="contextRecord" label="协议 / 路径">
              {{ contextRecord.protocol }} · {{ contextRecord.path }}{{ contextRecord.stream ? " · 流式" : "" }}
            </el-descriptions-item>
            <el-descriptions-item v-if="contextRecord?.candidate" label="渠道 Key">
              •••• {{ contextRecord.candidate.credentialSuffix }} · {{ contextRecord.candidate.providerCode }}
            </el-descriptions-item>
            <el-descriptions-item v-if="detail.error" label="HTTP">
              {{ detail.error.httpStatus ?? "—" }} / 上游 {{ detail.error.upstreamStatus ?? "—" }}
            </el-descriptions-item>
          </el-descriptions>

          <el-table :data="consumptionRows" class="consumption-table" border>
            <el-table-column prop="kind" label="" width="88" />
            <el-table-column label="输入" align="right" header-align="right">
              <template #default="{ row }">
                <span class="metric-num">{{ row.input }}</span>
              </template>
            </el-table-column>
            <el-table-column label="输出" align="right" header-align="right">
              <template #default="{ row }">
                <span class="metric-num">{{ row.output }}</span>
              </template>
            </el-table-column>
            <el-table-column label="缓存命中" align="right" header-align="right">
              <template #default="{ row }">
                <span class="metric-num">{{ row.cacheHit }}</span>
              </template>
            </el-table-column>
            <el-table-column label="合计" align="right" header-align="right">
              <template #default="{ row }">
                <span class="metric-num">{{ row.total }}</span>
              </template>
            </el-table-column>
          </el-table>

          <el-alert
            v-if="detail.error"
            type="error"
            :closable="false"
            :title="detail.error.errorCode || '错误'"
            :description="detail.error.errorMessage || ''"
            show-icon
          />

          <section v-if="contextRecord?.retryTrace?.length">
            <el-divider content-position="left">调度轨迹</el-divider>
            <el-table :data="contextRecord.retryTrace" stripe>
              <el-table-column prop="attempt" label="#" width="50" />
              <el-table-column prop="credentialSuffix" label="Key" width="80" />
              <el-table-column prop="outcome" label="结果" width="100" />
              <el-table-column prop="status" label="HTTP" width="70" />
              <el-table-column prop="latencyMs" label="耗时" width="80" />
              <el-table-column prop="reason" label="原因" min-width="140" show-overflow-tooltip />
            </el-table>
          </section>

          <section v-if="contextRecord?.headers">
            <el-divider content-position="left">请求头</el-divider>
            <StructuredJson :value="contextRecord.headers" empty-text="没有保存请求头" />
          </section>
          <section>
            <el-divider content-position="left">请求体</el-divider>
            <StructuredJson :value="contextRecord?.requestBody" empty-text="没有保存请求体（部署前的旧日志没有全文）" />
          </section>
          <section>
            <el-divider content-position="left">响应</el-divider>
            <StructuredJson
              :value="contextRecord?.responseBody ?? contextRecord?.streamAudit?.assembled"
              empty-text="没有保存响应正文"
            />
          </section>
        </template>
      </div>
      <template #footer>
        <el-button @click="showDetail = false">关闭</el-button>
        <el-button
          type="primary"
          :disabled="!detail?.hasContextFile"
          :loading="Boolean(detail && downloadingId === detail.requestId)"
          @click="detail && downloadContext(detail)"
        >
          下载全文
        </el-button>
      </template>
    </el-drawer>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import StructuredJson from "@/components/StructuredJson.vue";
import { copyText } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/date-time";

type LogStatus = "success" | "upstream_error" | "client_error" | "cancelled";
type ProductType = "api" | "coding_plan";

interface UsageBreakdown {
  input: number | null;
  output: number | null;
  cacheHit: number | null;
  total: number | null;
}

type CreditDiscountKind = "peak" | "off_peak" | "mixed";

interface CreditDiscount {
  kind: CreditDiscountKind;
  inputMultiplier: number;
  outputMultiplier: number;
}

const CREDIT_DISCOUNT_HINT = "工作日 14:00–18:00（UTC+8）为高峰，按基础积分抵扣；其余时段按 50% 抵扣";

interface LogRow {
  id: number;
  requestId: string;
  employeeId: number;
  employeeName: string;
  enterpriseName: string | null;
  departmentName?: string | null;
  teamName: string | null;
  clientModel: string;
  providerCode: string | null;
  productType: ProductType | null;
  status: LogStatus;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  tokenBreakdown?: UsageBreakdown;
  creditDiscount?: CreditDiscount | null;
  creditBreakdown?: UsageBreakdown;
  credits: number;
  createdAt: string;
}

interface LogDetail extends LogRow {
  employeePhone: string;
  error: {
    httpStatus: number | null;
    upstreamStatus: number | null;
    errorCode: string | null;
    errorMessage: string | null;
  } | null;
  hasContextFile: boolean;
  omittedBodies: boolean;
  context: Record<string, unknown> | null;
}

const numberFormatter = new Intl.NumberFormat("zh-CN");
const creditFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 4,
  minimumFractionDigits: 0,
});

type EmployeeOption = {
  id: number;
  name: string;
  phone: string;
};

type ModelOption = { model: string; variants?: string[] };

const filters = reactive({
  employeeId: null as number | null,
  model: "",
  status: null as LogStatus | null,
});
const timeRange = ref<[string, string] | null>(null);
// datetimerange 面板默认时刻：起点零点、终点当天最后一秒
const defaultTime: [Date, Date] = [
  new Date(2000, 0, 1, 0, 0, 0),
  new Date(2000, 0, 1, 23, 59, 59),
];
const models = ref<ModelOption[]>([]);
const modelsLoading = ref(false);
const employees = ref<EmployeeOption[]>([]);
const selectedEmployee = ref<EmployeeOption | null>(null);
const employeesLoading = ref(false);
const items = ref<LogRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 5;
const loading = ref(false);
const downloadingId = ref<string | null>(null);
const showDetail = ref(false);
const detailLoading = ref(false);
const detail = ref<LogDetail | null>(null);

const hasFilters = computed(() =>
  Boolean(filters.employeeId || filters.model || filters.status || timeRange.value));

function orgScopeLabel(row: {
  enterpriseName: string | null;
  departmentName?: string | null;
  teamName: string | null;
}): string {
  const unit = row.departmentName && row.departmentName !== "默认部门"
    ? row.departmentName
    : row.teamName && row.teamName !== "默认团队"
      ? row.teamName
      : null;
  if (row.enterpriseName && unit) return `${row.enterpriseName} · ${unit}`;
  return row.enterpriseName || unit || "—";
}

const consumptionRows = computed(() => {
  const row = detail.value;
  if (!row) return [];
  return [
    {
      kind: "Tokens",
      input: formatNumber(row.tokenBreakdown?.input ?? uncachedPrompt(row)),
      output: formatNumber(row.tokenBreakdown?.output ?? row.completionTokens),
      cacheHit: formatNumber(row.tokenBreakdown?.cacheHit ?? row.cacheReadTokens),
      total: formatNumber(row.tokenBreakdown?.total ?? row.totalTokens),
    },
    {
      kind: "折扣",
      input: discountPartText(row.creditDiscount, "input"),
      output: discountPartText(row.creditDiscount, "output"),
      cacheHit: discountPartText(row.creditDiscount, "input"),
      total: discountKindText(row.creditDiscount),
    },
    {
      kind: "积分",
      input: formatCreditPart(row, "input"),
      output: formatCreditPart(row, "output"),
      cacheHit: formatCreditPart(row, "cacheHit"),
      total: formatCredits(row.creditBreakdown?.total ?? row.credits),
    },
  ];
});

const contextRecord = computed(() => {
  const value = detail.value?.context;
  if (!value || typeof value !== "object") return null;
  return value as {
    latencyMs?: number;
    protocol?: string;
    path?: string;
    stream?: boolean;
    headers?: Record<string, string>;
    candidate?: { credentialSuffix?: string; providerCode?: string } | null;
    retryTrace?: Array<Record<string, unknown>>;
    requestBody?: unknown;
    responseBody?: unknown;
    streamAudit?: { assembled?: unknown };
  };
});

function statusText(status: LogStatus): string {
  return (
    {
      success: "成功",
      upstream_error: "上游错误",
      client_error: "请求错误",
      cancelled: "已取消",
    } as const
  )[status];
}

function statusTagType(status: LogStatus): "success" | "danger" | "warning" | "info" {
  const tags: Record<LogStatus, "success" | "danger" | "warning" | "info"> = {
    success: "success",
    upstream_error: "danger",
    client_error: "warning",
    cancelled: "info",
  };
  return tags[status];
}

function productTypeText(value: ProductType | null | undefined): string {
  if (value === "coding_plan") return "套餐";
  if (value === "api") return "按量";
  return "—";
}

function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : numberFormatter.format(value);
}

function formatCredits(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return creditFormatter.format(value);
}

function formatDiscountPercent(multiplier: number): string {
  return `${Math.round(multiplier * 100)}%`;
}

function discountKindText(discount: CreditDiscount | null | undefined): string {
  if (!discount) return "—";
  if (discount.kind === "peak") return "高峰";
  if (discount.kind === "off_peak") return "非高峰";
  return "跨高峰";
}

function discountPercentText(discount: CreditDiscount | null | undefined): string {
  if (!discount) return "—";
  if (discount.kind === "mixed") {
    return `输入 ${formatDiscountPercent(discount.inputMultiplier)} / 输出 ${formatDiscountPercent(discount.outputMultiplier)}`;
  }
  return formatDiscountPercent(discount.inputMultiplier);
}

function discountSummary(discount: CreditDiscount | null | undefined): string {
  if (!discount) return "—";
  if (discount.kind === "mixed") {
    return `跨高峰 · 输入 ${formatDiscountPercent(discount.inputMultiplier)} · 输出 ${formatDiscountPercent(discount.outputMultiplier)}`;
  }
  return `${discountKindText(discount)} ${formatDiscountPercent(discount.inputMultiplier)}`;
}

function discountPartText(
  discount: CreditDiscount | null | undefined,
  part: "input" | "output",
): string {
  if (!discount) return "—";
  return formatDiscountPercent(part === "output" ? discount.outputMultiplier : discount.inputMultiplier);
}

function uncachedPrompt(row: Pick<LogRow, "promptTokens" | "cacheReadTokens">): number | null {
  if (row.promptTokens == null) return null;
  if (row.cacheReadTokens == null) return row.promptTokens;
  return Math.max(0, row.promptTokens - Math.min(row.promptTokens, row.cacheReadTokens));
}

function formatCreditPart(row: LogRow, key: "input" | "output" | "cacheHit"): string {
  const total = row.creditBreakdown?.total ?? row.credits;
  const value = row.creditBreakdown?.[key];
  if (value == null || !Number.isFinite(value)) return "—";
  if (total == null || !Number.isFinite(total) || total <= 0) return "—";
  return creditFormatter.format(value);
}

function employeeOptionLabel(item: EmployeeOption): string {
  return item.phone ? `${item.name} · ${item.phone}` : item.name;
}

function rememberSelectedEmployee(id: number | null) {
  if (id == null) {
    selectedEmployee.value = null;
    return;
  }
  selectedEmployee.value = employees.value.find((row) => row.id === id) ?? selectedEmployee.value;
}

async function searchEmployees(query: string) {
  employeesLoading.value = true;
  try {
    const { data } = await http.get("/api/admin/users", {
      params: { q: query.trim() || undefined, limit: 30, status: "active" },
    });
    if (!data.success) throw new Error(data.message || "搜索员工失败");
    const rows: EmployeeOption[] = Array.isArray(data.data)
      ? data.data.map((row: EmployeeOption) => ({
          id: row.id,
          name: row.name,
          phone: row.phone,
        }))
      : [];
    const current = selectedEmployee.value;
    employees.value =
      current && !rows.some((row) => row.id === current.id) ? [current, ...rows] : rows;
  } catch (e: any) {
    employees.value = selectedEmployee.value ? [selectedEmployee.value] : [];
    ElMessage.error(e.response?.data?.message || "搜索员工失败");
  } finally {
    employeesLoading.value = false;
  }
}

function onEmployeeChange(id: number | null) {
  rememberSelectedEmployee(id);
  search();
}

async function copyRequestId(requestId: string) {
  const copied = await copyText(requestId);
  if (copied) ElMessage.success("Request ID 已复制");
  else ElMessage.error("复制失败");
}

async function downloadContext(row: LogRow) {
  if (downloadingId.value) return;
  downloadingId.value = row.requestId;
  try {
    const response = await http.get(`/api/admin/logs/${encodeURIComponent(row.requestId)}/context`, {
      responseType: "blob",
      timeout: 120_000,
    });
    const blob = new Blob([response.data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${row.requestId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (e: any) {
    const status = e.response?.status;
    if (status === 404) {
      ElMessage.warning("该请求没有全文记录（部署前的旧日志没有）");
    } else {
      ElMessage.error(e.response?.data?.message || "下载失败");
    }
  } finally {
    downloadingId.value = null;
  }
}

async function openDetail(row: LogRow) {
  showDetail.value = true;
  detailLoading.value = true;
  detail.value = null;
  try {
    const { data } = await http.get(`/api/admin/logs/${encodeURIComponent(row.requestId)}`, {
      timeout: 60_000,
    });
    if (data.success) detail.value = data.data;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "详情加载失败");
    showDetail.value = false;
  } finally {
    detailLoading.value = false;
  }
}

async function loadModels() {
  modelsLoading.value = true;
  try {
    const { data } = await http.get("/api/admin/log-models");
    if (data.success) models.value = data.data.models ?? [];
  } catch {
    models.value = [];
  } finally {
    modelsLoading.value = false;
  }
}

function listQueryParams() {
  const params: Record<string, number | string> = {
    limit,
    offset: (page.value - 1) * limit,
  };
  if (filters.employeeId) params.employeeId = filters.employeeId;
  if (filters.model) params.model = filters.model;
  if (filters.status) params.status = filters.status;
  const range = timeRange.value;
  if (range?.length === 2 && range[0] && range[1]) {
    params.from = range[0];
    params.to = range[1];
  }
  return params;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/logs", {
      params: listQueryParams(),
    });
    if (data.success) {
      items.value = data.data.items;
      total.value = data.data.total;
    }
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "加载失败");
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  load();
}

function resetFilters() {
  filters.employeeId = null;
  filters.model = "";
  filters.status = null;
  timeRange.value = null;
  selectedEmployee.value = null;
  page.value = 1;
  load();
}

onMounted(() => {
  void load();
  void searchEmployees("");
  void loadModels();
});
</script>

<style scoped>
.filters {
  margin-bottom: 12px;
}
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.metric-num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.time-cell {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
:deep(td.col-time > .cell) {
  overflow: hidden;
  text-overflow: clip;
  white-space: nowrap;
}
.metric-stack {
  display: grid;
  gap: 2px;
  margin: 0;
  font-size: 12px;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
}
.metric-stack div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.metric-stack dt {
  color: #94a3b8;
  font-weight: 400;
}
.metric-stack dd {
  margin: 0;
  color: #0f172a;
  white-space: nowrap;
}
.discount-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  line-height: 1.35;
}
.discount-cell strong {
  color: #0f172a;
  font-weight: 600;
}
.discount-cell small {
  color: #94a3b8;
}
.consumption-table {
  width: 100%;
}
</style>
