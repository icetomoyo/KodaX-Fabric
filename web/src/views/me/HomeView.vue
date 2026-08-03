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
    <h3>接入说明</h3>
    <p class="muted">将客户端 Base URL 指向 TokenHub，使用员工 API Key 调用。</p>
    <el-descriptions :column="1" border>
      <el-descriptions-item label="Base URL">
        {{ usage?.relay?.baseUrl || "http://127.0.0.1:3100/v1" }}
      </el-descriptions-item>
      <el-descriptions-item label="Header">
        Authorization: Bearer &lt;你的 API Key&gt;
      </el-descriptions-item>
      <el-descriptions-item label="接口">
        POST /v1/chat/completions（代理实现下一阶段）
      </el-descriptions-item>
    </el-descriptions>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { http } from "@/api/http";

const usage = ref<{
  today?: { totalTokens: number; requestCount: number };
  month?: { totalTokens: number; requestCount: number };
  relay?: { baseUrl: string };
} | null>(null);

onMounted(async () => {
  const { data } = await http.get("/api/me/usage");
  if (data.success) usage.value = data.data;
});
</script>
