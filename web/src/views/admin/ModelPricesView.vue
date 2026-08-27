<template>
  <div class="prices-page">
    <div class="head">
      <div>
        <h2 class="page-title" style="margin: 0">模型单价</h2>
        <p class="page-subtitle">按渠道查看上游 Key 返回的模型，并为这些模型设置单价</p>
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
          <span class="channel-meta">
            <el-badge v-if="channel.unpricedCount" :value="channel.unpricedCount" type="warning" />
            <span class="channel-count">{{ channel.models.length }}</span>
          </span>
        </button>
      </aside>

      <section class="page-card models-pane" v-loading="loading">
        <div class="models-head">
          <div>
            <h3 class="models-title">{{ currentChannel?.name || "模型" }}</h3>
            <p class="muted">{{ catalog.length }} 个模型，以上游返回列表为准</p>
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
        <el-alert
          v-else-if="unpricedCount"
          class="hint-alert"
          type="warning"
          :closable="false"
          show-icon
          :title="`有 ${unpricedCount} 个模型尚未定价，调用成本将记为 ¥0.00`"
        />

        <el-table :data="catalog" stripe empty-text="该渠道暂无已发现模型">
          <el-table-column prop="model" label="模型" min-width="180" show-overflow-tooltip />
          <el-table-column label="输入单价" min-width="120">
            <template #default="{ row }">
              <span v-if="row.price" class="mono-num">{{ formatYuan(row.price.promptPricePerMillion, 4) }}</span>
              <span v-else class="muted">未定价</span>
            </template>
          </el-table-column>
          <el-table-column label="输出单价" min-width="120">
            <template #default="{ row }">
              <span v-if="row.price" class="mono-num">{{ formatYuan(row.price.completionPricePerMillion, 4) }}</span>
              <span v-else class="muted">未定价</span>
            </template>
          </el-table-column>
          <el-table-column label="缓存命中" min-width="120">
            <template #default="{ row }">
              <span v-if="row.price" class="mono-num">{{ formatYuan(row.price.cacheHitPricePerMillion, 4) }}</span>
              <span v-else class="muted">未定价</span>
            </template>
          </el-table-column>
          <el-table-column label="缓存存储/小时" min-width="140">
            <template #default="{ row }">
              <span v-if="row.price" class="mono-num">
                {{ formatYuan(row.price.cacheStoragePricePerMillionPerHour, 4) }}
              </span>
              <span v-else class="muted">未定价</span>
            </template>
          </el-table-column>
          <el-table-column label="最近使用" min-width="170">
            <template #default="{ row }">
              {{ formatDateTime(row.lastUsedAt) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140">
            <template #default="{ row }">
              <template v-if="row.price">
                <el-button link type="primary" @click="openEdit(row.price)">编辑</el-button>
                <el-button link type="danger" @click="removeOne(row.price)">删除</el-button>
              </template>
              <el-button v-else link type="primary" @click="openCreate(row.model)">定价</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </div>
  </div>

  <el-dialog v-model="showForm" :title="formTitle" width="560px">
    <el-form label-width="110px">
      <el-form-item label="模型名" required>
        <el-select
          v-model="formModel"
          filterable
          :disabled="Boolean(editing)"
          placeholder="从当前渠道已发现模型中选择"
          style="width: 100%"
        >
          <el-option v-for="model in modelOptions" :key="model" :label="model" :value="model" />
        </el-select>
      </el-form-item>
      <el-form-item label="输入单价" required>
        <el-input v-model="formPrompt" placeholder="例如 8" />
        <div class="form-help">未命中缓存的输入，元/百万 token</div>
      </el-form-item>
      <el-form-item label="输出单价" required>
        <el-input v-model="formCompletion" placeholder="例如 28" />
        <div class="form-help">生成 token，元/百万 token</div>
      </el-form-item>
      <el-form-item label="缓存命中" required>
        <el-input v-model="formCacheHit" placeholder="例如 2" />
        <div class="form-help">命中缓存的输入，元/百万 token。填 0 则命中部分不计费</div>
      </el-form-item>
      <el-form-item label="缓存存储" required>
        <el-input v-model="formCacheStorage" placeholder="例如 0" />
        <div class="form-help">
          元/百万 token/小时。官方目前限时免费，可填 0。请求没有缓存存活时长，暂不计入单次成本
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showForm = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveOne">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";
import { formatYuan } from "@/lib/tokens";

type ModelPrice = {
  id: number;
  model: string;
  promptPricePerMillion: string;
  completionPricePerMillion: string;
  cacheHitPricePerMillion: string;
  cacheStoragePricePerMillionPerHour: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  seenInLast30Days: boolean;
};

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
  unpricedCount: number;
  models: ChannelModel[];
};

type CatalogRow = {
  model: string;
  lastUsedAt: string | null;
  price: ModelPrice | null;
};

const PRICE_PATTERN = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,4})?$/;

const loading = ref(false);
const saving = ref(false);
const prices = ref<ModelPrice[]>([]);
const channels = ref<ChannelGroup[]>([]);
const selectedChannelId = ref<number | null>(null);
const showForm = ref(false);
const editing = ref<ModelPrice | null>(null);
const formModel = ref("");
const formPrompt = ref("");
const formCompletion = ref("");
const formCacheHit = ref("");
const formCacheStorage = ref("");

