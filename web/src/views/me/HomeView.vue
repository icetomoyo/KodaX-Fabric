<template>
  <div class="page-card">
    <h2 class="page-title">我的工作台</h2>
    <el-row :gutter="16">
      <el-col :span="8">
        <el-statistic title="今日 Tokens" :value="usage?.today?.totalTokens ?? 0" />
      </el-col>
      <el-col :span="8">
        <el-statistic title="今日请求" :value="usage?.today?.requestCount ?? 0" />
      </el-col>
      <el-col :span="8">
        <el-statistic title="本月 Tokens" :value="usage?.month?.totalTokens ?? 0" />
      </el-col>
    </el-row>
    <el-divider />
    <h3 class="guide-title">接入说明</h3>
    <el-descriptions :column="1" border>
      <el-descriptions-item label="Base URL">
        <code>{{ clientBaseUrl }}</code>
      </el-descriptions-item>
    </el-descriptions>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { http } from "@/api/http";
import {
  RELAY_BASE_PATH,
  relayClientBaseUrl,
} from "@/views/relay-protocol";

const usage = ref<{
  today?: { totalTokens: number; requestCount: number };
  month?: { totalTokens: number; requestCount: number };
  relay?: { baseUrl: string };
} | null>(null);

const relayBaseUrl = computed(
  () => usage.value?.relay?.baseUrl || `http://127.0.0.1:3100${RELAY_BASE_PATH}`,
);
const clientBaseUrl = computed(() => relayClientBaseUrl(relayBaseUrl.value));

onMounted(async () => {
  const { data } = await http.get("/api/me/usage");
  if (data.success) usage.value = data.data;
});
</script>

<style scoped>
.guide-title {
  margin: 0 0 12px;
}
code {
  overflow-wrap: anywhere;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
