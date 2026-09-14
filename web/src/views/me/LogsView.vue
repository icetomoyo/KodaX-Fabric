<template>
  <el-card shadow="never">
    <el-table v-loading="loading" :data="items" stripe empty-text="暂无记录">
      <el-table-column label="Request ID" min-width="240">
        <template #default="{ row }">
          <el-button link type="primary" @click="copyRequestId(row.requestId)">
            {{ row.requestId }}
          </el-button>
        </template>
      </el-table-column>
      <el-table-column label="渠道" min-width="160">
        <template #default="{ row }">
          <span>
            {{ providerText(row.providerCode) }}
            <el-tag v-if="row.productType === 'coding_plan'" effect="plain">套餐</el-tag>
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
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status)">
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
        layout="total, prev, pager, next"
        :total="total"
        :page-size="limit"
        @current-change="load"
      />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { copyText } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/date-time";
import { TABLE_PAGE_SIZE } from "@/lib/table-page";

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

const providerNames: Record<string, string> = {
  glm: "智谱/GLM",
  kimi: "月之暗面/Kimi",
  deepseek: "深度求索/DeepSeek",
  minimax: "MiniMax",
};

const numberFormatter = new Intl.NumberFormat("zh-CN");
const items = ref<MeLogRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = TABLE_PAGE_SIZE;
const loading = ref(false);

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

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/me/logs", {
      params: {
        limit,
        offset: (page.value - 1) * limit,
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

onMounted(() => {
  load();
});
</script>

<style scoped>
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
