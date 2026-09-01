<template>
  <div class="page-card logs-page">
    <h2 class="page-title">调用日志</h2>

    <el-form :inline="true" size="small" class="filters" @keyup.enter="search">
      <el-form-item>
        <el-select
          v-model="filters.enterpriseId"
          clearable
          filterable
          :loading="enterprisesLoading"
          placeholder="全部企业"
          style="width: 180px"
          @change="onEnterpriseChange"
        >
          <el-option
            v-for="item in enterprises"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-select
          v-model="filters.teamId"
          clearable
          filterable
          :disabled="!filters.enterpriseId"
          :loading="teamsLoading"
          placeholder="全部团队"
          style="width: 180px"
        >
          <el-option
            v-for="item in teams"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <div class="metric-filter">
          <span class="metric-filter-label">Tokens</span>
          <el-select v-model="filters.tokensOp" style="width: 76px">
            <el-option label="大于" value="gt" />
            <el-option label="小于" value="lt" />
          </el-select>
          <el-input
            v-model="filters.tokens"
            clearable
            placeholder="数值"
            style="width: 92px"
          />
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
      :data="items"
      stripe
      size="small"
      class="logs-table"
      empty-text="暂无日志"
      v-loading="loading"
    >
      <el-table-column label="Request ID" min-width="300">
        <template #default="{ row }">
          <el-button class="request-id-button" link @click="copyRequestId(row.requestId)">
            {{ row.requestId }}
          </el-button>
        </template>
      </el-table-column>
      <el-table-column label="Tokens" width="88" align="right" header-align="right">
        <template #default="{ row }">
          <el-tooltip :content="tokenTooltip(row)" placement="top" :show-after="300">
            <span class="metric-text">{{ formatNumber(row.totalTokens) }}</span>
          </el-tooltip>
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
          <span class="channel-cell">
            <span class="channel-name">{{ providerText(row.providerCode) }}</span>
            <span v-if="row.productType === 'coding_plan'" class="type-chip">套餐</span>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="模型" width="140">
        <template #default="{ row }">
          <span class="model-text">{{ row.clientModel }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="112">
        <template #default="{ row }">
          <span class="result-cell">
            <span class="status-pill" :class="`is-${row.status}`">
              <i class="status-dot" />
              {{ statusText(row.status) }}
            </span>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="企业 / 团队" min-width="160">
        <template #default="{ row }">
          <span class="employee-text">
            {{ row.enterpriseName || "—" }}
            <template v-if="row.teamName"> · {{ row.teamName }}</template>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="156">
        <template #default="{ row }">
          <span class="time-text">{{ formatDateTime(row.createdAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="" width="72" align="right">
        <template #default="{ row }">
          <el-button
            class="download-button"
            link
            :loading="downloadingId === row.requestId"
            @click="downloadContext(row)"
          >
            下载
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        background
        size="small"
        layout="total, prev, pager, next"
        :total="total"
        :page-size="limit"
        v-model:current-page="page"
        @current-change="load"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { copyText } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/date-time";

type LogStatus = "success" | "upstream_error" | "client_error" | "cancelled";
type ProductType = "api" | "coding_plan";

interface LogRow {
  id: number;
  requestId: string;
  enterpriseName: string | null;
  teamName: string | null;
  clientModel: string;
  providerCode: string | null;
  productType: ProductType | null;
  status: LogStatus;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  createdAt: string;
}

interface NamedOption {
  id: number;
  name: string;
}

const providerNames: Record<string, string> = {
  glm: "智谱/GLM",
  kimi: "月之暗面/Kimi",
  deepseek: "深度求索/DeepSeek",
  minimax: "MiniMax",
};

const numberFormatter = new Intl.NumberFormat("zh-CN");
type CompareOp = "gt" | "lt";

const filters = reactive({
  enterpriseId: undefined as number | undefined,
  teamId: undefined as number | undefined,
  tokensOp: "gt" as CompareOp,
  tokens: "",
});
const enterprises = ref<NamedOption[]>([]);
const enterprisesLoading = ref(false);
const teams = ref<NamedOption[]>([]);
const teamsLoading = ref(false);
const items = ref<LogRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 10;
const loading = ref(false);
const downloadingId = ref<string | null>(null);

const hasFilters = computed(() => Boolean(
  filters.enterpriseId
  || filters.teamId
  || filters.tokens.trim(),
));

function parseFilterNumber(raw: string): number | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

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

function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : numberFormatter.format(value);
}

function tokenTooltip(row: LogRow): string {
  return `${formatNumber(row.promptTokens)} + ${formatNumber(row.completionTokens)} = ${formatNumber(row.totalTokens)}`;
}

function cacheHitText(cacheRead: number | null, promptTokens: number | null): string {
  if (cacheRead == null) return "—";
  if (!promptTokens || cacheRead <= 0) return formatNumber(cacheRead);
  const percent = Math.min(100, (cacheRead / promptTokens) * 100);
  return `${formatNumber(cacheRead)} (${percent.toFixed(1)}%)`;
}

async function onEnterpriseChange() {
  filters.teamId = undefined;
  teams.value = [];
  if (!filters.enterpriseId) return;
  teamsLoading.value = true;
  try {
    const { data } = await http.get(`/api/admin/enterprises/${filters.enterpriseId}/teams`);
    if (data.success) teams.value = data.data;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "团队列表加载失败");
  } finally {
    teamsLoading.value = false;
  }
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

async function load() {
  const tokens = parseFilterNumber(filters.tokens);
  if (filters.tokens.trim() && tokens == null) {
    ElMessage.warning("Tokens 请输入非负整数");
    return;
  }

  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/logs", {
      params: {
        limit,
        offset: (page.value - 1) * limit,
        enterpriseId: filters.enterpriseId,
        teamId: filters.teamId,
        ...(tokens != null ? { tokensOp: filters.tokensOp, tokens } : {}),
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

async function loadEnterprises() {
  enterprisesLoading.value = true;
  try {
    const { data } = await http.get("/api/admin/enterprises");
    if (data.success) {
      enterprises.value = data.data.map((row: { id: number; name: string }) => ({
        id: row.id,
        name: row.name,
      }));
    }
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "企业列表加载失败");
  } finally {
    enterprisesLoading.value = false;
  }
}

function search() {
  page.value = 1;
  load();
}

function resetFilters() {
  filters.enterpriseId = undefined;
  filters.teamId = undefined;
  teams.value = [];
  filters.tokensOp = "gt";
  filters.tokens = "";
  page.value = 1;
  load();
}

onMounted(() => {
  void load();
  void loadEnterprises();
});
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
.request-id-button {
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
  max-width: 100%;
}
.channel-cell {
  gap: 4px;
}
.channel-name {
  overflow: hidden;
  text-overflow: ellipsis;
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
.download-button {
  height: auto;
  padding: 0;
  font-size: 12px;
}
.pager {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
</style>
