<template>
  <div class="page-card">
    <h2 class="page-title">我的调用记录</h2>
    <el-table v-loading="loading" :data="items" stripe empty-text="暂无记录">
      <el-table-column label="时间" width="210">
        <template #default="{ row }">
          {{ formatDateTime(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column label="客户端协议" min-width="170">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">
            {{ relayProtocolLabel(row.protocol, true) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="clientModel" label="模型" width="140" />
      <el-table-column prop="providerCode" label="供应商" width="120" />
      <el-table-column label="状态" width="120">
        <template #default="{ row }">{{ statusLabel(row.status) }}</template>
      </el-table-column>
      <el-table-column prop="totalTokens" label="Tokens" width="100" />
      <el-table-column prop="latencyMs" label="耗时(ms)" width="100" />
      <el-table-column prop="requestId" label="Request ID" />
    </el-table>
    <div v-if="total > limit" class="pager">
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";
import { relayProtocolLabel, type RelayProtocol } from "@/views/relay-protocol";

type MeLogRow = {
  id: number;
  requestId: string;
  protocol: RelayProtocol;
  clientModel: string;
  providerCode: string | null;
  status: "success" | "upstream_error" | "client_error" | "cancelled";
  totalTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
};

const items = ref<MeLogRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 10;
const loading = ref(false);

function statusLabel(status: MeLogRow["status"]) {
  return {
    success: "成功",
    upstream_error: "上游错误",
    client_error: "请求错误",
    cancelled: "已取消",
  }[status];
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/me/logs", {
      params: { limit, offset: (page.value - 1) * limit },
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

onMounted(load);
</script>

<style scoped>
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
