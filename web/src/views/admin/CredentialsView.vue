<template>
  <div class="credentials-page">
    <section class="page-card credentials-shell">
      <div class="page-head">
        <div>
          <h2 class="page-title">上游渠道</h2>
          <p class="page-subtitle">选择左侧渠道查看详情，或新增上游凭证</p>
        </div>
        <div class="head-actions">
          <el-button :loading="loading" @click="refreshAll">刷新</el-button>
          <el-button type="primary" @click="openCreate">新增渠道</el-button>
        </div>
      </div>

      <div v-loading="loading" class="split-layout">
        <aside class="channel-list-pane">
          <div class="pane-label">
            <span>渠道列表</span>
            <span class="pane-count">{{ rows.length }}</span>
          </div>

          <el-empty
            v-if="!loading && !rows.length"
            description="暂无上游渠道"
            :image-size="72"
          >
            <el-button type="primary" @click="openCreate">新增渠道</el-button>
          </el-empty>

          <div v-else class="channel-list">
            <button
              v-for="row in rows"
              :key="row.id"
              type="button"
              class="channel-card"
              :class="{ selected: selectedId === row.id }"
              @click="selectChannel(row.id)"
            >
              <div class="channel-card-top">
                <span class="provider-logo sm" :style="providerLogoStyle(row.providerCode)">
                  {{ providerShortName(row.providerCode) }}
                </span>
                <div class="channel-card-copy">
                  <strong class="channel-card-title">{{ row.label }}</strong>
                  <span class="channel-card-meta">{{ row.providerName }} · {{ productTypeText(row.productType) }}</span>
                </div>
                <el-tag :type="statusTagType(row.status)" size="small" effect="light">
                  {{ statusText(row.status) }}
                </el-tag>
              </div>
              <div class="channel-card-bottom">
                <span class="secret-mask">•••• {{ row.secretSuffix }}</span>
                <span class="health-chip" :class="healthChipClass(row)">
                  {{ healthSummary(row) }}
                </span>
              </div>
            </button>
          </div>
        </aside>

        <main class="channel-detail-pane">
          <template v-if="selected">
            <div class="detail-header">
              <div class="detail-identity">
                <span class="provider-logo" :style="providerLogoStyle(selected.providerCode)">
                  {{ providerShortName(selected.providerCode) }}
                </span>
                <div>
                  <h3 class="detail-title">{{ selected.label }}</h3>
                  <div class="detail-subtitle">
                    {{ selected.providerName }} · {{ productTypeText(selected.productType) }}
                    <span class="dot-sep">·</span>
                    <span class="secret-mask inline">•••• {{ selected.secretSuffix }}</span>
                  </div>
                </div>
              </div>
              <div class="detail-actions">
                <el-button
                  :loading="testingId === selected.id"
                  @click="testCredential(selected)"
                >
                  测试连接
                </el-button>
                <el-button @click="openEdit(selected)">编辑</el-button>
                <el-button
                  v-if="selected.status === 'active'"
                  type="danger"
                  plain
                  @click="setStatus(selected.id, 'disabled')"
                >
                  停用
                </el-button>
                <el-button
                  v-else
                  type="success"
                  plain
                  @click="setStatus(selected.id, 'active')"
                >
                  启用
                </el-button>
                <el-button
                  v-if="canManageGrants(selected)"
                  @click="openGrants(selected)"
                >
                  员工授权
                </el-button>
                <el-button
                  type="danger"
                  :loading="deletingId === selected.id"
                  @click="removeCredential(selected)"
                >
                  删除
                </el-button>
              </div>
            </div>

            <div class="detail-status-row">
              <el-tag :type="statusTagType(selected.status)" effect="light">
                {{ statusText(selected.status) }}
              </el-tag>
              <el-tag
                v-if="lastTest(selected)"
                :type="lastTest(selected)?.ok ? 'success' : 'danger'"
                effect="plain"
              >
                {{ lastTest(selected)?.ok ? "最近测试通过" : "最近测试失败" }}
              </el-tag>
              <el-tag v-else type="info" effect="plain">尚未测试</el-tag>
              <el-tag
                v-if="selected.status === 'cooling' && selected.coolUntil"
                type="warning"
                effect="plain"
              >
                冷却至 {{ formatDateTime(selected.coolUntil) }}
              </el-tag>
            </div>

            <div class="detail-sections">
              <section class="detail-section">
                <h4 class="section-heading">基本信息</h4>
                <dl class="info-grid">
                  <div class="info-item full">
                    <dt>API 地址</dt>
                    <dd class="mono wrap">{{ effectiveBaseUrl(selected) }}</dd>
                  </div>
                  <div class="info-item full">
                    <dt>支持协议</dt>
                    <dd>
                      <div class="protocol-tags">
                        <el-tag
                          v-for="protocol in credentialProtocols(selected)"
                          :key="protocol"
                          size="small"
                          effect="plain"
                        >
                          {{ relayProtocolLabel(protocol, true) }}
                        </el-tag>
                      </div>
                    </dd>
                  </div>
                  <div class="info-item">
                    <dt>最近使用</dt>
                    <dd>{{ formatDateTime(selected.lastUsedAt) }}</dd>
                  </div>
                  <div class="info-item">
                    <dt>冷却至</dt>
                    <dd>
                      <template v-if="selected.coolUntil">
                        {{ formatDateTime(selected.coolUntil) }}
                        <span v-if="isCoolingActive(selected)" class="cooling-hint">（冷却中）</span>
                      </template>
                      <template v-else>—</template>
                    </dd>
                  </div>
                </dl>
              </section>

              <section class="detail-section">
                <h4 class="section-heading">调度参数</h4>
                <div class="metric-cards">
                  <div class="metric-card">
                    <span class="metric-label">优先级</span>
                    <strong>{{ selected.priority }}</strong>
                  </div>
                  <div class="metric-card">
                    <span class="metric-label">权重</span>
                    <strong>{{ selected.weight }}</strong>
                  </div>
                  <div class="metric-card">
                    <span class="metric-label">成功调用</span>
                    <strong class="ok">{{ selected.successCount }}</strong>
                  </div>
                  <div class="metric-card">
                    <span class="metric-label">失败调用</span>
                    <strong class="bad">{{ selected.errorCount }}</strong>
                  </div>
                </div>
              </section>

              <section class="detail-section">
                <h4 class="section-heading">健康检查</h4>
                <template v-if="lastTest(selected)">
                  <dl class="info-grid">
                    <div class="info-item">
                      <dt>结果</dt>
                      <dd>
                        <el-tag
                          :type="lastTest(selected)?.ok ? 'success' : 'danger'"
                          size="small"
                          effect="light"
                        >
                          {{ lastTest(selected)?.ok ? "连接正常" : "测试失败" }}
                        </el-tag>
                      </dd>
                    </div>
                    <div class="info-item">
                      <dt>延迟</dt>
                      <dd>{{ lastTest(selected)?.latencyMs ?? "—" }} ms</dd>
                    </div>
                    <div class="info-item">
                      <dt>HTTP 状态</dt>
                      <dd>{{ lastTest(selected)?.httpStatus ?? "—" }}</dd>
                    </div>
                    <div class="info-item">
                      <dt>测试时间</dt>
                      <dd>{{ formatDateTime(lastTest(selected)?.testedAt) }}</dd>
                    </div>
                    <div class="info-item full">
                      <dt>消息</dt>
                      <dd>{{ lastTest(selected)?.message || "—" }}</dd>
                    </div>
                    <div v-if="selected.lastError" class="info-item full">
                      <dt>最近错误</dt>
                      <dd class="error-text">{{ selected.lastError }}</dd>
                    </div>
                  </dl>
                  <div v-if="discoveredModels(selected).length" class="models-block">
                    <div class="models-heading">
                      已发现 {{ discoveredModels(selected).length }} 个上游模型
                    </div>
                    <div class="model-tags">
                      <el-tag
                        v-for="model in discoveredModels(selected)"
                        :key="model"
                        size="small"
                      >
                        {{ model }}
                      </el-tag>
                    </div>
                  </div>
                </template>
                <p v-else class="empty-hint">尚未做过连通性测试，可点击右上角「测试连接」。</p>
              </section>

              <section v-if="canManageGrants(selected)" class="detail-section">
                <h4 class="section-heading">访问控制</h4>
                <p class="empty-hint">该渠道需显式授权员工后才可使用。</p>
                <el-button type="primary" plain @click="openGrants(selected)">管理员工授权</el-button>
              </section>
            </div>
          </template>

          <el-empty
            v-else-if="!loading"
            class="detail-empty"
            :description="rows.length ? '请从左侧选择一个渠道' : '暂无上游渠道'"
            :image-size="96"
          >
            <el-button v-if="!rows.length" type="primary" @click="openCreate">新增渠道</el-button>
          </el-empty>
        </main>
      </div>
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

        <el-form-item label="支持的客户端协议" required class="protocol-form-item">
          <el-select
            v-model="form.supportedProtocols"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="至少选择一种协议"
            class="protocol-multi-select"
          >
            <el-option
              v-for="option in relayProtocolOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            >
              <div class="protocol-option">
                <span>{{ option.label }}</span>
                <small>{{ option.endpoint }}</small>
              </div>
            </el-option>
          </el-select>
          <div class="form-help">
            按该上游 Key 的真实兼容能力选择，可多选；至少保留一种协议。
          </div>
        </el-form-item>

        <div v-if="form.supportedProtocols.length" class="protocol-guides">
          <div v-for="protocol in form.supportedProtocols" :key="protocol" class="protocol-guide-row">
            <strong>{{ relayProtocolLabel(protocol) }}</strong>
            <span>{{ relayProtocolOption(protocol).description }}</span>
          </div>
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
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";
import {
  relayProtocolLabel,
  relayProtocolOption,
  relayProtocolOptions,
  type RelayProtocol,
} from "@/views/relay-protocol";

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
  supportedProtocols: RelayProtocol[];
  weight: number;
  priority: number;
  status: CredentialStatus;
  coolUntil: string | null;
  lastUsedAt: string | null;
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
  defaultProtocols: RelayProtocol[];
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
const deletingId = ref<number | null>(null);
const showForm = ref(false);
const showGrants = ref(false);
const editingRow = ref<CredentialRow | null>(null);
const grantEmployeeId = ref<number>();
const grantCredentialId = ref(0);
const selectedId = ref<number | null>(null);

