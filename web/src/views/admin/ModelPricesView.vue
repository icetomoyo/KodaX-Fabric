<template>
  <div class="page-card">
    <div class="head">
      <div>
        <h2 class="page-title" style="margin: 0">模型单价</h2>
        <p class="page-subtitle">
          按上游 Key 测试发现的模型设置输入、输出、缓存命中、缓存存储单价，用于折算团队成本
        </p>
      </div>
      <el-button type="primary" @click="openCreate()">新增单价</el-button>
    </div>

    <el-alert
      v-if="!loading && !discoveredModels.length"
      class="unpriced-alert"
      type="info"
      :closable="false"
      show-icon
      title="还没有从上游 Key 发现模型。请先到上游渠道测试 Key，连通成功后会带回模型列表。"
    />

    <el-alert
      v-else-if="unpricedDiscovered.length"
      class="unpriced-alert"
      type="warning"
      :closable="false"
      show-icon
    >
      <template #title>
        有 {{ unpricedDiscovered.length }} 个上游已发现模型尚未定价，调用成本将记为 ¥0.00
      </template>
      <div class="unpriced-list">
        <div v-for="item in unpricedDiscovered" :key="item.model" class="unpriced-item">
          <strong>{{ item.model }}</strong>
          <el-button size="small" type="primary" plain @click="openCreate(item.model)">
            去定价
          </el-button>
        </div>
      </div>
    </el-alert>

    <el-table v-loading="loading" :data="catalog" stripe empty-text="暂无模型">
      <el-table-column prop="model" label="模型" min-width="200" show-overflow-tooltip />
      <el-table-column label="来源" min-width="180">
        <template #default="{ row }">
          <div class="source-tags">
            <el-tag v-if="row.discovered" size="small" type="success" effect="plain">上游已发现</el-tag>
            <el-tag v-if="row.seenInLast30Days" size="small" effect="plain">近 30 天有调用</el-tag>
            <el-tag v-else-if="row.price && !row.discovered" size="small" type="info" effect="plain">
              手工录入
            </el-tag>
          </div>
        </template>
      </el-table-column>
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
  </div>

  <el-dialog v-model="showForm" :title="formTitle" width="560px">
    <el-form label-width="110px">
      <el-form-item label="模型名" required>
        <el-select
          v-model="formModel"
          filterable
          allow-create
          default-first-option
          :disabled="Boolean(editing)"
          placeholder="从已发现模型中选择，也可手动输入"
          style="width: 100%"
        >
          <el-option
            v-for="model in modelOptions"
            :key="model"
            :label="model"
            :value="model"
          />
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

type UnpricedModel = {
  model: string;
  lastUsedAt: string | null;
  seenInLast30Days: boolean;
  discovered?: boolean;
};

type CatalogRow = {
  model: string;
  discovered: boolean;
  seenInLast30Days: boolean;
  lastUsedAt: string | null;
  price: ModelPrice | null;
};

const PRICE_PATTERN = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,4})?$/;

const loading = ref(false);
const saving = ref(false);
const prices = ref<ModelPrice[]>([]);
const discoveredModels = ref<string[]>([]);
const unpricedModels = ref<UnpricedModel[]>([]);
const showForm = ref(false);
const editing = ref<ModelPrice | null>(null);
const formModel = ref("");
const formPrompt = ref("");
const formCompletion = ref("");
const formCacheHit = ref("");
const formCacheStorage = ref("");

const formTitle = computed(() => (editing.value ? `编辑单价 · ${editing.value.model}` : "新增单价"));

const unpricedDiscovered = computed(() => unpricedModels.value.filter((item) => item.discovered));

const catalog = computed<CatalogRow[]>(() => {
  const byModel = new Map<string, CatalogRow>();
  const remember = (model: string, patch: Partial<CatalogRow>) => {
    const current = byModel.get(model) ?? {
      model,
      discovered: false,
      seenInLast30Days: false,
      lastUsedAt: null,
      price: null,
    };
    byModel.set(model, { ...current, ...patch, model });
  };
  for (const model of discoveredModels.value) {
    remember(model, { discovered: true });
  }
  for (const item of unpricedModels.value) {
    remember(item.model, {
      discovered: Boolean(item.discovered) || byModel.get(item.model)?.discovered,
      seenInLast30Days: item.seenInLast30Days,
      lastUsedAt: item.lastUsedAt,
    });
  }
  for (const price of prices.value) {
    remember(price.model, {
      price,
      seenInLast30Days: price.seenInLast30Days,
      lastUsedAt: price.lastUsedAt ?? byModel.get(price.model)?.lastUsedAt ?? null,
    });
  }
  return [...byModel.values()].sort((left, right) => left.model.localeCompare(right.model));
});

const modelOptions = computed(() => {
  if (editing.value) return [editing.value.model];
  const priced = new Set(prices.value.map((row) => row.model));
  const discovered = discoveredModels.value.filter((model) => !priced.has(model));
  const extra = formModel.value.trim() && !discovered.includes(formModel.value.trim())
    ? [formModel.value.trim()]
    : [];
  return [...discovered, ...extra];
});

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get<{
      success: boolean;
      data: {
        prices: ModelPrice[];
        unpricedModels: UnpricedModel[];
        discoveredModels?: string[];
      };
      message?: string;
    }>("/api/admin/model-prices");
    if (data.success) {
      prices.value = data.data.prices;
      unpricedModels.value = data.data.unpricedModels;
      discoveredModels.value = data.data.discoveredModels ?? [];
    }
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
    ElMessage.warning("请选择或填写模型名");
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
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.page-subtitle {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 13px;
}
.unpriced-alert {
  margin-bottom: 16px;
}
.unpriced-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.unpriced-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.source-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mono-num {
  font-variant-numeric: tabular-nums;
}
.muted {
  color: #94a3b8;
}
.form-help {
  margin-top: 6px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.5;
}
</style>
