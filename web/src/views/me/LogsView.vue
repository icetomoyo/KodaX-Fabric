<template>
  <div class="logs-page">
    <section class="page-card">
      <div class="page-head">
        <div>
          <h2 class="page-title">我的调用</h2>
          <p class="page-subtitle">查看自己的调用记录、耗时与用量</p>
        </div>
      </div>

      <el-form inline class="filters" @keyup.enter="search">
        <el-form-item label="耗时">
          <div class="filter-pair">
            <el-select v-model="filters.latencyOp" style="width: 96px">
              <el-option label="大于" value="gt" />
              <el-option label="小于" value="lt" />
            </el-select>
            <el-input v-model="filters.latencyMs" clearable placeholder="ms" style="width: 120px" />
          </div>
        </el-form-item>
        <el-form-item label="Tokens">
          <div class="filter-pair">
            <el-select v-model="filters.tokensOp" style="width: 96px">
              <el-option label="大于" value="gt" />
              <el-option label="小于" value="lt" />
            </el-select>
            <el-input v-model="filters.tokens" clearable placeholder="数值" style="width: 120px" />
          </div>
        </el-form-item>
        <el-form-item label="TTFT">
          <div class="filter-pair">
            <el-select v-model="filters.ttftOp" style="width: 96px">
              <el-option label="大于" value="gt" />
              <el-option label="小于" value="lt" />
            </el-select>
            <el-input v-model="filters.ttftMs" clearable placeholder="ms" style="width: 120px" />
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button v-if="hasFilters" @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="items" stripe empty-text="暂无记录">
        <el-table-column label="Request ID" min-width="240">
          <template #default="{ row }">
            <el-button link type="primary" @click="copyRequestId(row.requestId)">
              <code class="request-id">{{ row.requestId }}</code>
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="100">
          <template #default="{ row }">{{ formatLatency(row.latencyMs) }}</template>
        </el-table-column>
        <el-table-column label="Tokens" width="110">
          <template #default="{ row }">{{ formatNumber(row.totalTokens) }}</template>
        </el-table-column>
        <el-table-column label="TTFT" width="100">
          <template #default="{ row }">{{ formatLatency(row.ttftMs) }}</template>
        </el-table-column>
        <el-table-column label="缓存命中" width="120">
          <template #default="{ row }">
            <el-tooltip
              :disabled="row.cacheReadTokens == null"
              :content="cacheHitText(row.cacheReadTokens, row.promptTokens)"
              placement="top"
            >
              <span>{{ formatNumber(row.cacheReadTokens) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="渠道" min-width="160">
          <template #default="{ row }">
            <el-tooltip :content="channelTooltip(row)" placement="top">
              <span>
                {{ providerText(row.providerCode) }}
                <el-tag v-if="row.productType === 'coding_plan'" size="small" effect="plain">套餐</el-tag>
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="模型" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.clientModel }}</template>
        </el-table-column>
        <el-table-column label="协议" width="150">
          <template #default="{ row }">
            {{ relayProtocolLabel(row.protocol, true) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tooltip :disabled="!hasErrorDetail(row)" :content="errorTooltip(row)" placement="top">
              <el-tag :type="statusTagType(row.status)" size="small">
                {{ statusText(row.status) }}
              </el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
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
    </section>

    <el-drawer v-model="drawer" title="调用详情" size="min(720px, 96vw)">
      <div v-loading="detailLoading" class="detail-body">
        <template v-if="detail">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="Request ID">
              <code class="request-id">{{ detail.meta.requestId }}</code>
              <el-button link type="primary" @click="copyRequestId(detail.meta.requestId)">复制</el-button>
            </el-descriptions-item>
            <el-descriptions-item label="时间">{{ formatDateTime(detail.meta.createdAt) }}</el-descriptions-item>
            <el-descriptions-item label="协议">{{ relayProtocolLabel(detail.meta.protocol) }}</el-descriptions-item>
            <el-descriptions-item label="模型">{{ modelTooltip(detail.meta) }}</el-descriptions-item>
            <el-descriptions-item label="渠道">
              {{ providerText(detail.meta.providerCode) }} · {{ productTypeText(detail.meta.productType) }} · Key {{ detail.meta.credentialSuffix || "—" }}
            </el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="statusTagType(detail.meta.status)" size="small">
                {{ statusText(detail.meta.status) }}
              </el-tag>
              <span v-if="detail.meta.httpStatus" class="muted"> HTTP {{ detail.meta.httpStatus }}</span>
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
            <div class="content-section">
              <div class="content-label">请求</div>
              <StructuredJson :value="detail.body.requestBody" empty-text="无请求正文" />
            </div>
            <div class="content-section">
              <div class="content-label">响应</div>
              <StructuredJson :value="detail.body.responseBody" empty-text="无响应正文" />
            </div>
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

function statusTagType(status: LogStatus): "success" | "danger" | "warning" | "info" {
  const tags: Record<LogStatus, "success" | "danger" | "warning" | "info"> = {
    success: "success",
    upstream_error: "danger",
    client_error: "warning",
    cancelled: "info",
  };
  return tags[status];
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
  min-width: 0;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
  color: #0f172a;
}

.page-subtitle {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 13px;
}

.filters {
  margin-bottom: 8px;
}

.filter-pair {
  display: flex;
  gap: 8px;
}

.request-id {
  color: #475569;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.detail-body {
  min-height: 160px;
}

.content-section {
  margin-top: 18px;
}

.content-label {
  margin-bottom: 8px;
  color: #475569;
  font-size: 13px;
  font-weight: 600;
}

@media (max-width: 640px) {
  .page-head {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