const form = reactive({
  id: 0,
  providerCode: "glm" as ProviderTemplate["code"],
  baseUrl: "",
  label: "",
  secret: "",
  supportedProtocols: ["openai_chat"] as RelayProtocol[],
  priority: 0,
  weight: 100,
  testAfterCreate: true,
});

const selectedTemplate = computed(() =>
  templates.value.find((item) => item.code === form.providerCode),
);

const selected = computed(
  () => rows.value.find((row) => row.id === selectedId.value) ?? null,
);

watch(
  rows,
  (list) => {
    if (!list.length) {
      selectedId.value = null;
      return;
    }
    if (selectedId.value == null || !list.some((row) => row.id === selectedId.value)) {
      selectedId.value = list[0].id;
    }
  },
  { deep: false },
);

function selectChannel(id: number) {
  selectedId.value = id;
}

function getErrorMessage(error: unknown, fallback: string): string {
  const responseMessage = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof responseMessage === "string" ? responseMessage : fallback;
}

function effectiveBaseUrl(row: CredentialRow): string {
  return row.baseUrlOverride || row.defaultBaseUrl;
}

function credentialProtocols(row: CredentialRow): RelayProtocol[] {
  return row.supportedProtocols?.length ? row.supportedProtocols : ["openai_chat"];
}

