<template>
  <el-card shadow="never">
      <el-alert
        class="auto-alert"
        title="系统已为每个部门自动生成一把 API Key。也可以自行新增。请妥善保管。"
        type="info"
        show-icon
        :closable="false"
      />
      <el-alert
        v-if="!hasDepartment"
        class="join-alert"
        title="尚未加入部门，没有员工权限。请等待部门管理员用你的注册手机号邀请。"
        type="warning"
        show-icon
        :closable="false"
      />

      <div class="base-url-row">
        <span class="proto-label">Base URL</span>
        <code class="key-text" :title="CLIENT_BASE_URL">{{ CLIENT_BASE_URL }}</code>
        <el-button class="row-action" link type="primary" @click="copyBaseUrl">复制</el-button>
      </div>

      <section class="dept-section protocol-section">
        <h3 class="dept-title">API协议</h3>
        <div v-for="row in apiProtocolRows" :key="row.path" class="key-row">
          <span class="proto-label">{{ row.name }}</span>
          <code class="path-text" :title="row.path">{{ row.path }}</code>
          <code class="key-text" :title="row.fullUrl">{{ row.fullUrl }}</code>
          <el-button class="row-action" link type="primary" @click="copyProtocolUrl(row)">复制</el-button>
        </div>
      </section>

      <div class="key-toolbar">
        <el-button type="primary" :disabled="!hasDepartment" @click="openCreate">新增 Key</el-button>
        <el-switch v-model="showKeys" active-text="显示 Key" inactive-text="隐藏 Key" />
      </div>

      <div v-loading="loading" class="key-board">
        <el-empty
          v-if="!loading && groups.length === 0"
          description="暂无 API Key"
          :image-size="72"
        />

        <section
          v-for="group in groups"
          :key="group.key"
          class="dept-section"
        >
          <h3 class="dept-title">{{ group.label }}</h3>
          <div v-for="row in group.rows" :key="row.id" class="key-row">
            <span class="proto-label">
              {{ row.name || "API Key" }}
              <el-tag
                v-if="row.status !== 'active'"
                type="info"
                effect="light"
                size="small"
              >
                {{ keyStatusLabel(row.status) }}
              </el-tag>
            </span>
            <code class="key-text" :title="displayKey(row)">{{ displayKey(row) }}</code>
            <el-button
              class="row-action"
              link
              type="warning"
              :loading="regeneratingId === row.id"
              @click="regenerateKey(row)"
            >
              更新
            </el-button>
            <el-button
              class="row-action"
              link
              type="primary"
              :disabled="!row.key"
              :loading="copyingId === row.id"
              @click="copyKey(row)"
            >
              复制
            </el-button>
            <el-button
              v-if="row.deletable"
              class="row-action"
              link
              type="danger"
              :loading="deletingId === row.id"
              @click="removeKey(row)"
            >
              删除
            </el-button>
          </div>
        </section>
      </div>

      <el-dialog v-model="showCreate" title="新增 Key" width="440px" @closed="resetCreate">
        <el-form label-width="72px" @submit.prevent="createKey">
          <el-form-item label="名称" required>
            <el-input
              v-model="createForm.name"
              maxlength="100"
              placeholder="例如 Cursor、Claude Code"
            />
          </el-form-item>
          <el-form-item label="部门" required>
            <el-select
              v-if="departments.length > 1"
              v-model="createForm.departmentId"
              placeholder="选择部门"
              style="width: 100%"
            >
              <el-option
                v-for="item in departments"
                :key="item.id"
                :label="item.path || item.name"
                :value="item.id"
              />
            </el-select>
            <el-input v-else :model-value="departments[0]?.name ?? ''" disabled />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showCreate = false">取消</el-button>
          <el-button type="primary" :loading="creating" @click="createKey">确定</el-button>
        </template>
      </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { copyText } from "@/lib/clipboard";
import {
  relayProtocolOptions,
  type RelayProtocol,
} from "@/views/relay-protocol";
import {
  getErrorMessage,
  loadMyDepartments,
  useApiKeyActions,
  type OrgDepartment,
} from "./api-key-actions";

type KeyRow = {
  id: number;
  name: string;
  key: string | null;
  keyPrefix: string;
  protocol: RelayProtocol;
  productLineId: number;
  teamId?: number | null;
  teamName?: string | null;
  departmentId?: number | null;
  departmentName?: string | null;
  productLineName: string;
  providerCode: string;
  providerName: string;
  status: string;
  createdAt: string;
  lastUsedAt?: string | null;
  /** 潮汐KEY；普通 Key 没有这个字段。潮汐KEY 在单独的页面里管理。 */
  tidal?: boolean;
};

type KeyRowView = KeyRow & { deletable: boolean };

type DepartmentGroup = {
  key: string;
  label: string;
  rows: KeyRowView[];
};

const CLIENT_BASE_URL = "https://tokenhub.haizhi.com";

const apiProtocolRows = [
  { name: "Messages API", path: "/v1/messages" },
  { name: "Chat Completions API", path: "/v1/chat/completions" },
  { name: "Responses API", path: "/v1/responses" },
].map((row) => ({
  ...row,
  fullUrl: `${CLIENT_BASE_URL}${row.path}`,
}));

