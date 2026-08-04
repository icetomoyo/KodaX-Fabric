<template>
  <div class="credentials-page">
    <section class="page-card">
      <div class="page-head">
        <div>
          <h2 class="page-title">上游渠道</h2>
        </div>
        <div class="head-actions">
          <el-button :loading="loading" @click="refreshAll">刷新</el-button>
          <el-button type="primary" @click="openCreate">新增渠道</el-button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-label">渠道总数</span>
          <strong>{{ stats.total }}</strong>
        </div>
        <div class="stat-card success">
          <span class="stat-label">启用中</span>
          <strong>{{ stats.active }}</strong>
        </div>
        <div class="stat-card warning">
          <span class="stat-label">待测试</span>
          <strong>{{ stats.untested }}</strong>
        </div>
        <div class="stat-card danger">
          <span class="stat-label">最近测试失败</span>
          <strong>{{ stats.failed }}</strong>
        </div>
      </div>

      <div class="toolbar">
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="搜索渠道名称、平台或 Key 末四位"
          class="keyword-input"
        />
        <el-select v-model="filters.providerCode" clearable placeholder="全部平台" class="filter-select">
          <el-option
            v-for="provider in providerOptions"
            :key="provider.value"
            :label="provider.label"
            :value="provider.value"
          />
        </el-select>
        <el-select v-model="filters.status" clearable placeholder="全部状态" class="filter-select">
          <el-option label="启用" value="active" />
          <el-option label="停用" value="disabled" />
          <el-option label="自动停用" value="auto_disabled" />
          <el-option label="冷却中" value="cooling" />
        </el-select>
      </div>

      <el-empty
        v-if="!loading && !filteredRows.length"
        :description="rows.length ? '没有符合条件的渠道' : '暂无上游渠道'"
      >
        <el-button v-if="!rows.length" type="primary" @click="openCreate">新增渠道</el-button>
      </el-empty>

      <el-table v-else v-loading="loading" :data="filteredRows" stripe class="credential-table">
        <el-table-column label="渠道" min-width="190">
          <template #default="{ row }">
            <div class="credential-name">{{ row.label }}</div>
            <div class="secret-mask">•••• •••• {{ row.secretSuffix }}</div>
          </template>
        </el-table-column>

        <el-table-column label="平台" min-width="180">
          <template #default="{ row }">
            <div class="provider-cell">
              <span class="provider-dot" :style="providerDotStyle(row.providerCode)" />
              <div>
                <div class="provider-name">{{ row.providerName }}</div>
                <div class="cell-secondary">{{ productTypeText(row.productType) }}</div>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="API 地址" min-width="220">
          <template #default="{ row }">
            <el-tooltip :content="effectiveBaseUrl(row)" placement="top">
              <span class="endpoint-text">{{ effectiveBaseUrl(row) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>

        <el-table-column label="调度" width="120">
          <template #default="{ row }">
            <div class="metric-line"><span>优先级</span><b>{{ row.priority }}</b></div>
            <div class="metric-line"><span>权重</span><b>{{ row.weight }}</b></div>
          </template>
        </el-table-column>

        <el-table-column label="健康检查" min-width="230">
          <template #default="{ row }">
            <template v-if="lastTest(row)">
              <div class="test-result">
                <el-tag :type="lastTest(row)?.ok ? 'success' : 'danger'" size="small" effect="light">
                  {{ lastTest(row)?.ok ? "连接正常" : "测试失败" }}
                </el-tag>
                <span v-if="lastTest(row)?.latencyMs !== undefined" class="latency">
                  {{ lastTest(row)?.latencyMs }}ms
                </span>
              </div>
              <div class="cell-secondary">{{ formatDateTime(lastTest(row)?.testedAt) }}</div>
              <el-popover
                v-if="discoveredModels(row).length"
                placement="bottom-start"
                :width="360"
                trigger="click"
              >
                <template #reference>
                  <el-button link type="primary" class="model-button">
                    已发现 {{ discoveredModels(row).length }} 个模型
                  </el-button>
                </template>
                <div class="model-popover-title">上游模型</div>
                <div class="model-tags">
                  <el-tag v-for="model in discoveredModels(row)" :key="model" size="small">
                    {{ model }}
                  </el-tag>
                </div>
              </el-popover>
            </template>
            <span v-else class="cell-secondary">尚未测试</span>
          </template>
        </el-table-column>

        <el-table-column label="调用统计" width="120">
          <template #default="{ row }">
            <div class="metric-line"><span>成功</span><b>{{ row.successCount }}</b></div>
            <div class="metric-line"><span>失败</span><b>{{ row.errorCount }}</b></div>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="105">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" effect="light">
              {{ statusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="224" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :loading="testingId === row.id"
              @click="testCredential(row)"
            >
              测试
            </el-button>
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button
              v-if="row.status === 'active'"
              link
              type="danger"
              @click="setStatus(row.id, 'disabled')"
            >
              停用
            </el-button>
            <el-button v-else link type="success" @click="setStatus(row.id, 'active')">
              启用
            </el-button>
            <el-button
              v-if="row.productType === 'coding_plan' || row.shareMode === 'grant_only'"
              link
              @click="openGrants(row)"
            >
              授权
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog
      v-model="showForm"
      :title="form.id ? '编辑上游渠道' : '新增上游渠道'"
      width="760px"
      destroy-on-close
      class="credential-dialog"
    >
      <template v-if="!form.id">
        <div class="section-label provider-section-label">平台</div>
        <div class="provider-grid">
          <button
            v-for="template in templates"
            :key="template.code"
            type="button"
            class="provider-card"
            :class="{ selected: form.providerCode === template.code }"
            @click="selectTemplate(template)"
          >
            <span class="provider-logo" :style="{ background: template.color }">
              {{ template.shortName }}
            </span>
            <span class="provider-card-copy">
              <strong>{{ template.name }}</strong>
            </span>
          </button>
        </div>

        <el-form label-position="top" class="credential-form">
          <el-form-item label="API 地址">
            <el-select v-model="form.baseUrl" style="width: 100%">
              <el-option
                v-for="option in selectedTemplate?.baseUrls ?? []"
                :key="option.url"
                :label="`${option.label} · ${option.url}`"
                :value="option.url"
              />
            </el-select>
          </el-form-item>
        </el-form>
      </template>

      <div v-else class="editing-context">
        <span class="provider-dot" :style="providerDotStyle(editingRow?.providerCode || '')" />
        <div>
          <strong>{{ editingRow?.providerName }}</strong>
          <div class="cell-secondary">{{ editingRow ? effectiveBaseUrl(editingRow) : "" }}</div>
        </div>
      </div>

      <el-divider />

      <el-form label-position="top" class="credential-form">
        <div class="form-row">
          <el-form-item label="渠道名称" required>
            <el-input v-model="form.label" maxlength="200" show-word-limit placeholder="如：GLM 生产主账号" />
          </el-form-item>
          <el-form-item :label="form.id ? '替换 API Key' : 'API Key'" :required="!form.id">
            <el-input
              v-model="form.secret"
              type="password"
              show-password
              autocomplete="new-password"
              :placeholder="form.id ? '留空则保留当前密钥' : '粘贴官方 API Key'"
            />
          </el-form-item>
        </div>

        <el-collapse class="advanced-collapse">
          <el-collapse-item title="调度" name="advanced">
            <div class="number-row">
              <el-form-item label="优先级">
                <el-input-number v-model="form.priority" :min="-1000" :max="1000" controls-position="right" />
              </el-form-item>
              <el-form-item label="权重">
                <el-input-number v-model="form.weight" :min="0" :max="10000" controls-position="right" />
              </el-form-item>
            </div>
          </el-collapse-item>
        </el-collapse>

        <el-form-item v-if="!form.id" class="test-switch-item">
          <el-switch v-model="form.testAfterCreate" />
          <span class="switch-label">保存后测试</span>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showForm = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">
          {{ form.id ? "保存修改" : form.testAfterCreate ? "保存并测试" : "保存渠道" }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showGrants" title="渠道员工授权" width="640px">
      <el-form inline @submit.prevent>
        <el-form-item label="员工">
          <el-select v-model="grantEmployeeId" filterable style="width: 280px" placeholder="选择员工">
            <el-option
              v-for="user in users"
              :key="user.id"
              :label="`${user.name} (${user.phone})`"
              :value="user.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="addGrant">添加授权</el-button>
        </el-form-item>
      </el-form>
      <el-table :data="grants" size="small">
        <el-table-column prop="employeeName" label="姓名" />
        <el-table-column prop="employeePhone" label="手机" />
        <el-table-column label="授权时间" min-width="210">
          <template #default="{ row }">
            {{ formatDateTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button link type="danger" @click="removeGrant(row.id)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";

type CredentialStatus = "active" | "disabled" | "auto_disabled" | "cooling";

type TestResult = {
  ok: boolean;
  testedAt: string;
  latencyMs: number;
  httpStatus: number | null;
  modelCount: number;
  models: string[];
  message: string;
};

type CredentialRow = {
  id: number;
  productLineId: number;
  label: string;
  secretSuffix: string;
  weight: number;
  priority: number;
  status: CredentialStatus;
  successCount: number;
  errorCount: number;
  lastError: string | null;
  providerCode: string;
  providerName: string;
  productLineCode: string;
  productType: "api" | "coding_plan";
  shareMode: "public_pool" | "grant_only" | "disabled";
  defaultBaseUrl: string;
  baseUrlOverride: string | null;
  meta: {
    lastTest?: TestResult;
    discoveredModels?: string[];
    [key: string]: unknown;
  } | null;
};

type ProviderBaseUrl = {
  label: string;
  url: string;
  productLineCode: string;
  productLineName: string;
};

type ProviderTemplate = {
  code: "glm" | "kimi" | "deepseek" | "minimax";
  name: string;
  shortName: string;
  baseUrls: ProviderBaseUrl[];
  defaultLabel: string;
  color: string;
};

type UserOption = { id: number; name: string; phone: string };
type GrantRow = { id: number; employeeName: string; employeePhone: string; createdAt: string };

const rows = ref<CredentialRow[]>([]);
const templates = ref<ProviderTemplate[]>([]);
const users = ref<UserOption[]>([]);
const grants = ref<GrantRow[]>([]);
const loading = ref(false);
const saving = ref(false);
const testingId = ref<number | null>(null);
const showForm = ref(false);
const showGrants = ref(false);
const editingRow = ref<CredentialRow | null>(null);
const grantEmployeeId = ref<number>();
const grantCredentialId = ref(0);

const filters = reactive({
  keyword: "",
  providerCode: "",
  status: "" as CredentialStatus | "",
});

const form = reactive({
  id: 0,
  providerCode: "glm" as ProviderTemplate["code"],
  baseUrl: "",
  label: "",
  secret: "",
  priority: 0,
  weight: 100,
  testAfterCreate: true,
});

const selectedTemplate = computed(() =>
  templates.value.find((item) => item.code === form.providerCode),
);

const providerOptions = computed(() => {
  const options = new Map<string, string>();
  for (const template of templates.value) options.set(template.code, template.name);
  for (const row of rows.value) options.set(row.providerCode, row.providerName);
  return [...options].map(([value, label]) => ({ value, label }));
});

const filteredRows = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase();
  return rows.value.filter((row) => {
    if (filters.providerCode && row.providerCode !== filters.providerCode) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (!keyword) return true;
    return [row.label, row.providerName, row.providerCode, row.secretSuffix]
      .some((value) => value.toLowerCase().includes(keyword));
  });
});

const stats = computed(() => ({
  total: rows.value.length,
  active: rows.value.filter((row) => row.status === "active").length,
  untested: rows.value.filter((row) => !lastTest(row)).length,
  failed: rows.value.filter((row) => lastTest(row)?.ok === false).length,
}));

function getErrorMessage(error: unknown, fallback: string): string {
  const responseMessage = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof responseMessage === "string" ? responseMessage : fallback;
}

function effectiveBaseUrl(row: CredentialRow): string {
  return row.baseUrlOverride || row.defaultBaseUrl;
}

function lastTest(row: CredentialRow): TestResult | undefined {
  return row.meta?.lastTest;
}

function discoveredModels(row: CredentialRow): string[] {
  return row.meta?.discoveredModels ?? lastTest(row)?.models ?? [];
}

function providerDotStyle(code: string): Record<string, string> {
  return {
    background: templates.value.find((item) => item.code === code)?.color ?? "#64748b",
  };
}

function productTypeText(type: CredentialRow["productType"]): string {
  return type === "coding_plan" ? "Coding Plan" : "API";
}

function statusText(status: CredentialStatus): string {
  return {
    active: "启用",
    disabled: "停用",
    auto_disabled: "自动停用",
    cooling: "冷却中",
  }[status];
}

function statusTagType(status: CredentialStatus): "success" | "info" | "danger" | "warning" {
  return {
    active: "success" as const,
    disabled: "info" as const,
    auto_disabled: "danger" as const,
    cooling: "warning" as const,
  }[status];
}

async function loadCredentials() {
  const { data } = await http.get("/api/admin/credentials");
  if (data.success) rows.value = data.data;
}

async function loadMeta() {
  const [templateResponse, userResponse] = await Promise.all([
    http.get("/api/admin/credential-templates"),
    http.get("/api/admin/users", { params: { limit: 200 } }),
  ]);
  if (templateResponse.data.success) templates.value = templateResponse.data.data;
  if (userResponse.data.success) users.value = userResponse.data.data;
}

async function refreshAll() {
  loading.value = true;
  try {
    await Promise.all([loadCredentials(), loadMeta()]);
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "加载上游渠道失败"));
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  form.id = 0;
  form.providerCode = templates.value[0]?.code ?? "glm";
  form.baseUrl = templates.value[0]?.baseUrls[0]?.url ?? "";
  form.label = templates.value[0]?.defaultLabel ?? "";
  form.secret = "";
  form.priority = 0;
  form.weight = 100;
  form.testAfterCreate = true;
  editingRow.value = null;
}

function openCreate() {
  resetForm();
  showForm.value = true;
}

function selectTemplate(template: ProviderTemplate) {
  const previousTemplate = selectedTemplate.value;
  const shouldReplaceLabel = !form.label || form.label === previousTemplate?.defaultLabel;
  form.providerCode = template.code;
  form.baseUrl = template.baseUrls[0]?.url ?? "";
  if (shouldReplaceLabel) form.label = template.defaultLabel;
}

function openEdit(row: CredentialRow) {
  editingRow.value = row;
  form.id = row.id;
  form.providerCode = (templates.value.find((item) => item.code === row.providerCode)?.code ?? "glm");
  form.baseUrl = effectiveBaseUrl(row);
  form.label = row.label;
  form.secret = "";
  form.priority = row.priority;
  form.weight = row.weight;
  form.testAfterCreate = false;
  showForm.value = true;
}

async function save() {
  if (!form.label.trim()) {
    ElMessage.warning("请填写渠道名称");
    return;
  }
  if (!form.id && !form.secret.trim()) {
    ElMessage.warning("请填写 API Key");
    return;
  }
  saving.value = true;
  try {
    if (form.id) {
      await http.patch(`/api/admin/credentials/${form.id}`, {
        label: form.label.trim(),
        secret: form.secret.trim() || undefined,
        priority: form.priority,
        weight: form.weight,
      });
      ElMessage.success("渠道已更新");
    } else {
      const { data } = await http.post("/api/admin/credentials/quick-create", {
        providerCode: form.providerCode,
        baseUrl: form.baseUrl,
        label: form.label.trim(),
        secret: form.secret.trim(),
        priority: form.priority,
        weight: form.weight,
        testAfterCreate: form.testAfterCreate,
      });
      const test = data.data?.test as TestResult | null;
      if (!test) {
        ElMessage.success("渠道已保存");
      } else if (test.ok) {
        ElMessage.success(test.message);
      } else {
        ElMessage.warning(`渠道已保存，但连接测试未通过：${test.message}`);
      }
    }
    showForm.value = false;
    await refreshAll();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "保存失败"));
  } finally {
    saving.value = false;
  }
}

async function testCredential(row: CredentialRow) {
  testingId.value = row.id;
  try {
    const { data } = await http.post(`/api/admin/credentials/${row.id}/test`);
    const result = data.data as TestResult;
    result.ok ? ElMessage.success(result.message) : ElMessage.warning(result.message);
    await loadCredentials();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "测试失败"));
  } finally {
    testingId.value = null;
  }
}