const formTitle = computed(() => (editing.value ? `编辑单价 · ${editing.value.model}` : "新增单价"));

const currentChannel = computed(() =>
  channels.value.find((channel) => channel.id === selectedChannelId.value) ?? null,
);

const priceByModel = computed(() => new Map(prices.value.map((row) => [row.model, row])));

const catalog = computed<CatalogRow[]>(() => {
  const channel = currentChannel.value;
  if (!channel) return [];
  return channel.models.map((item) => {
    const price = priceByModel.value.get(item.model) ?? null;
    return {
      model: item.model,
      lastUsedAt: price?.lastUsedAt ?? item.lastUsedAt,
      price,
    };
  });
});

const unpricedCount = computed(() => catalog.value.filter((row) => !row.price).length);

const modelOptions = computed(() => {
  if (editing.value) return [editing.value.model];
  return catalog.value.filter((row) => !row.price).map((row) => row.model);
});

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
      data: { prices: ModelPrice[]; channels: ChannelGroup[] };
      message?: string;
    }>("/api/admin/model-prices");
    if (!data.success) throw new Error(data.message);
    prices.value = data.data.prices ?? [];
    channels.value = data.data.channels ?? [];
    ensureSelection();
  } catch (error: unknown) {
    ElMessage.error(requestMessage(error, "加载单价失败"));
  } finally {
    loading.value = false;
  }
}

function openCreate(model = "") {
  editing.value = null;
  formModel.value = model;
  formPrompt.value = "";
  formCompletion.value = "";
  formCacheHit.value = "";
  formCacheStorage.value = "0";
  showForm.value = true;
}

function openEdit(row: ModelPrice) {
  editing.value = row;
  formModel.value = row.model;
  formPrompt.value = row.promptPricePerMillion;
  formCompletion.value = row.completionPricePerMillion;
  formCacheHit.value = row.cacheHitPricePerMillion;
  formCacheStorage.value = row.cacheStoragePricePerMillionPerHour;
  showForm.value = true;
}

function validatePrice(value: string, label: string): string | null {
  const raw = value.trim();
  if (!raw) return `请填写${label}`;
  if (!PRICE_PATTERN.test(raw)) return `${label}须为非负数字，最多 4 位小数`;
  return null;
}

async function saveOne() {
  const model = formModel.value.trim();
  if (!model) {
    ElMessage.warning("请选择模型");
    return;
  }
  if (!editing.value && !catalog.value.some((row) => row.model === model)) {
    ElMessage.warning("只能为当前渠道已发现的模型定价");
    return;
  }
  const promptError = validatePrice(formPrompt.value, "输入单价");
  if (promptError) {
    ElMessage.warning(promptError);
    return;
  }
  const completionError = validatePrice(formCompletion.value, "输出单价");
  if (completionError) {
    ElMessage.warning(completionError);
    return;
  }
  const cacheHitError = validatePrice(formCacheHit.value, "缓存命中单价");
  if (cacheHitError) {
    ElMessage.warning(cacheHitError);
    return;
  }
  const cacheStorageError = validatePrice(formCacheStorage.value, "缓存存储单价");
  if (cacheStorageError) {
    ElMessage.warning(cacheStorageError);
    return;
  }
  const payload = {
    model,
    promptPricePerMillion: formPrompt.value.trim(),
    completionPricePerMillion: formCompletion.value.trim(),
    cacheHitPricePerMillion: formCacheHit.value.trim(),
    cacheStoragePricePerMillionPerHour: formCacheStorage.value.trim(),
  };
  saving.value = true;
  try {
    const { data } = editing.value
      ? await http.patch(`/api/admin/model-prices/${editing.value.id}`, payload)
      : await http.post("/api/admin/model-prices", payload);
    if (!data.success) throw new Error(data.message);
    ElMessage.success(editing.value ? "已更新" : "已创建");
    showForm.value = false;
    await load();
  } catch (error: unknown) {
    ElMessage.error(requestMessage(error, "保存失败"));
  } finally {
    saving.value = false;
  }
}

async function removeOne(row: ModelPrice) {
  try {
    await ElMessageBox.confirm(`删除模型 ${row.model} 的单价？`, "删除单价", { type: "warning" });
  } catch {
    return;
  }
  try {
    const { data } = await http.delete(`/api/admin/model-prices/${row.id}`);
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已删除");
    await load();
  } catch (error: unknown) {
    ElMessage.error(requestMessage(error, "删除失败"));
  }
}

function requestMessage(error: unknown, fallback: string) {
  const requestError = error as {
    message?: string;
    response?: { status?: number; data?: { message?: string } };
  };
  if (requestError.response?.status === 409) return "该模型已定价";
  return requestError.response?.data?.message || requestError.message || fallback;
}

onMounted(load);
</script>

<style scoped>
.prices-page {
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

.channel-meta {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}

.channel-count {
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
  font-size: 16px;
  font-weight: 600;
}

.hint-alert {
  margin-bottom: 12px;
}

.mono-num {
  font-variant-numeric: tabular-nums;
}

.form-help {
  margin-top: 6px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 900px) {
  .split {
    flex-direction: column;
    min-height: 0;
  }

  .channel-pane {
    width: 100%;
    max-height: 240px;
    overflow: auto;
  }
}
</style>
