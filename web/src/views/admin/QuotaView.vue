<template>
  <div class="page-card quota-page" v-loading="loading">
    <div class="head">
      <div>
        <h2 class="page-title">单日 Token 配额</h2>
        <p class="subtitle">每名员工每日共享同一个硬上限，个人用量请在员工详情中查看。</p>
      </div>
      <el-button type="primary" :disabled="!policy" @click="openEdit">编辑上限</el-button>
    </div>

    <div v-if="policy" class="policy-card">
      <div class="limit-block">
        <span>每名员工每日总 Token 上限</span>
        <strong>{{ formatNumber(policy.dailyTokenLimit) }}</strong>
        <el-tag v-if="policy.dailyTokenLimit === 0" type="danger" size="small">
          当前禁止全部员工调用
        </el-tag>
      </div>
      <dl class="policy-meta">
        <div><dt>统计时区</dt><dd>{{ policy.timezone }}</dd></div>
        <div><dt>下次重置</dt><dd>{{ formatDateTimeInTimeZone(policy.resetAt, policy.timezone) }}</dd></div>
        <div><dt>策略类型</dt><dd>按员工 · 单日总 Token 硬上限</dd></div>
      </dl>
    </div>

    <el-alert
      title="RPM 与并发限制属于系统级稳定性保护，由部署环境配置，不属于业务配额。"
      type="info"
      :closable="false"
      show-icon
      class="safeguard-note"
    />

    <el-dialog v-model="showEdit" title="编辑单日 Token 上限" width="500px">
      <el-form label-position="top">
        <el-form-item label="每名员工每日总 Token 上限" required>
          <el-input-number
            v-model="dailyTokenLimit"
            :min="0"
            :max="Number.MAX_SAFE_INTEGER"
            :step="1000000"
            controls-position="right"
            style="width: 100%"
          />
          <div class="form-help">非负整数；设为 0 会立即拒绝员工当日全部新请求。</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { formatDateTimeInTimeZone } from "@/lib/date-time";

type QuotaPolicy = {
  dailyTokenLimit: number;
  timezone: string;
  resetAt: string;
  description: string;
};

const policy = ref<QuotaPolicy | null>(null);
const loading = ref(false);
const saving = ref(false);
const showEdit = ref(false);
const dailyTokenLimit = ref(0);
const numberFormatter = new Intl.NumberFormat("zh-CN");

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/quota-policy");
    if (data.success) policy.value = data.data;
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "配额加载失败");
  } finally {
    loading.value = false;
  }
}

function openEdit() {
  if (!policy.value) return;
  dailyTokenLimit.value = policy.value.dailyTokenLimit;
  showEdit.value = true;
}

async function save() {
  if (!Number.isSafeInteger(dailyTokenLimit.value) || dailyTokenLimit.value < 0) {
    ElMessage.warning("日 Token 上限必须是非负整数");
    return;
  }
  saving.value = true;
  try {
    const { data } = await http.put("/api/admin/quota-policy", {
      dailyTokenLimit: dailyTokenLimit.value,
    });
    if (data.success) policy.value = data.data;
    showEdit.value = false;
    ElMessage.success("日 Token 上限已更新");
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "保存失败");
  } finally {
    saving.value = false;
  }
}

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

onMounted(load);
</script>

<style scoped>
.quota-page { min-height: 320px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.page-title { margin: 0; }
.subtitle { margin: 6px 0 0; color: #64748b; font-size: 13px; }
.policy-card {
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(320px, 1.1fr);
  gap: 24px;
  margin-top: 22px;
  padding: 22px;
  border: 1px solid #bfdbfe;
  border-radius: 12px;
  background: #f8fbff;
}
.limit-block { display: flex; align-items: flex-start; flex-direction: column; }
.limit-block span { color: #64748b; font-size: 13px; }
.limit-block strong { margin: 7px 0; color: #1d4ed8; font-size: 34px; font-variant-numeric: tabular-nums; }
.policy-meta { margin: 0; }
.policy-meta div { display: grid; grid-template-columns: 90px 1fr; gap: 12px; padding: 9px 0; border-bottom: 1px solid #e5e7eb; }
.policy-meta div:last-child { border-bottom: 0; }
.policy-meta dt { color: #64748b; font-size: 12px; }
.policy-meta dd { margin: 0; color: #1f2937; font-size: 13px; }
.safeguard-note { margin-top: 16px; }
.form-help { margin-top: 7px; color: #94a3b8; font-size: 12px; }
@media (max-width: 760px) {
  .policy-card { grid-template-columns: 1fr; }
}
</style>