function lastTest(row: CredentialRow): TestResult | undefined {
  return row.meta?.lastTest;
}

function discoveredModels(row: CredentialRow): string[] {
  return row.meta?.discoveredModels ?? lastTest(row)?.models ?? [];
}

function canManageGrants(row: CredentialRow): boolean {
  return row.productType === "coding_plan" || row.shareMode === "grant_only";
}

function isCoolingActive(row: CredentialRow): boolean {
  if (!row.coolUntil) return false;
  const until = new Date(row.coolUntil).getTime();
  return !Number.isNaN(until) && until > Date.now();
}

function providerColor(code: string): string {
  return templates.value.find((item) => item.code === code)?.color ?? "#64748b";
}

function providerShortName(code: string): string {
  return templates.value.find((item) => item.code === code)?.shortName
    ?? code.slice(0, 4).toUpperCase();
}

function providerLogoStyle(code: string): Record<string, string> {
  return { background: providerColor(code) };
}

function providerDotStyle(code: string): Record<string, string> {
  return {
    background: providerColor(code),
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

function healthSummary(row: CredentialRow): string {
  const test = lastTest(row);
  if (!test) return "未测试";
  if (test.ok) return test.latencyMs != null ? `${test.latencyMs}ms` : "正常";
  return "失败";
}

function healthChipClass(row: CredentialRow): string {
  const test = lastTest(row);
  if (!test) return "muted";
  return test.ok ? "ok" : "bad";
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
  form.supportedProtocols = [...(templates.value[0]?.defaultProtocols ?? ["openai_chat"])];
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
  form.supportedProtocols = [...template.defaultProtocols];
  if (shouldReplaceLabel) form.label = template.defaultLabel;
}

function openEdit(row: CredentialRow) {
  editingRow.value = row;
  form.id = row.id;
  form.providerCode = (templates.value.find((item) => item.code === row.providerCode)?.code ?? "glm");
  form.baseUrl = effectiveBaseUrl(row);
  form.label = row.label;
  form.secret = "";
  form.supportedProtocols = [...credentialProtocols(row)];
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
  if (!form.supportedProtocols.length) {
    ElMessage.warning("请至少选择一种支持协议");
    return;
  }
  saving.value = true;
  try {
    if (form.id) {
      await http.patch(`/api/admin/credentials/${form.id}`, {
        label: form.label.trim(),
        secret: form.secret.trim() || undefined,
        supportedProtocols: [...form.supportedProtocols],
        priority: form.priority,
        weight: form.weight,
      });
      ElMessage.success("渠道已更新");
      showForm.value = false;
      await refreshAll();
    } else {
      const { data } = await http.post("/api/admin/credentials/quick-create", {
        providerCode: form.providerCode,
        baseUrl: form.baseUrl,
        label: form.label.trim(),
        secret: form.secret.trim(),
        supportedProtocols: [...form.supportedProtocols],
        priority: form.priority,
        weight: form.weight,
        testAfterCreate: form.testAfterCreate,
      });
      const test = data.data?.test as TestResult | null;
      const createdId = data.data?.credential?.id as number | undefined;
      if (!test) {
        ElMessage.success("渠道已保存");
      } else if (test.ok) {
        ElMessage.success(test.message);
      } else {
        ElMessage.warning(`渠道已保存，但连接测试未通过：${test.message}`);
      }
      showForm.value = false;
      await refreshAll();
      if (createdId) selectedId.value = createdId;
    }
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

async function removeCredential(row: CredentialRow) {
  try {
    await ElMessageBox.confirm(
      `确认删除渠道「${row.label}」？密钥末四位 ${row.secretSuffix}。删除后不可恢复，历史调用日志仍会保留记录。`,
      "删除上游渠道",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      },
    );
  } catch {
    return;
  }

  deletingId.value = row.id;
  try {
    await http.delete(`/api/admin/credentials/${row.id}`);
    ElMessage.success("渠道已删除");
    if (selectedId.value === row.id) selectedId.value = null;
    await loadCredentials();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "删除失败"));
  } finally {
    deletingId.value = null;
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
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.credentials-shell {
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
}

.page-title {
  margin: 0;
  font-size: 22px;
}

.page-subtitle {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 13px;
}

.head-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.split-layout {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.channel-list-pane,
.channel-detail-pane {
  min-width: 0;
  min-height: 0;
  height: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #f8fafc;
}

.channel-list-pane {
  display: flex;
  flex-direction: column;
  padding: 12px;
  overflow: hidden;
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
  letter-spacing: 0.02em;
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
  color: #475569;
  font-size: 12px;
}

.channel-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 2px;
}

.channel-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.channel-card:hover {
  border-color: #93c5fd;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
}

.channel-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
}

.channel-card-top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.channel-card-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.channel-card-title {
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-card-meta {
  color: #94a3b8;
  font-size: 12px;
}

.channel-card-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.health-chip {
  flex: 0 0 auto;
  color: #64748b;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.health-chip.ok {
  color: #15803d;
}

.health-chip.bad {
  color: #b91c1c;
}

.health-chip.muted {
  color: #94a3b8;
}

.channel-detail-pane {
  display: flex;
  flex-direction: column;
  padding: 18px 20px;
  background: #fff;
  overflow-x: hidden;
  overflow-y: auto;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.detail-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.detail-title {
  margin: 0;
  color: #0f172a;
  font-size: 20px;
  font-weight: 650;
}

.detail-subtitle {
  margin-top: 4px;
  color: #64748b;
  font-size: 13px;
}

.dot-sep {
  margin: 0 4px;
  color: #cbd5e1;
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.detail-status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
}

.detail-sections {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.detail-section {
  padding: 14px 16px;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  background: #f8fafc;
}

.section-heading {
  margin: 0 0 12px;
  color: #334155;
  font-size: 13px;
  font-weight: 650;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  margin: 0;
}

.info-item {
  min-width: 0;
}

.info-item.full {
  grid-column: 1 / -1;
}

.info-item dt {
  margin-bottom: 4px;
  color: #94a3b8;
  font-size: 12px;
}

.info-item dd {
  margin: 0;
  color: #0f172a;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.wrap {
  white-space: normal;
  word-break: break-all;
}

.error-text {
  color: #b91c1c;
}

.cooling-hint {
  margin-left: 6px;
  color: #d97706;
  font-size: 12px;
}

.metric-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.metric-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #e5e7eb;
}

.metric-label {
  color: #94a3b8;
  font-size: 12px;
}

.metric-card strong {
  color: #0f172a;
  font-size: 20px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.metric-card strong.ok {
  color: #15803d;
}

.metric-card strong.bad {
  color: #b91c1c;
}

.models-block {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
}

.models-heading {
  margin-bottom: 10px;
  color: #334155;
  font-size: 12px;
  font-weight: 600;
}

.model-tags,
.protocol-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.model-tags {
  max-height: 180px;
  overflow: auto;
}

.empty-hint {
  margin: 0 0 12px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.55;
}

.detail-empty {
  margin: auto;
}

.secret-mask {
  color: #94a3b8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  letter-spacing: 0.03em;
}

.secret-mask.inline {
  color: #64748b;
}

.cell-secondary {
  margin-top: 3px;
  color: #94a3b8;
  font-size: 12px;
}

.provider-dot,
.editing-context {
  display: flex;
  align-items: center;
  gap: 9px;
}

.provider-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  display: block;
  border-radius: 50%;
  box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.14);
}

.editing-context {
  padding: 12px 14px;
  border-radius: 9px;
  background: #f8fafc;
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

.provider-logo.sm {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  font-size: 11px;
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

.protocol-form-item :deep(.el-form-item__content) {
  display: block;
}

.protocol-multi-select {
  width: 100%;
}

.protocol-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
}

.protocol-option small {
  color: #94a3b8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.form-help {
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.protocol-guides {
  display: grid;
  gap: 7px;
  padding: 10px 12px;
  margin: -4px 0 12px;
  border-radius: 8px;
  background: #f8fafc;
}

.protocol-guide-row {
  display: flex;
  align-items: baseline;
  gap: 9px;
  color: #64748b;
  font-size: 12px;
}

.protocol-guide-row strong {
  flex: 0 0 auto;
  color: #334155;
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

@media (max-width: 1100px) {
  .metric-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .split-layout {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 38%) minmax(0, 1fr);
  }

  .detail-header {
    flex-direction: column;
  }

  .detail-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 720px) {
  .page-head,
  .form-row,
  .number-row {
    display: flex;
    flex-direction: column;
  }

  .provider-grid,
  .info-grid,
  .metric-cards {
    grid-template-columns: 1fr;
  }

  .head-actions {
    width: 100%;
  }

  .protocol-guide-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }
}
</style>
