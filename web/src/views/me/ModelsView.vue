<template>
  <div class="models-page">
    <div class="head">
      <div>
        <h2 class="page-title">模型</h2>
        <p class="page-subtitle">
          以上游渠道返回的模型为准。智谱文本请用 glm-5.3，多模态请用 glm-5.3-flash。配置客户端时请复制模型名称，不要手打。
        </p>
      </div>
    </div>

    <el-alert
      class="copy-alert"
      title="模型名称请用复制。客户端里的模型 ID 必须与这里完全一致。"
      type="info"
      :closable="false"
      show-icon
    />

    <div class="split">
      <aside class="page-card channel-pane">
        <div class="pane-title">渠道</div>
        <el-empty v-if="!loading && !channels.length" description="暂无可用渠道" :image-size="64" />
        <button
          v-for="channel in channels"
          :key="channel.id"
          type="button"
          class="channel-item"
          :class="{ active: selectedChannelId === channel.id }"
          @click="selectedChannelId = channel.id"
        >
          <span class="channel-name">{{ channelLabel(channel) }}</span>
          <span class="channel-count">{{ channel.models.length }}</span>
        </button>
      </aside>

      <section class="page-card models-pane" v-loading="loading">
        <div class="models-head">
          <div>
            <h3 class="models-title">{{ currentChannel ? channelLabel(currentChannel) : "模型" }}</h3>
            <p class="muted">
              {{ catalog.length }} 个模型 · 单价为元 / 百万 tokens
            </p>
          </div>
        </div>

        <el-alert
          v-if="!loading && currentChannel && !currentChannel.models.length"
          class="hint-alert"
          type="info"
          :closable="false"
          show-icon
          title="该渠道还没有从上游带回模型"
        />

        <el-table :data="catalog" stripe empty-text="该渠道暂无可用模型">
          <el-table-column label="模型" min-width="220">
            <template #default="{ row }">
              <div class="model-cell">
                <button type="button" class="model-id" @click="copyModel(row.model)">
                  {{ row.model }}
                </button>
                <el-button link type="primary" @click="copyModel(row.model)">复制</el-button>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="输入" min-width="120">
            <template #default="{ row }">
              <span v-if="row.priced" class="mono-num">{{ formatYuan(row.promptPricePerMillion, 4) }}</span>
              <span v-else class="muted">未定价</span>
            </template>
          </el-table-column>
          <el-table-column label="输出" min-width="120">
            <template #default="{ row }">
              <span v-if="row.priced" class="mono-num">{{ formatYuan(row.completionPricePerMillion, 4) }}</span>
              <span v-else class="muted">未定价</span>
            </template>
          </el-table-column>
          <el-table-column label="缓存命中" min-width="120">
            <template #default="{ row }">
              <span v-if="row.priced" class="mono-num">{{ formatYuan(row.cacheHitPricePerMillion, 4) }}</span>
              <span v-else class="muted">未定价</span>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { copyText } from "@/lib/clipboard";
import { formatYuan } from "@/lib/tokens";

type CatalogModel = {
  model: string;
  priced: boolean;
  promptPricePerMillion: string | null;
  completionPricePerMillion: string | null;
  cacheHitPricePerMillion: string | null;
};

type CatalogChannel = {
  id: number;
  name: string;
  code: string;
  providerName: string;
  providerCode: string;
  models: CatalogModel[];
};

const loading = ref(false);
const channels = ref<CatalogChannel[]>([]);
const selectedChannelId = ref<number | null>(null);

const currentChannel = computed(() =>
  channels.value.find((channel) => channel.id === selectedChannelId.value) ?? null,
);

const catalog = computed(() => currentChannel.value?.models ?? []);

function channelLabel(channel: Pick<CatalogChannel, "providerName" | "name">): string {
  const company = channel.providerName.trim();
  const model = channel.name.trim();
  if (!company) return model;
  if (!model) return company;
  if (company === model || model.startsWith(`${company}/`)) return model;
  return `${company}/${model}`;
}

function ensureSelection() {
  if (selectedChannelId.value && channels.value.some((channel) => channel.id === selectedChannelId.value)) {
    return;
  }
  selectedChannelId.value = channels.value[0]?.id ?? null;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/me/models");
    if (!data.success) throw new Error(data.message || "加载模型失败");
    channels.value = Array.isArray(data.data?.channels) ? data.data.channels : [];
    ensureSelection();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "加载模型失败"));
  } finally {
    loading.value = false;
  }
}

async function copyModel(model: string) {
  const copied = await copyText(model);
  if (copied) ElMessage.success(`已复制 ${model}`);
  else ElMessage.error("复制失败，请手动选择模型名称");
}

function getErrorMessage(error: unknown, fallback: string): string {
  const responseMessage = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

onMounted(load);
</script>

<style scoped>
.models-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: calc(100vh - 100px);
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
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
  line-height: 1.6;
}

.copy-alert :deep(.el-alert__content) {
  min-width: 0;
}

.split {
  display: flex;
  flex: 1;
  gap: 16px;
  min-height: 480px;
  align-items: stretch;
}

.channel-pane,
.models-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.channel-pane {
  width: 260px;
  flex-shrink: 0;
  padding: 16px 12px;
}

.models-pane {
  flex: 1;
  min-width: 0;
}

.pane-title {
  margin: 0 8px 10px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.channel-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.channel-item:hover {
  background: #f3f4f6;
}

.channel-item.active {
  background: #eff6ff;
  color: #1d4ed8;
}

.channel-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.channel-count {
  flex-shrink: 0;
  color: #6b7280;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.channel-item.active .channel-count {
  color: #2563eb;
}

.models-head {
  margin-bottom: 8px;
}

.models-title {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
  font-weight: 600;
}

.muted {
  margin: 4px 0 0;
  color: #94a3b8;
  font-size: 13px;
}

.hint-alert {
  margin-bottom: 12px;
}

.model-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.model-id {
  overflow: hidden;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #0f172a;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.model-id:hover {
  color: #2563eb;
}

.mono-num {
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

@media (max-width: 720px) {
  .split {
    flex-direction: column;
  }

  .channel-pane {
    width: auto;
  }
}
</style>