async function setStatus(id: number, status: CredentialStatus) {
  try {
    await http.patch(`/api/admin/credentials/${id}`, { status });
    ElMessage.success(status === "active" ? "渠道已启用" : "渠道已停用");
    await loadCredentials();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "状态更新失败"));
  }
}

async function openGrants(row: CredentialRow) {
  grantCredentialId.value = row.id;
  grantEmployeeId.value = undefined;
  const { data } = await http.get(`/api/admin/credentials/${row.id}/grants`);
  if (data.success) grants.value = data.data;
  showGrants.value = true;
}

async function addGrant() {
  if (!grantEmployeeId.value) {
    ElMessage.warning("请选择员工");
    return;
  }
  try {
    await http.post(`/api/admin/credentials/${grantCredentialId.value}/grants`, {
      employeeId: grantEmployeeId.value,
    });
    ElMessage.success("已授权");
    const { data } = await http.get(`/api/admin/credentials/${grantCredentialId.value}/grants`);
    if (data.success) grants.value = data.data;
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "授权失败"));
  }
}

async function removeGrant(grantId: number) {
  try {
    await http.delete(`/api/admin/credentials/${grantCredentialId.value}/grants/${grantId}`);
    ElMessage.success("已移除授权");
    const { data } = await http.get(`/api/admin/credentials/${grantCredentialId.value}/grants`);
    if (data.success) grants.value = data.data;
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "移除授权失败"));
  }
}