const departments = ref<OrgDepartment[]>([]);
const hasDepartment = computed(() => departments.value.length > 0);

const keys = ref<KeyRow[]>([]);
const loading = ref(false);
const showKeys = ref(false);
const showCreate = ref(false);
const creating = ref(false);
const createForm = ref({ name: "", departmentId: null as number | null });
const { deletingId, copyingId, regeneratingId, copyKey, regenerateKey, removeKey } =
  useApiKeyActions(loadKeys);

function protocolOrder(protocol: RelayProtocol): number {
  return relayProtocolOptions.findIndex((option) => option.value === protocol);
}

/** 部门做分组标题；同部门只剩一把 Key 时不允许删除。 */
const groups = computed<DepartmentGroup[]>(() => {
  const grouped = new Map<string, KeyRow[]>();
  for (const row of keys.value) {
    const groupKey = String(row.departmentId ?? row.teamId ?? "none");
    const rows = grouped.get(groupKey);
    if (rows) {
      rows.push(row);
    } else {
      grouped.set(groupKey, [row]);
    }
  }
  const labelOf = (rows: KeyRow[]) =>
    rows[0]?.departmentName || rows[0]?.teamName || "未绑定部门";
  return [...grouped.entries()]
    .map(([groupKey, rows]) => ({ groupKey, rows }))
    .sort((left, right) =>
      labelOf(left.rows).localeCompare(labelOf(right.rows), "zh-Hans-CN"),
    )
    .map(({ groupKey, rows }) => {
      rows.sort((left, right) => protocolOrder(left.protocol) - protocolOrder(right.protocol));
      return {
        key: groupKey,
        label: labelOf(rows),
        rows: rows.map((row) => ({
          ...row,
          deletable: rows.length > 1,
        })),
      };
    });
});

function keyStatusLabel(status: string) {
  return status === "active" ? "正常" : status === "revoked" ? "已吊销" : status;
}

function maskedKey(row: KeyRow) {
  return `${row.keyPrefix}••••`;
}

function displayKey(row: KeyRow) {
  if (showKeys.value && row.key) return row.key;
  return maskedKey(row);
}

function openCreate() {
  createForm.value = {
    name: "",
    departmentId: departments.value.length === 1 ? departments.value[0].id : null,
  };
  showCreate.value = true;
}

function resetCreate() {
  createForm.value = { name: "", departmentId: null };
}

async function createKey() {
  const name = createForm.value.name.trim();
  if (!name) {
    ElMessage.error("请填写名称");
    return;
  }
  const departmentId = departments.value.length === 1
    ? departments.value[0].id
    : createForm.value.departmentId;
  if (departmentId == null) {
    ElMessage.error("请选择部门");
    return;
  }
  creating.value = true;
  try {
    await http.post("/api/me/api-keys", { name, departmentId });
    ElMessage.success("已新增 Key");
    showCreate.value = false;
    await loadKeys();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "新增失败"));
  } finally {
    creating.value = false;
  }
}

async function provisionKeys() {
  try {
    await http.post("/api/me/api-keys/provision");
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "自动生成 API Key 失败，请刷新重试"));
  }
}

async function loadKeys() {
  const { data } = await http.get("/api/me/api-keys");
  if (!data.success) return;
  const rows: KeyRow[] = Array.isArray(data.data) ? data.data : [];
  // 潮汐KEY 在「潮汐KEY」页，不算进部门分组（否则会影响「同部门最后一把不能删」的判断）。
  keys.value = rows.filter((row) => !row.tidal);
}

async function load() {
  loading.value = true;
  try {
    departments.value = await loadMyDepartments();
    await provisionKeys();
    await loadKeys();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "加载 API Key 失败"));
  } finally {
    loading.value = false;
  }
}

async function copyValue(label: string, value: string) {
  const copied = await copyText(value);
  if (copied) {
    ElMessage.success(`${label}已复制`);
  } else {
    ElMessage.error(`复制失败，请手动选中 ${label} 复制`);
  }
}

async function copyBaseUrl() {
  await copyValue("Base URL", CLIENT_BASE_URL);
}

async function copyProtocolUrl(row: (typeof apiProtocolRows)[number]) {
  await copyValue("完整路径", row.fullUrl);
}

onMounted(load);
</script>

<style scoped>
.auto-alert {
  margin-bottom: 16px;
}

.join-alert {
  margin-bottom: 16px;
}

.base-url-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.protocol-section {
  margin-bottom: 20px;
}

.key-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.protocol-section .key-text {
  width: auto;
  min-width: 320px;
  flex: 1;
}

.path-text {
  flex-shrink: 0;
  width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--el-font-family-mono, ui-monospace, monospace);
  font-size: 13px;
  color: var(--el-text-color-regular);
  user-select: all;
}

.dept-section + .dept-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.dept-title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.key-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.key-row + .key-row {
  margin-top: 12px;
}

.proto-label {
  flex-shrink: 0;
  width: 260px;
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.key-text {
  flex-shrink: 0;
  width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--el-font-family-mono, ui-monospace, monospace);
  font-size: 13px;
  color: var(--el-text-color-regular);
  user-select: all;
}

.row-action {
  flex-shrink: 0;
  padding: 0;
}
</style>
