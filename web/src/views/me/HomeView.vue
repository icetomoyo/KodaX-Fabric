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
    <div class="guide-head">
      <div>
        <h3>接入说明</h3>
        <p class="muted">选择与 API Key 一致的协议，再按下方信息配置客户端。</p>
      </div>
      <el-select v-model="selectedProtocol" class="protocol-select">
        <el-option
          v-for="option in relayProtocolOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
    </div>
    <el-alert
      title="一个 API Key 只适用于创建时选择的协议；协议不匹配的请求会被拒绝。"
      type="info"
      :closable="false"
      show-icon
      class="protocol-alert"
    />
    <el-descriptions :column="1" border>
      <el-descriptions-item label="客户端协议">
        <strong>{{ protocolGuide.label }}</strong>
        <span class="description">{{ protocolGuide.description }}</span>
      </el-descriptions-item>
      <el-descriptions-item label="Base URL">
        <code>{{ clientBaseUrl }}</code>
      </el-descriptions-item>
      <el-descriptions-item label="请求接口">
        <code>{{ protocolGuide.endpoint }}</code>
      </el-descriptions-item>
      <el-descriptions-item label="鉴权 Header">
        <div class="code-lines">
          <code v-for="line in protocolGuide.authHeaders" :key="line">{{ line }}</code>
        </div>
      </el-descriptions-item>
      <el-descriptions-item label="客户端配置">
        <div class="code-lines">
          <code v-for="line in clientSettings" :key="line">{{ line }}</code>
        </div>
      </el-descriptions-item>
    </el-descriptions>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { http } from "@/api/http";
import {
  relayClientBaseUrl,
  relayClientSettings,
  relayProtocolOption,
  relayProtocolOptions,
  type RelayProtocol,
} from "@/views/relay-protocol";

const usage = ref<{
  today?: { totalTokens: number; requestCount: number };
  month?: { totalTokens: number; requestCount: number };
  relay?: { baseUrl: string };
} | null>(null);
const selectedProtocol = ref<RelayProtocol>("openai_chat");

const relayBaseUrl = computed(
  () => usage.value?.relay?.baseUrl || "http://127.0.0.1:3100/v1",
);
const protocolGuide = computed(() => relayProtocolOption(selectedProtocol.value));
const clientBaseUrl = computed(() =>
  relayClientBaseUrl(selectedProtocol.value, relayBaseUrl.value),
);
const clientSettings = computed(() =>
  relayClientSettings(selectedProtocol.value, relayBaseUrl.value),
);

onMounted(async () => {
  const { data } = await http.get("/api/me/usage");
  if (data.success) usage.value = data.data;
});
</script>

<style scoped>
.guide-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.guide-head h3,
.guide-head p {
  margin: 0;
}
.guide-head p {
  margin-top: 6px;
}
.protocol-select {
  width: 310px;
}
.protocol-alert {
  margin-bottom: 12px;
}
.description {
  margin-left: 10px;
  color: #64748b;
  font-size: 13px;
}
.code-lines {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
code {
  overflow-wrap: anywhere;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
@media (max-width: 720px) {
  .guide-head {
    align-items: stretch;
    flex-direction: column;
  }
  .protocol-select {
    width: 100%;
  }
  .description {
    display: block;
    margin: 4px 0 0;
  }
}
</style>
