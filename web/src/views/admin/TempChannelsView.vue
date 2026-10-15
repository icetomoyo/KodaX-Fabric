<template>
  <div class="temp-channels-page">
    <section class="page-card temp-channels-shell">
      <div class="page-head">
        <div class="head-actions">
          <el-button :loading="loading" @click="refresh">刷新</el-button>
        </div>
      </div>

      <div v-loading="loading" class="split-layout">
        <aside class="list-pane channel-list">
          <div class="pane-label">
            <span>渠道</span>
            <span class="pane-count">{{ types.length }}</span>
          </div>
          <el-empty
            v-if="!loading && !types.length"
            description="还没有上游渠道"
            :image-size="64"
          />
          <div v-else class="item-list">
            <button
              v-for="channel in types"
              :key="channel.code"
              type="button"
              class="item-card"
              :class="{ selected: selectedCode === channel.code }"
              @click="selectedCode = channel.code"
            >
              <strong class="item-title">
                <span class="channel-dot" :style="{ background: channel.color }" />
                {{ channel.company }}
              </strong>
              <span class="item-meta">{{ channelMeta(channel.code) }}</span>
            </button>
          </div>
        </aside>

        <component
          :is="selectedPlugin?.page"
          v-if="selectedType && selectedPlugin"
          :channel="selectedType"
          @changed="loadProductCounts"
        />
        <el-empty
          v-else-if="!loading"
          description="请先选择渠道"
          :image-size="80"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { getChannelPage } from "@/channels";
import { useChannelTypes } from "@/composables/useChannelTypes";
import { requestMessage } from "@/lib/request-error";

type ProviderListRow = {
  code: string;
  productLines?: unknown[];
};

const { types, load: loadTypes } = useChannelTypes();
const loading = ref(false);
const selectedCode = ref<string | null>(null);
const productCounts = ref<Record<string, number>>({});

const selectedType = computed(
  () => types.value.find((row) => row.code === selectedCode.value) ?? null,
);

const selectedPlugin = computed(() =>
  selectedCode.value ? getChannelPage(selectedCode.value) : undefined,
);

function channelMeta(code: string) {
  const count = productCounts.value[code] ?? 0;
  return count ? `${count} 个产品` : "还没有产品";
}

async function loadProductCounts() {
  const { data } = await http.get<{ success: boolean; message?: string; data?: ProviderListRow[] }>(
    "/api/admin/providers",
  );
  if (!data.success) throw new Error(data.message || "加载产品失败");
  const next: Record<string, number> = {};
  for (const row of data.data ?? []) {
    next[row.code] = Array.isArray(row.productLines) ? row.productLines.length : 0;
  }
  productCounts.value = next;
}

async function refresh() {
  loading.value = true;
  try {
    await Promise.all([loadTypes(), loadProductCounts()]);
    if (
      selectedCode.value == null
      || !types.value.some((row) => row.code === selectedCode.value)
    ) {
      selectedCode.value = types.value[0]?.code ?? null;
    }
  } catch (error) {
    ElMessage.error(requestMessage(error, "加载失败"));
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refresh();
});
</script>

<style scoped>
.temp-channels-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.temp-channels-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.page-head {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  margin-bottom: 12px;
}

.head-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.split-layout {
  display: grid;
  grid-template-columns: minmax(200px, 260px) minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.list-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 12px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #f8fafc;
}

.pane-label {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  padding: 0 4px;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.pane-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #e2e8f0;
}

.item-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
}

.item-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.item-card:hover {
  border-color: #93c5fd;
}

.item-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
}

.item-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #0f172a;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.35;
}

.channel-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;
}

.item-meta {
  color: #94a3b8;
  font-size: 12px;
}
</style>
