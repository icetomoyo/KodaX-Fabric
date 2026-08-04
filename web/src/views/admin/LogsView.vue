<template>
  <div class="page-card logs-page">
    <h2 class="page-title">调用日志</h2>

    <el-form :inline="true" size="small" class="filters" @keyup.enter="search">
      <el-form-item>
        <el-input v-model="filters.employeeId" clearable placeholder="员工ID" style="width: 90px" />
      </el-form-item>
      <el-form-item>
        <el-input v-model="filters.model" clearable placeholder="模型" style="width: 110px" />
      </el-form-item>
      <el-form-item>
        <el-input v-model="filters.providerCode" clearable placeholder="供应商" style="width: 110px" />
      </el-form-item>
      <el-form-item>
        <el-select v-model="filters.status" clearable placeholder="状态" style="width: 120px">
          <el-option
            v-for="option in statusOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-input v-model="filters.requestId" clearable placeholder="Request ID" style="width: 180px" />
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
      size="small"
      class="logs-table"
      empty-text="暂无日志"
      v-loading="loading"
    >
      <el-table-column label="时间" width="158">
        <template #default="{ row }">
          <span class="time-text">{{ formatDateTime(row.createdAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="员工" width="128">
        <template #default="{ row }">
          <el-tooltip :content="row.employeePhone" placement="top" :show-after="400">
            <span class="employee-text">{{ employeeText(row) }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="客户端协议" width="154">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">
            {{ relayProtocolLabel(row.protocol, true) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="模型" min-width="180">
        <template #default="{ row }">
          <el-tooltip :content="modelTooltip(row)" placement="top" :show-after="400">
            <span class="model-text">{{ row.clientModel }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="上游渠道" width="138">
        <template #default="{ row }">
          <el-tooltip :content="channelTooltip(row)" placement="top" :show-after="400">
            <span class="channel-cell">
              <span>{{ providerText(row.providerCode) }}</span>
              <span v-if="row.productType === 'coding_plan'" class="type-chip">套餐</span>
              <span v-if="row.credentialSuffix" class="key-suffix">· {{ row.credentialSuffix }}</span>
            </span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="112">
        <template #default="{ row }">
          <el-tooltip
            :disabled="!hasErrorDetail(row)"
            :content="errorTooltip(row)"
            placement="top"
            :show-after="300"
          >
            <span class="result-cell">
              <span class="status-pill" :class="`is-${row.status}`">
                <i class="status-dot" />
                {{ statusText(row.status) }}
              </span>
              <span v-if="row.httpStatus" class="http-status">{{ row.httpStatus }}</span>
            </span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="Tokens" width="88" align="right" header-align="right">
        <template #default="{ row }">
          <span class="metric-text">{{ formatNumber(row.totalTokens) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="耗时" width="82" align="right" header-align="right">
        <template #default="{ row }">
          <span class="metric-text">{{ formatLatency(row.latencyMs) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="Request ID" min-width="150">
        <template #default="{ row }">
          <el-tooltip :content="row.requestId" placement="top" :show-after="300">
            <el-button class="request-id-button" link @click="copyRequestId(row.requestId)">
              {{ shortRequestId(row.requestId) }}
            </el-button>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="60" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row.requestId)">查看</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        background
        small
        layout="total, prev, pager, next"
        :total="total"
        :page-size="limit"
        v-model:current-page="page"
        @current-change="load"
      />
    </div>

    <el-drawer v-model="drawer" title="调用详情" size="560px">
      <template v-if="detail">
        <el-descriptions :column="1" border size="small" class="detail-descriptions">
          <el-descriptions-item label="Request ID">
            <span class="detail-request-id">{{ detail.meta.requestId }}</span>
            <el-button link type="primary" @click="copyRequestId(detail.meta.requestId)">
              复制
            </el-button>
          </el-descriptions-item>
          <el-descriptions-item label="时间">
            {{ formatDateTime(detail.meta.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="员工">
            {{ detail.meta.employeeName }} / {{ detail.meta.employeePhone }}
          </el-descriptions-item>
          <el-descriptions-item label="客户端协议">
            {{ relayProtocolLabel(detail.meta.protocol) }}
          </el-descriptions-item>
          <el-descriptions-item label="模型">
            {{ modelTooltip(detail.meta) }}
          </el-descriptions-item>
          <el-descriptions-item label="上游渠道">
            {{ providerText(detail.meta.providerCode) }} ·
            {{ productTypeText(detail.meta.productType) }} · Key
            {{ detail.meta.credentialSuffix || "—" }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <span class="result-cell">
              <span class="status-pill" :class="`is-${detail.meta.status}`">
                <i class="status-dot" />
                {{ statusText(detail.meta.status) }}
              </span>
              <span v-if="detail.meta.httpStatus" class="http-status">
                HTTP {{ detail.meta.httpStatus }}
              </span>
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="Tokens">
            {{ formatNumber(detail.meta.promptTokens) }} +
            {{ formatNumber(detail.meta.completionTokens) }} =
            {{ formatNumber(detail.meta.totalTokens) }}
          </el-descriptions-item>
          <el-descriptions-item label="耗时">
            {{ formatLatency(detail.meta.latencyMs) }} ·
            {{ detail.meta.isStream ? "流式" : "非流式" }} · 重试
            {{ detail.meta.retryCount ?? 0 }} 次
          </el-descriptions-item>
          <el-descriptions-item
            v-if="detail.meta.errorCode || detail.meta.errorMessage"
            label="错误"
          >
            {{ detail.meta.errorCode }} {{ detail.meta.errorMessage }}
          </el-descriptions-item>
        </el-descriptions>

        <div style="margin-top: 16px">
          <el-button
            v-if="detail.canReadBody && !detail.body"
            type="primary"
            @click="loadBody"
            :loading="loadingBody"
          >
            加载全文（记入审计）
          </el-button>
        </div>

        <template v-if="detail.body">
          <h4>Request Body</h4>
          <pre class="code">{{ pretty(detail.body.requestBody) }}</pre>
          <h4>Response Body</h4>
          <pre class="code">{{ pretty(detail.body.responseBody) }}</pre>
        </template>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";
import { relayProtocolLabel, type RelayProtocol } from "@/views/relay-protocol";

type LogStatus = "success" | "upstream_error" | "client_error" | "cancelled";
type ProductType = "api" | "coding_plan";

interface LogRow {
  id: number;
  requestId: string;
  employeeId: number;
  employeeName: string;
  employeePhone: string;
  protocol: RelayProtocol;
  clientModel: string;
  upstreamModel: string | null;
  providerCode: string | null;
  productType: ProductType | null;
  credentialSuffix: string | null;
  isStream: boolean;
  status: LogStatus;
  httpStatus: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  retryCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface LogDetail {
  meta: LogRow;
  body: { requestBody: unknown; responseBody: unknown } | null;
  canReadBody: boolean;
}

const statusOptions: Array<{ label: string; value: LogStatus }> = [
  { label: "成功", value: "success" },
  { label: "上游错误", value: "upstream_error" },
  { label: "请求错误", value: "client_error" },
  { label: "已取消", value: "cancelled" },
];

const providerNames: Record<string, string> = {
  glm: "GLM",
  kimi: "Kimi",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
};

const numberFormatter = new Intl.NumberFormat("zh-CN");

const filters = reactive({
  employeeId: "",
  model: "",
  providerCode: "",
  status: "",
  requestId: "",
});
const items = ref<LogRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 10;
const loading = ref(false);
const drawer = ref(false);
const detail = ref<LogDetail | null>(null);
const currentRequestId = ref("");
const loadingBody = ref(false);

const hasFilters = computed(() => Object.values(filters).some(Boolean));

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

function providerText(code: string | null): string {
  if (!code) return "—";
  return providerNames[code.toLowerCase()] ?? code;
}

function productTypeText(type: ProductType | null): string {
  if (!type) return "—";
  return type === "coding_plan" ? "Coding Plan" : "API";
}

function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : numberFormatter.format(value);
}

function formatLatency(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value < 1000) return `${value} ms`;
  const seconds = value / 1000;
  return `${Number(seconds.toFixed(seconds < 10 ? 2 : 1))} s`;
}

function employeeText(row: LogRow): string {
  const phoneSuffix = row.employeePhone.slice(-4);
  return phoneSuffix ? `${row.employeeName} · ${phoneSuffix}` : row.employeeName;
}

function modelTooltip(row: LogRow): string {
  if (row.upstreamModel && row.upstreamModel !== row.clientModel) {
    return `${row.clientModel} → ${row.upstreamModel}`;
  }
  return row.clientModel || "—";
}

function channelTooltip(row: LogRow): string {
  const parts = [providerText(row.providerCode), productTypeText(row.productType)];
  if (row.credentialSuffix) parts.push(`Key ····${row.credentialSuffix}`);
  return parts.join(" · ");
}

function hasErrorDetail(row: LogRow): boolean {
  return Boolean(row.errorCode || row.errorMessage);
}

function errorTooltip(row: LogRow): string {
  return [row.errorCode, row.errorMessage].filter(Boolean).join(" · ");
}

function shortRequestId(requestId: string): string {
  return requestId.length <= 18 ? requestId : `${requestId.slice(0, 6)}…${requestId.slice(-8)}`;
}

async function copyRequestId(requestId: string) {
  try {
    await navigator.clipboard.writeText(requestId);
    ElMessage.success("Request ID 已复制");
  } catch {
    ElMessage.error("复制失败");
  }
}

function pretty(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/logs", {
      params: {
        limit,
        offset: (page.value - 1) * limit,
        employeeId: filters.employeeId || undefined,
        model: filters.model || undefined,
        providerCode: filters.providerCode || undefined,
        status: filters.status || undefined,
        requestId: filters.requestId || undefined,
      },
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
  Object.assign(filters, {
    employeeId: "",
    model: "",
    providerCode: "",
    status: "",
    requestId: "",
  });
  page.value = 1;
  load();
}

async function openDetail(requestId: string) {
  currentRequestId.value = requestId;
  const { data } = await http.get(`/api/admin/logs/${requestId}`, {
    params: { includeBody: "false" },
  });
  if (data.success) {
    detail.value = data.data;
    drawer.value = true;
  }
}

async function loadBody() {
  loadingBody.value = true;
  try {
    const { data } = await http.get(`/api/admin/logs/${currentRequestId.value}`, {
      params: { includeBody: "true" },
    });
    if (data.success) detail.value = data.data;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "无权或加载失败");
  } finally {
    loadingBody.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.logs-page {
  padding: 16px 20px 14px;
  border: 1px solid #e9edf3;
  overflow: hidden;
}
.logs-page .page-title {
  margin-bottom: 12px;
}
.filters {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.filters :deep(.el-form-item) {
  flex: none;
  margin-right: 0;
  margin-bottom: 0;
}
.filters :deep(.el-input__wrapper),
.filters :deep(.el-select__wrapper) {
  border-radius: 6px;
}
.logs-table {
  --el-table-border-color: #edf0f5;
  --el-table-header-bg-color: #f8fafc;
  --el-table-row-hover-bg-color: #f3f7fc;
  color: #344054;
}
.logs-table :deep(.cell) {
  white-space: nowrap;
}
.logs-table :deep(th.el-table__cell) {
  padding: 7px 0;
  color: #667085;
  font-size: 12px;
  font-weight: 600;
}
.logs-table :deep(td.el-table__cell) {
  padding: 6px 0;
}
.logs-table :deep(.el-table__row--striped td.el-table__cell) {
  background: #fafbfc;
}
.logs-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}
.time-text,
.metric-text,
.http-status,
.request-id-button,
.detail-request-id {
  font-variant-numeric: tabular-nums;
}
.time-text {
  color: #475467;
}
.employee-text {
  display: block;
  overflow: hidden;
  color: #344054;
  font-weight: 500;
  text-overflow: ellipsis;
}
.model-text {
  display: block;
  overflow: hidden;
  color: #344054;
  text-overflow: ellipsis;
}
.channel-cell,
.result-cell {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}
.channel-cell {
  gap: 5px;
}
.key-suffix {
  color: #98a2b3;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}
.type-chip {
  padding: 0 5px;
  border-radius: 4px;
  background: #eef4ff;
  color: #3538cd;
  font-size: 11px;
  line-height: 18px;
}
.result-cell {
  gap: 6px;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.status-pill.is-success {
  background: #ecfdf3;
  color: #027a48;
}
.status-pill.is-upstream_error {
  background: #fef3f2;
  color: #b42318;
}
.status-pill.is-client_error {
  background: #fffaeb;
  color: #b54708;
}
.status-pill.is-cancelled {
  background: #f2f4f7;
  color: #475467;
}
.http-status {
  color: #98a2b3;
  font-size: 11px;
}
.metric-text {
  color: #344054;
}
.request-id-button {
  max-width: 100%;
  color: #667085;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}
.request-id-button:hover {
  color: var(--el-color-primary);
}
.request-id-button :deep(span) {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pager {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
.detail-request-id {
  margin-right: 8px;
  overflow-wrap: anywhere;
  color: #475467;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
.detail-descriptions :deep(.el-descriptions__label) {
  width: 92px;
  color: #667085;
}
.code {
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px;
  border-radius: 8px;
  overflow: auto;
  max-height: 320px;
  font-size: 12px;
}
</style>
