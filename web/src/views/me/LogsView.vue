<template>
  <div class="page-card logs-page">
    <h2 class="page-title">我的调用记录</h2>

    <el-form :inline="true" size="small" class="filters" @keyup.enter="search">
      <el-form-item>
        <div class="metric-filter">
          <span class="metric-filter-label">耗时</span>
          <el-select v-model="filters.latencyOp" style="width: 76px">
            <el-option label="大于" value="gt" />
            <el-option label="小于" value="lt" />
          </el-select>
          <el-input v-model="filters.latencyMs" clearable placeholder="ms" style="width: 92px" />
        </div>
      </el-form-item>
      <el-form-item>
        <div class="metric-filter">
          <span class="metric-filter-label">Tokens</span>
          <el-select v-model="filters.tokensOp" style="width: 76px">
            <el-option label="大于" value="gt" />
            <el-option label="小于" value="lt" />
          </el-select>
          <el-input v-model="filters.tokens" clearable placeholder="数值" style="width: 92px" />
        </div>
      </el-form-item>
      <el-form-item>
        <div class="metric-filter">
          <span class="metric-filter-label">TTFT</span>
          <el-select v-model="filters.ttftOp" style="width: 76px">
            <el-option label="大于" value="gt" />
            <el-option label="小于" value="lt" />
          </el-select>
          <el-input v-model="filters.ttftMs" clearable placeholder="ms" style="width: 92px" />
        </div>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
      </el-form-item>
      <el-form-item v-if="hasFilters">
        <el-button @click="resetFilters">重置</el-button>
      </el-form-item>
    </el-form>

    <el-table
      v-loading="loading"
      :data="items"
      stripe
      size="small"
      class="logs-table"
      empty-text="暂无记录"
    >
      <el-table-column label="Request ID" min-width="300">
        <template #default="{ row }">
          <el-button class="request-id-button" link @click="copyRequestId(row.requestId)">
            {{ row.requestId }}
          </el-button>
        </template>
      </el-table-column>
      <el-table-column label="耗时" width="68" align="right" header-align="right">
        <template #default="{ row }">
          <span class="metric-text">{{ formatLatency(row.latencyMs) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="Tokens" width="76" align="right" header-align="right">
        <template #default="{ row }">
          <span class="metric-text">{{ formatNumber(row.totalTokens) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="TTFT" width="64" align="right" header-align="right">
        <template #default="{ row }">
          <span class="metric-text">{{ formatLatency(row.ttftMs) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="缓存命中" width="86" align="right" header-align="right">
        <template #default="{ row }">
          <el-tooltip
            :disabled="row.cacheReadTokens == null"
            :content="cacheHitText(row.cacheReadTokens, row.promptTokens)"
            placement="top"
            :show-after="300"
          >
            <span class="metric-text">{{ formatNumber(row.cacheReadTokens) }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="渠道" width="148">
        <template #default="{ row }">
          <el-tooltip :content="channelTooltip(row)" placement="top" :show-after="400">
            <span class="channel-cell">
              <span class="channel-name">{{ providerText(row.providerCode) }}</span>
              <span v-if="row.productType === 'coding_plan'" class="type-chip">套餐</span>
              <span v-if="row.credentialSuffix" class="key-suffix">{{ row.credentialSuffix }}</span>
            </span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="模型" width="120">
        <template #default="{ row }">
          <el-tooltip :content="modelTooltip(row)" placement="top" :show-after="400">
            <span class="model-text">{{ row.clientModel }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="协议" width="136">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">
            {{ relayProtocolLabel(row.protocol, true) }}
          </el-tag>
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
      <el-table-column label="时间" width="156">
        <template #default="{ row }">
          <span class="time-text">{{ formatDateTime(row.createdAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="60">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row.requestId)">查看</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        background
        size="small"
        layout="total, prev, pager, next"
        :total="total"
        :page-size="limit"
        @current-change="load"
      />
    </div>

    <el-drawer v-model="drawer" title="调用详情" size="min(720px, 96vw)">
      <div v-loading="detailLoading" class="log-detail-body">
        <template v-if="detail">
          <div class="detail-heading">
            <span class="detail-request-id">{{ detail.meta.requestId }}</span>
            <el-button link type="primary" @click="copyRequestId(detail.meta.requestId)">复制</el-button>
          </div>
          <el-descriptions :column="1" border size="small" class="detail-descriptions">
            <el-descriptions-item label="时间">{{ formatDateTime(detail.meta.createdAt) }}</el-descriptions-item>
            <el-descriptions-item label="协议">{{ relayProtocolLabel(detail.meta.protocol) }}</el-descriptions-item>
            <el-descriptions-item label="模型">{{ modelTooltip(detail.meta) }}</el-descriptions-item>
            <el-descriptions-item label="渠道">
              {{ providerText(detail.meta.providerCode) }} · {{ productTypeText(detail.meta.productType) }} · Key {{ detail.meta.credentialSuffix || "—" }}
            </el-descriptions-item>
            <el-descriptions-item label="状态">
              <span class="result-cell">
                <span class="status-pill" :class="`is-${detail.meta.status}`">
                  <i class="status-dot" />{{ statusText(detail.meta.status) }}
                </span>
                <span v-if="detail.meta.httpStatus" class="http-status">HTTP {{ detail.meta.httpStatus }}</span>
              </span>
            </el-descriptions-item>
            <el-descriptions-item label="Tokens">
              {{ formatNumber(detail.meta.promptTokens) }} + {{ formatNumber(detail.meta.completionTokens) }} = {{ formatNumber(detail.meta.totalTokens) }}
            </el-descriptions-item>
            <el-descriptions-item label="缓存命中">
              {{ cacheHitText(cacheReadTokensOf(detail.meta.usageRaw), detail.meta.promptTokens) }}
            </el-descriptions-item>
            <el-descriptions-item label="耗时">
              {{ formatLatency(detail.meta.latencyMs) }} · {{ detail.meta.isStream ? "流式" : "非流式" }}
            </el-descriptions-item>
            <el-descriptions-item label="TTFT">{{ formatLatency(detail.meta.ttftMs) }}</el-descriptions-item>
            <el-descriptions-item v-if="detail.meta.errorCode || detail.meta.errorMessage" label="错误">
              {{ detail.meta.errorCode }} {{ detail.meta.errorMessage }}
            </el-descriptions-item>
          </el-descriptions>
          <template v-if="detail.body">
            <h3 class="detail-section-title">请求</h3>
            <StructuredJson :value="detail.body.requestBody" empty-text="无请求正文" />
            <h3 class="detail-section-title">响应</h3>
            <StructuredJson :value="detail.body.responseBody" empty-text="无响应正文" />
          </template>
          <p v-else class="muted">请求/响应正文已按保留策略清理，列表里的用量和耗时仍在。</p>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import StructuredJson from "@/components/StructuredJson.vue";
import { copyText } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/date-time";
import { relayProtocolLabel, type RelayProtocol } from "@/views/relay-protocol";

type LogStatus = "success" | "upstream_error" | "client_error" | "cancelled";
type ProductType = "api" | "coding_plan";
type CompareOp = "gt" | "lt";

interface MeLogRow {
  id: number;
  requestId: string;
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
  ttftMs: number | null;
  cacheReadTokens: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface MeLogDetail {
  meta: MeLogRow & { usageRaw: Record<string, unknown> | null };
  body: { requestBody: unknown; responseBody: unknown } | null;
}

const providerNames: Record<string, string> = {
  glm: "智谱/GLM",
  kimi: "月之暗面/Kimi",
  deepseek: "深度求索/DeepSeek",
  minimax: "MiniMax",
};

const numberFormatter = new Intl.NumberFormat("zh-CN");
const filters = reactive({
  tokensOp: "gt" as CompareOp,
  tokens: "",
  latencyOp: "gt" as CompareOp,
  latencyMs: "",
  ttftOp: "gt" as CompareOp,
  ttftMs: "",
});
const items = ref<MeLogRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 10;
const loading = ref(false);
const drawer = ref(false);
const detail = ref<MeLogDetail | null>(null);
const detailLoading = ref(false);
let detailSequence = 0;

const hasFilters = computed(() => Boolean(
  filters.tokens.trim() || filters.latencyMs.trim() || filters.ttftMs.trim(),
));

function parseFilterNumber(raw: string): number | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function statusText(status: LogStatus): string {
  return {
    success: "成功",
    upstream_error: "上游错误",
    client_error: "请求错误",
    cancelled: "已取消",
  }[status];
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

function asTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cacheReadTokensOf(usageRaw: Record<string, unknown> | null): number | null {
  if (!usageRaw) return null;
  const anthropic = asTokenCount(usageRaw.cache_read_input_tokens);
  if (anthropic != null) return anthropic;
  const details = usageRaw.prompt_tokens_details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    return asTokenCount((details as Record<string, unknown>).cached_tokens);
  }
  return null;
}

function cacheHitText(cacheRead: number | null, promptTokens: number | null): string {
  if (cacheRead == null) return "—";
  if (!promptTokens || cacheRead <= 0) return formatNumber(cacheRead);
  const percent = Math.min(100, (cacheRead / promptTokens) * 100);
  return `${formatNumber(cacheRead)} (${percent.toFixed(1)}%)`;
}

function modelTooltip(row: Pick<MeLogRow, "clientModel" | "upstreamModel">): string {
  if (row.upstreamModel && row.upstreamModel !== row.clientModel) {
    return `${row.clientModel} → ${row.upstreamModel}`;
  }
  return row.clientModel || "—";
}

function channelTooltip(row: MeLogRow): string {
  const parts = [providerText(row.providerCode), productTypeText(row.productType)];
  if (row.credentialSuffix) parts.push(`Key ····${row.credentialSuffix}`);
  return parts.join(" · ");
}

function hasErrorDetail(row: MeLogRow): boolean {
  return Boolean(row.errorCode || row.errorMessage);
}

function errorTooltip(row: MeLogRow): string {
  return [row.errorCode, row.errorMessage].filter(Boolean).join(" · ");
}

async function copyRequestId(requestId: string) {
  const copied = await copyText(requestId);
  if (copied) ElMessage.success("Request ID 已复制");
  else ElMessage.error("复制失败");
}

async function load() {
  const tokens = parseFilterNumber(filters.tokens);
  const latencyMs = parseFilterNumber(filters.latencyMs);
  const ttftMs = parseFilterNumber(filters.ttftMs);
  if (
    (filters.tokens.trim() && tokens == null)
    || (filters.latencyMs.trim() && latencyMs == null)
    || (filters.ttftMs.trim() && ttftMs == null)
  ) {
    ElMessage.warning("Tokens / 耗时 / TTFT 请输入非负整数");
    return;
  }

  loading.value = true;
  try {
    const { data } = await http.get("/api/me/logs", {
      params: {
        limit,
        offset: (page.value - 1) * limit,
        ...(tokens != null ? { tokensOp: filters.tokensOp, tokens } : {}),
        ...(latencyMs != null ? { latencyOp: filters.latencyOp, latencyMs } : {}),
        ...(ttftMs != null ? { ttftOp: filters.ttftOp, ttftMs } : {}),
      },
    });
    if (data.success) {
      items.value = data.data.items;
      total.value = data.data.total;
    }
  } catch (error) {
    ElMessage.error(
      (error as { response?: { data?: { message?: string } } }).response?.data?.message
        ?? "调用记录加载失败",
    );
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  load();
}

function resetFilters() {
  filters.tokensOp = "gt";
  filters.tokens = "";
  filters.latencyOp = "gt";
  filters.latencyMs = "";
  filters.ttftOp = "gt";
  filters.ttftMs = "";
  page.value = 1;
  load();
}

async function openDetail(requestId: string) {
  const sequence = ++detailSequence;
  detail.value = null;
  drawer.value = true;
  detailLoading.value = true;
  try {
    const { data } = await http.get(`/api/me/logs/${requestId}`);
    if (sequence !== detailSequence) return;
    if (data.success) detail.value = data.data;
  } catch (error) {
    if (sequence === detailSequence) {
      ElMessage.error(
        (error as { response?: { data?: { message?: string } } }).response?.data?.message
          ?? "调用详情加载失败",
      );
    }
  } finally {
    if (sequence === detailSequence) detailLoading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.logs-page {
  padding: 16px 20px 14px;
  border: 1px solid #e9edf3;
  overflow-x: auto;
}
.logs-page .page-title {
  margin-bottom: 12px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.metric-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.metric-filter-label {
  color: #667085;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
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
  width: 100%;
  color: #344054;
}
.logs-table :deep(.cell) {
  padding: 0 8px;
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
  max-width: 100%;
}
.channel-cell {
  gap: 4px;
}
.channel-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.key-suffix {
  flex: none;
  color: #98a2b3;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}
.type-chip {
  flex: none;
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
  height: auto;
  padding: 0;
  color: #667085;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}
.request-id-button:hover {
  color: var(--el-color-primary);
}
.pager {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
.detail-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  margin-bottom: 12px;
}
.detail-request-id {
  overflow-wrap: anywhere;
  color: #475467;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
.detail-descriptions :deep(.el-descriptions__label) {
  width: 92px;
  color: #667085;
}
.log-detail-body {
  min-height: 220px;
}
.detail-section-title {
  margin: 18px 0 8px;
  color: #344054;
  font-size: 13px;
}
</style>
