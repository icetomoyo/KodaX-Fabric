<template>
  <div class="logs-page">
    <section class="page-card">
      <div class="page-head">
        <div>
          <h2 class="page-title">我的调用</h2>
          <p class="page-subtitle">查看自己的调用用量</p>
        </div>
      </div>

      <el-form inline class="filters" @keyup.enter="search">
        <el-form-item>
          <el-select
            v-model="filters.productLineId"
            clearable
            filterable
            placeholder="全部渠道"
            style="width: 200px"
            @change="onChannelChange"
          >
            <el-option
              v-for="channel in channels"
              :key="channel.id"
              :label="channelLabel(channel)"
              :value="channel.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-select
            v-model="filters.model"
            clearable
            filterable
            placeholder="全部模型"
            style="width: 200px"
          >
            <el-option v-for="model in modelOptions" :key="model" :label="model" :value="model" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-select v-model="filters.status" clearable placeholder="全部状态" style="width: 140px">
            <el-option label="成功" value="success" />
            <el-option label="上游错误" value="upstream_error" />
            <el-option label="请求错误" value="client_error" />
            <el-option label="已取消" value="cancelled" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-date-picker
            v-model="filters.range"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            :disabled-date="disableFutureDate"
            style="width: 260px"
          />
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
        <el-table-column label="渠道" min-width="160">
          <template #default="{ row }">
            <span>
              {{ providerText(row.providerCode) }}
              <el-tag v-if="row.productType === 'coding_plan'" size="small" effect="plain">套餐</el-tag>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="模型" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.clientModel }}</template>
        </el-table-column>
        <el-table-column label="Tokens" width="110">
          <template #default="{ row }">
            <el-tooltip :content="tokenTooltip(row)" placement="top">
              <span>{{ formatNumber(row.totalTokens) }}</span>
            </el-tooltip>
          </template>
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
        <el-table-column label="花销" width="110" align="right">
          <template #default="{ row }">{{ formatYuan(row.costYuan) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">
              {{ statusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { copyText } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/date-time";
import { formatYuan } from "@/lib/tokens";

type LogStatus = "success" | "upstream_error" | "client_error" | "cancelled";
type ProductType = "api" | "coding_plan";

interface MeLogRow {
  id: number;
  requestId: string;
  clientModel: string;
  providerCode: string | null;
  productType: ProductType | null;
  status: LogStatus;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  createdAt: string;
  costYuan: string;
}

type CatalogChannel = {
  id: number;
  name: string;
  providerName: string;
  models: Array<{ model: string }>;
};

const providerNames: Record<string, string> = {
  glm: "智谱/GLM",
  kimi: "月之暗面/Kimi",
  deepseek: "深度求索/DeepSeek",
  minimax: "MiniMax",
};

const numberFormatter = new Intl.NumberFormat("zh-CN");
const filters = reactive({
  productLineId: undefined as number | undefined,
  model: "" as string,
  status: "" as "" | LogStatus,
  range: null as [string, string] | null,
});
const channels = ref<CatalogChannel[]>([]);
const items = ref<MeLogRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 10;
const loading = ref(false);

const hasFilters = computed(() => Boolean(
  filters.productLineId
  || filters.model
  || filters.status
  || filters.range,
));

const modelOptions = computed(() => {
  const source = filters.productLineId
    ? channels.value.filter((channel) => channel.id === filters.productLineId)
    : channels.value;
  return [...new Set(source.flatMap((channel) => channel.models.map((item) => item.model)))];
});

function channelLabel(channel: Pick<CatalogChannel, "providerName" | "name">): string {
  const company = channel.providerName.trim();
  const model = channel.name.trim();
  if (!company) return model;
  if (!model) return company;
  if (company === model || model.startsWith(`${company}/`)) return model;
  return `${company}/${model}`;
}

function onChannelChange() {
  if (filters.model && !modelOptions.value.includes(filters.model)) {
    filters.model = "";
  }
}

function disableFutureDate(date: Date) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return date.getTime() > today.getTime();
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

function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : numberFormatter.format(value);
}

function tokenTooltip(row: MeLogRow): string {
  return `${formatNumber(row.promptTokens)} + ${formatNumber(row.completionTokens)} = ${formatNumber(row.totalTokens)}`;
}

function cacheHitText(cacheRead: number | null, promptTokens: number | null): string {
  if (cacheRead == null) return "—";
  if (!promptTokens || cacheRead <= 0) return formatNumber(cacheRead);
  const percent = Math.min(100, (cacheRead / promptTokens) * 100);
  return `${formatNumber(cacheRead)} (${percent.toFixed(1)}%)`;
}

async function copyRequestId(requestId: string) {
  const copied = await copyText(requestId);
  if (copied) ElMessage.success("Request ID 已复制");
  else ElMessage.error("复制失败");
}

async function loadChannels() {
  try {
    const { data } = await http.get("/api/me/models");
    if (data.success) {
      channels.value = Array.isArray(data.data?.channels) ? data.data.channels : [];
    }
  } catch (error) {
    ElMessage.error(
      (error as { response?: { data?: { message?: string } } }).response?.data?.message
        ?? "渠道列表加载失败",
    );
  }
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/me/logs", {
      params: {
        limit,
        offset: (page.value - 1) * limit,
        productLineId: filters.productLineId,
        model: filters.model || undefined,
        status: filters.status || undefined,
        from: filters.range?.[0],
        to: filters.range?.[1],
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
  filters.productLineId = undefined;
  filters.model = "";
  filters.status = "";
  filters.range = null;
  page.value = 1;
  load();
}

onMounted(() => {
  void loadChannels();
  load();
});
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

@media (max-width: 640px) {
  .page-head {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