onMounted(refreshAll);
</script>

<style scoped>
.credentials-page {
  min-width: 0;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.page-title {
  margin: 0;
  font-size: 22px;
}

.head-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 18px 0;
}

.stat-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 70px;
  padding: 14px 16px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #f8fafc;
}

.stat-card strong {
  color: #0f172a;
  font-size: 25px;
}

.stat-card.success {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.stat-card.warning {
  border-color: #fde68a;
  background: #fffbeb;
}

.stat-card.danger {
  border-color: #fecaca;
  background: #fef2f2;
}

.stat-label {
  color: #64748b;
  font-size: 13px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
  margin-bottom: 14px;
  border-radius: 10px;
  background: #f8fafc;
}

.keyword-input {
  width: 300px;
}

.filter-select {
  width: 170px;
}

.credential-name,
.provider-name {
  color: #0f172a;
  font-weight: 600;
}

.secret-mask,
.cell-secondary {
  margin-top: 3px;
  color: #94a3b8;
  font-size: 12px;
}

.secret-mask {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  letter-spacing: 0.03em;
}

.provider-cell,
.editing-context {
  display: flex;
  align-items: center;
  gap: 9px;
}

.provider-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border-radius: 50%;
  box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.14);
}

.endpoint-text {
  display: block;
  max-width: 100%;
  overflow: hidden;
  color: #475569;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: #64748b;
  font-size: 12px;
}

