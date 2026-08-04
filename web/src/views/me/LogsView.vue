<template>
  <div class="page-card">
    <h2 class="page-title">我的调用记录</h2>
    <el-table :data="rows" stripe empty-text="暂无记录">
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
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

const rows = ref<MeLogRow[]>([]);

function statusLabel(status: MeLogRow["status"]) {
  return {
    success: "成功",
    upstream_error: "上游错误",
    client_error: "请求错误",
    cancelled: "已取消",
  }[status];
}

onMounted(async () => {
  const { data } = await http.get("/api/me/logs");
  if (data.success) rows.value = data.data;
});
</script>
