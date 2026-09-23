<template>
  <el-card class="logs-page" shadow="never">
    <el-form :inline="true" class="filters" @keyup.enter="search">
      <el-form-item>
        <el-select
          v-model="filters.model"
          clearable
          filterable
          :loading="modelsLoading"
          placeholder="按模型筛选"
          style="width: 240px"
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
      v-loading="loading"
      :data="items"
      stripe
      empty-text="暂无记录"
    >
      <el-table-column label="Request ID" min-width="240">
        <template #default="{ row }">
          <el-button link type="primary" @click="copyRequestId(row.requestId)">
            {{ row.requestId }}
          </el-button>
        </template>
      </el-table-column>
      <el-table-column label="模型" min-width="200">
        <template #default="{ row }">
          <span class="model-cell">
            {{ row.clientModel }}
            <el-tag v-if="row.productType === 'coding_plan'" effect="plain" size="small">套餐</el-tag>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="Tokens" width="200">
        <template #default="{ row }">
          <dl class="metric-stack">
            <div><dt>输入</dt><dd>{{ formatNumber(row.promptTokens) }}</dd></div>
            <div><dt>输出</dt><dd>{{ formatNumber(row.completionTokens) }}</dd></div>
            <div><dt>缓存命中</dt><dd>{{ formatNumber(row.cacheReadTokens) }}</dd></div>
            <div><dt>合计</dt><dd>{{ formatNumber(row.totalTokens) }}</dd></div>
          </dl>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
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
    </el-table>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-size="limit"
        @current-change="load"
      />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { copyText } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/date-time";

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
}

type ModelOption = { model: string; alias?: string | null };

const numberFormatter = new Intl.NumberFormat("zh-CN");

const filters = reactive({
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
const items = ref<MeLogRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 5;
const loading = ref(false);

const hasFilters = computed(() => Boolean(filters.model || filters.status || timeRange.value));

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

function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : numberFormatter.format(value);
}

async function copyRequestId(requestId: string) {
  const copied = await copyText(requestId);
  if (copied) ElMessage.success("Request ID 已复制");
  else ElMessage.error("复制失败");
}

async function loadModels() {
  modelsLoading.value = true;
  try {
    const { data } = await http.get("/api/me/log-models");
    if (data.success) models.value = data.data.models ?? [];
  } catch {
    models.value = [];
  } finally {
    modelsLoading.value = false;
  }
}

function listQueryParams() {
  const params: Record<string, string | number> = {
    limit,
    offset: (page.value - 1) * limit,
  };
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
    const { data } = await http.get("/api/me/logs", {
      params: listQueryParams(),
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
  void load();
}

function resetFilters() {
  filters.model = "";
  filters.status = null;
  timeRange.value = null;
  page.value = 1;
  void load();
}

onMounted(() => {
  void load();
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
.model-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
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
</style>