.metric-line + .metric-line {
  margin-top: 4px;
}

.metric-line b {
  color: #334155;
}

.test-result {
  display: flex;
  align-items: center;
  gap: 8px;
}

.latency {
  color: #64748b;
  font-size: 12px;
}

.model-button {
  height: auto;
  padding: 3px 0 0;
  font-size: 12px;
}

.model-popover-title {
  margin-bottom: 10px;
  color: #0f172a;
  font-weight: 600;
}

.model-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 240px;
  overflow: auto;
}

.section-label {
  margin-bottom: 10px;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
}

.provider-section-label {
  margin-top: 2px;
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 18px;
}

.provider-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 11px;
  background: #fff;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.provider-card:hover {
  border-color: #93c5fd;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.07);
}

.provider-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
}

.provider-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  border-radius: 12px;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.provider-card-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.provider-card-copy strong {
  color: #0f172a;
  font-size: 14px;
}

.credential-form {
  margin-top: 4px;
}

.form-row,
.number-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.advanced-collapse {
  margin-top: 4px;
  border-top: 0;
}

.test-switch-item :deep(.el-form-item__content) {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
}

.switch-label {
  color: #475569;
  font-size: 13px;
}

.editing-context {
  padding: 12px 14px;
  border-radius: 9px;
  background: #f8fafc;
}

@media (max-width: 1000px) {
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .toolbar {
    flex-wrap: wrap;
  }

  .keyword-input {
    width: 100%;
  }
}

@media (max-width: 720px) {
  .page-head,
  .form-row,
  .number-row {
    display: flex;
    flex-direction: column;
  }

  .provider-grid {
    grid-template-columns: 1fr;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }

  .head-actions,
  .filter-select {
    width: 100%;
  }
}
</style>
