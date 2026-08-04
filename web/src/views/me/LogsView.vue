<template>
  <div class="page-card">
    <h2 class="page-title">我的调用记录</h2>
    <el-table :data="rows" stripe empty-text="暂无记录">
      <el-table-column label="时间" width="210">
        <template #default="{ row }">
          {{ formatDateTime(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column prop="clientModel" label="模型" width="140" />
      <el-table-column prop="providerCode" label="供应商" width="120" />
      <el-table-column prop="status" label="状态" width="120" />
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

const rows = ref([]);

onMounted(async () => {
  const { data } = await http.get("/api/me/logs");
  if (data.success) rows.value = data.data;
});
</script>
