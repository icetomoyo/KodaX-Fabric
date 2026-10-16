<template>
  <div class="models-page">
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
            <p class="muted" v-if="currentChannel?.providerCode === 'glm'">
              {{ catalogHintCount }} 个模型。调用名必须带前缀，如 glm/glm-5.3；积分按每 1 万 Token 计；文本归到 glm/glm-5.3，多模态归到 glm/glm-5.3-flash
            </p>
            <p class="muted" v-else-if="currentChannel?.providerCode === 'huoshan'">
              {{ catalogHintCount }} 个模型。调用名形如 huoshan/doubao-seed-2.0-mini；AFP 按每 1 万 Token 计，无闲时折扣。仅 Agent Plan 支持的文本与向量化模型。glm 请走智谱渠道。
            </p>
            <p class="muted" v-else>{{ catalogHintCount }} 个模型。积分按每 1 万 Token 计</p>
          </div>
          <el-form :inline="true" class="filters" @submit.prevent>
            <el-form-item>
              <el-input
                v-model="nameQuery"
                class="name-filter"
                clearable
                placeholder="模型名称"
                style="width: 220px"
              />
            </el-form-item>
            <el-form-item>
              <el-select v-model="kindFilter" class="kind-filter" clearable placeholder="模型类型" style="width: 140px">
                <el-option v-for="kind in kindOptions" :key="kind" :label="kind" :value="kind" />
              </el-select>
            </el-form-item>
          </el-form>
        </div>

        <el-alert
          v-if="!loading && currentChannel && !currentChannel.models.length"
          class="hint-alert"
          type="info"
          :closable="false"
          show-icon
          title="该渠道还没有从上游带回模型"
        />

        <el-table :data="pagedCatalog" stripe :empty-text="emptyText">
          <el-table-column label="模型名称" min-width="280">
            <template #default="{ row }">
              <div class="model-cell">
                <span class="model-name" :title="row.model">{{ row.model }}</span>
                <el-button class="copy-btn" link type="primary" @click="copyModel(row.model)">复制</el-button>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="模型类型" width="108">
            <template #default="{ row }">
              <span class="model-kind">{{ row.kind || "—" }}</span>
            </template>
          </el-table-column>
          <el-table-column label="积分消耗（每 1 万 Token）" align="center">
            <el-table-column label="Input" min-width="110" align="right">
              <template #default="{ row }">
                <span v-if="row.creditRate" class="credit-cell">
                  <b>{{ row.creditRate.promptCreditsPer10k }}</b>
                  <small v-if="row.creditRate.offPeakDiscount !== false">非高峰 {{ formatOffPeak(row.creditRate.promptCreditsPer10k) }}</small>
                </span>
                <span v-else class="credit-empty">—</span>
              </template>
            </el-table-column>
            <el-table-column label="Cached Input" min-width="130" align="right">
              <template #default="{ row }">
                <span v-if="row.creditRate" class="credit-cell">
                  <b>{{ row.creditRate.cacheHitCreditsPer10k }}</b>
                  <small v-if="row.creditRate.offPeakDiscount !== false">非高峰 {{ formatOffPeak(row.creditRate.cacheHitCreditsPer10k) }}</small>
                </span>
                <span v-else class="credit-empty">—</span>
              </template>
            </el-table-column>
            <el-table-column label="Output" min-width="110" align="right">
              <template #default="{ row }">
                <span v-if="row.creditRate" class="credit-cell">
                  <b>{{ row.creditRate.completionCreditsPer10k }}</b>
                  <small v-if="row.creditRate.offPeakDiscount !== false">非高峰 {{ formatOffPeak(row.creditRate.completionCreditsPer10k) }}</small>
                </span>
                <span v-else class="credit-empty">—</span>
              </template>
            </el-table-column>
          </el-table-column>
        </el-table>
        <div class="pager">
          <el-pagination
            v-model:current-page="catalogPage"
            background
            layout="total, prev, pager, next"
            :total="catalogTotal"
            :page-size="catalogPageSize"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { copyText } from "@/lib/clipboard";
import { useTablePage } from "@/lib/table-page";

type CreditRate = {
  promptCreditsPer10k: string;
  cacheHitCreditsPer10k: string;
  completionCreditsPer10k: string;
  offPeakDiscount?: boolean;
};

type CatalogModel = {
  model: string;
  kind?: string;
  creditRate: CreditRate | null;
};

type CatalogChannel = {
  id: number;
  name: string;
  code: string;
  providerName: string;
  providerCode: string;
  models: Array<string | CatalogModel>;
};

function formatOffPeak(value: string): string {
  const half = Number(value) / 2;
  if (!Number.isFinite(half)) return "—";
  if (Number.isInteger(half)) return String(half);
  return half.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

const loading = ref(false);
const channels = ref<CatalogChannel[]>([]);
const selectedChannelId = ref<number | null>(null);

const currentChannel = computed(() =>
  channels.value.find((channel) => channel.id === selectedChannelId.value) ?? null,
);

const catalog = computed(() =>
  (currentChannel.value?.models ?? []).map((item) =>
    typeof item === "string" ? { model: item, creditRate: null } : item,
  ),
);

const KIND_ORDER = ["纯文本", "多模态", "向量", "排序"] as const;
const nameQuery = ref("");
const kindFilter = ref("");

const kindOptions = computed(() => {
  const present = new Set(
    catalog.value.flatMap((row) => (row.kind ? [row.kind] : [])),
  );
  return KIND_ORDER.filter((kind) => present.has(kind));
});

const filteredCatalog = computed(() => {
  const query = nameQuery.value.trim().toLowerCase();
  const kind = kindFilter.value;
  return catalog.value.filter((row) => {
    if (query && !row.model.toLowerCase().includes(query)) return false;
    if (kind && row.kind !== kind) return false;
    return true;
  });
});

const catalogHintCount = computed(() => filteredCatalog.value.length);
const emptyText = computed(() => {
  if (!currentChannel.value) return "该渠道暂无可用模型";
  if (catalog.value.length && !filteredCatalog.value.length) return "没有符合筛选条件的模型";
  return "该渠道暂无可用模型";
});

const {
  page: catalogPage,
  paged: pagedCatalog,
  total: catalogTotal,
  pageSize: catalogPageSize,
  resetPage: resetCatalogPage,
} = useTablePage(filteredCatalog);
watch([selectedChannelId, nameQuery, kindFilter], resetCatalogPage);
watch(kindOptions, (options) => {
  if (kindFilter.value && !options.includes(kindFilter.value as (typeof KIND_ORDER)[number])) {
    kindFilter.value = "";
  }
});

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
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.filters {
  flex-shrink: 0;
  margin: 0;
}

.filters :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}

.filters :deep(.el-form-item:last-child) {
  margin-right: 0;
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
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
}

.model-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: #0f172a;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-btn {
  flex-shrink: 0;
}

.model-kind {
  color: #334155;
  font-size: 13px;
}

.credit-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}

.credit-cell b {
  color: #0f172a;
  font-size: 13px;
  font-weight: 650;
}

.credit-cell small {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 400;
}

.credit-empty {
  color: #94a3b8;
}

@media (max-width: 900px) {
  .split {
    flex-direction: column;
    min-height: 0;
  }

  .channel-pane {
    width: auto;
  }

  .models-head {
    flex-direction: column;
  }

  .model-cell {
    flex-wrap: wrap;
  }
}
</style>
