<template>
  <div class="page-card">
    <div class="head">
      <div>
        <h2 class="page-title" style="margin: 0">模型单价</h2>
        <p class="page-subtitle">按百万 token 设置输入 / 输出单价，用于折算团队成本（人民币）</p>
      </div>
      <el-button type="primary" @click="openCreate()">新增单价</el-button>
    </div>

    <el-alert
      v-if="unpricedModels.length"
      class="unpriced-alert"
      type="warning"
      :closable="false"
      show-icon
    >
      <template #title>
        有 {{ unpricedModels.length }} 个近 30 天有调用的模型尚未定价，成本将记为 ¥0.00
      </template>
      <div class="unpriced-list">
        <div v-for="item in unpricedModels" :key="item.model" class="unpriced-item">
          <div>
            <strong>{{ item.model }}</strong>
            <span class="muted">最近使用 {{ formatDateTime(item.lastUsedAt) }}</span>
          </div>
          <el-button size="small" type="primary" plain @click="openCreate(item.model)">
            去定价
          </el-button>
        </div>
      </div>
    </el-alert>

    <el-table v-loading="loading" :data="prices" stripe>
      <el-table-column prop="model" label="模型" min-width="180" show-overflow-tooltip />
      <el-table-column label="输入单价（元/百万 token）" min-width="180">
        <template #default="{ row }">
          <span class="mono-num">{{ formatYuan(row.promptPricePerMillion, 4) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="输出单价（元/百万 token）" min-width="180">
        <template #default="{ row }">
          <span class="mono-num">{{ formatYuan(row.completionPricePerMillion, 4) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="最近使用" min-width="180">
        <template #default="{ row }">
          {{ formatDateTime(row.lastUsedAt) }}
        </template>
      </el-table-column>
      <el-table-column label="近 30 天" width="110">
        <template #default="{ row }">
          <el-tag :type="row.seenInLast30Days ? 'success' : 'info'" size="small">
            {{ row.seenInLast30Days ? "有调用" : "无调用" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="removeOne(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>

  <el-dialog v-model="showForm" :title="formTitle" width="460px">
    <el-form label-width="90px">
      <el-form-item label="模型名" required>
        <el-input v-model="formModel" maxlength="128" placeholder="例如 claude-sonnet-4-5" />
      </el-form-item>
      <el-form-item label="输入单价" required>
        <el-input v-model="formPrompt" placeholder="例如 2.5" />
        <div class="form-help">非负数字，最多 4 位小数，单位：元/百万 token</div>
      </el-form-item>
      <el-form-item label="输出单价" required>
        <el-input v-model="formCompletion" placeholder="例如 10" />
        <div class="form-help">非负数字，最多 4 位小数，单位：元/百万 token</div>
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
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  seenInLast30Days: boolean;
};

type UnpricedModel = {
  model: string;
  lastUsedAt: string | null;
  seenInLast30Days: boolean;
};

const PRICE_PATTERN = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,4})?$/;

const loading = ref(false);
const saving = ref(false);
const prices = ref<ModelPrice[]>([]);
const unpricedModels = ref<UnpricedModel[]>([]);
const showForm = ref(false);
const editing = ref<ModelPrice | null>(null);
const formModel = ref("");
const formPrompt = ref("");
const formCompletion = ref("");

const formTitle = computed(() => (editing.value ? `编辑单价 · ${editing.value.model}` : "新增单价"));

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get<{
      success: boolean;
      data: { prices: ModelPrice[]; unpricedModels: UnpricedModel[] };
      message?: string;
    }>("/api/admin/model-prices");
    if (data.success) {
      prices.value = data.data.prices;
      unpricedModels.value = data.data.unpricedModels;
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
  showForm.value = true;
}

function openEdit(row: ModelPrice) {
  editing.value = row;
  formModel.value = row.model;
  formPrompt.value = row.promptPricePerMillion;
  formCompletion.value = row.completionPricePerMillion;
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
    ElMessage.warning("请填写模型名");
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
  const payload = {
    model,
    promptPricePerMillion: formPrompt.value.trim(),
    completionPricePerMillion: formCompletion.value.trim(),
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
.unpriced-item .muted {
  display: block;
  margin-top: 2px;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 400;
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
</style>
