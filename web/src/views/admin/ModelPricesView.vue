<template>
  <div class="models-page">
    <div class="head">
      <div>
        <h2 class="page-title" style="margin: 0">模型列表</h2>
        <p class="page-subtitle">按渠道查看上游 Key 返回的可用模型。智谱只展示 glm-5.3 与 glm-5.3-flash</p>
      </div>
    </div>

    <div class="split">
      <aside class="page-card channel-pane">
        <div class="pane-title">渠道</div>
        <el-empty v-if="!loading && !channels.length" description="暂无渠道" :image-size="64" />
        <button
          v-for="channel in channels"
          :key="channel.id"
          type="button"
          class="channel-item"
          :class="{ active: selectedChannelId === channel.id }"
          @click="selectedChannelId = channel.id"
        >
          <span class="channel-name">{{ channel.name }}</span>
          <span class="channel-count">{{ channel.models.length }}</span>
        </button>
      </aside>

      <section class="page-card models-pane" v-loading="loading">
        <div class="models-head">
          <div>
            <h3 class="models-title">{{ currentChannel?.name || "模型" }}</h3>
            <p class="muted" v-if="currentChannel?.providerCode === 'glm'">
              {{ catalog.length }} 个模型。智谱文本模型归到 glm-5.3，多模态归到 glm-5.3-flash
            </p>
            <p class="muted" v-else>{{ catalog.length }} 个模型，以上游返回列表为准</p>
          </div>
        </div>

        <el-alert
          v-if="!loading && currentChannel && !currentChannel.models.length"
          class="hint-alert"
          type="info"
          :closable="false"
          show-icon
          title="该渠道还没有从 Key 测试带回模型。请先到上游渠道测试 Key。"
        />

        <el-table :data="catalog" stripe empty-text="该渠道暂无已发现模型">
          <el-table-column label="模型" min-width="240">
            <template #default="{ row }">
              <span class="model-name" :title="row.model">{{ row.model }}</span>
            </template>
          </el-table-column>
          <el-table-column label="最近使用" min-width="180">
            <template #default="{ row }">
              {{ formatDateTime(row.lastUsedAt) }}
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
import { formatDateTime } from "@/lib/date-time";

type ChannelModel = {
  model: string;
  lastUsedAt: string | null;
  seenInLast30Days: boolean;
};

type ChannelGroup = {
  id: number;
  name: string;
  code: string;
  providerName: string;
  providerCode: string;
  models: ChannelModel[];
};

const loading = ref(false);
const channels = ref<ChannelGroup[]>([]);
const selectedChannelId = ref<number | null>(null);

const currentChannel = computed(() =>
  channels.value.find((channel) => channel.id === selectedChannelId.value) ?? null,
);

const catalog = computed(() => currentChannel.value?.models ?? []);

function ensureSelection() {
  if (selectedChannelId.value && channels.value.some((channel) => channel.id === selectedChannelId.value)) {
    return;
  }
  selectedChannelId.value = channels.value[0]?.id ?? null;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get<{
      success: boolean;
      data: { channels: ChannelGroup[] };
      message?: string;
    }>("/api/admin/model-prices");
    if (!data.success) throw new Error(data.message || "加载模型失败");
    channels.value = Array.isArray(data.data?.channels) ? data.data.channels : [];
    ensureSelection();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "加载模型失败"));
  } finally {
    loading.value = false;
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  const requestError = error as { response?: { data?: { message?: string } }; message?: string };
  return requestError.response?.data?.message || requestError.message || fallback;
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

.page-subtitle {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 13px;
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

.model-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  font-weight: 600;
}

@media (max-width: 900px) {
  .split {
    flex-direction: column;
    min-height: 0;
  }

  .channel-pane {
    width: auto;
  }
}
</style>
