<template>
  <el-card shadow="never">
      <el-alert
        class="auto-alert"
        title="系统已为你的每个部门按协议自动生成 API Key（每个协议一把），明文仅你自己可见，请妥善保管。"
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
              {{ relayProtocolLabel(row.protocol, true) }}
              <el-tag
                v-if="row.status !== 'active'"
                type="info"
                effect="light"
                size="small"
              >
                {{ keyStatusLabel(row.status) }}
              </el-tag>
            </span>
            <code class="key-text" :title="row.key || row.keyPrefix">{{ row.key ?? `${row.keyPrefix}••••` }}</code>
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
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { copyText } from "@/lib/clipboard";
import {
  relayProtocolLabel,
  relayProtocolOptions,
  type RelayProtocol,
} from "@/views/relay-protocol";

type OrgDepartment = {
  id: number;
  name: string;
  path?: string;
  teamId: number;
};

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
};

type KeyRowView = KeyRow & { deletable: boolean };

type DepartmentGroup = {
  key: string;
  label: string;
  rows: KeyRowView[];
};

const departments = ref<OrgDepartment[]>([]);
const hasDepartment = computed(() => departments.value.length > 0);

const keys = ref<KeyRow[]>([]);
const loading = ref(false);
const deletingId = ref<number | null>(null);
const copyingId = ref<number | null>(null);
const regeneratingId = ref<number | null>(null);

function protocolOrder(protocol: RelayProtocol): number {
  return relayProtocolOptions.findIndex((option) => option.value === protocol);
}

/** 部门做分组标题，组内按协议固定顺序；同部门同协议只有一把 Key 时不允许删除。 */
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
      const protocolCounts = new Map<RelayProtocol, number>();
      for (const row of rows) {
        protocolCounts.set(row.protocol, (protocolCounts.get(row.protocol) ?? 0) + 1);
      }
      return {
        key: groupKey,
        label: labelOf(rows),
        rows: rows.map((row) => ({
          ...row,
          deletable: (protocolCounts.get(row.protocol) ?? 0) > 1,
        })),
      };
    });
});

function getErrorMessage(error: unknown, fallback: string): string {
  const responseMessage = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function keyStatusLabel(status: string) {
  return status === "active" ? "正常" : status === "revoked" ? "已吊销" : status;
}

async function loadDepartments() {
  try {
    const { data } = await http.get("/api/me/org");
    if (data.success && Array.isArray(data.data?.departments) && data.data.departments.length > 0) {
      departments.value = data.data.departments;
      return;
    }
    const teams = Array.isArray(data.data?.teams) ? data.data.teams : [];
    departments.value = teams
      .filter((team: { isDefault?: boolean }) => team.isDefault !== false)
      .map((team: { id: number; departmentId?: number; departmentName?: string; name: string }) => ({
        id: team.departmentId ?? team.id,
        name: team.departmentName ?? team.name,
        path: team.departmentName ?? team.name,
        teamId: team.id,
      }));
  } catch {
    departments.value = [];
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
  if (data.success) keys.value = Array.isArray(data.data) ? data.data : [];
}

async function load() {
  loading.value = true;
  try {
    await loadDepartments();
    await provisionKeys();
    await loadKeys();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "加载 API Key 失败"));
  } finally {
    loading.value = false;
  }
}

async function copyKey(row: KeyRow) {
  if (!row.key) return;
  copyingId.value = row.id;
  try {
    const copied = await copyText(row.key);
    if (copied) {
      ElMessage.success("API Key 已复制");
    } else {
      ElMessage.error("复制失败，请手动选中 Key 文本复制");
    }
  } finally {
    copyingId.value = null;
  }
}

async function regenerateKey(row: KeyRow) {
  try {
    await ElMessageBox.confirm(
      `确认更新「${relayProtocolLabel(row.protocol, true)}」的 API Key（${row.keyPrefix}••••）？更新后立即换发新 Key，旧 Key 马上失效，正在使用的客户端需要改用新 Key。`,
      "更新 API Key",
      {
        type: "warning",
        confirmButtonText: "更新",
        cancelButtonText: "取消",
      },
    );
  } catch {
    return;
  }

  regeneratingId.value = row.id;
  try {
    await http.post(`/api/me/api-keys/${row.id}/regenerate`);
    ElMessage.success("API Key 已更新");
    await loadKeys();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "更新失败"));
  } finally {
    regeneratingId.value = null;
  }
}

async function removeKey(row: KeyRow) {
  const keyName = row.name.trim();

  try {
    await ElMessageBox.confirm(
      `确认删除 API Key「${keyName}」（${row.keyPrefix}••••）？删除后不可恢复，使用该 Key 的客户端将立即失效。`,
      "删除 API Key",
      {
        type: "warning",
        confirmButtonText: "继续",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      },
    );
  } catch {
    return;
  }

  try {
    await ElMessageBox.prompt(
      `删除不可恢复。请再次输入 Key 名称「${keyName}」以完成二次确认。`,
      "二次确认删除",
      {
        inputPlaceholder: "请输入 Key 名称",
        inputValidator: (value) =>
          value?.trim() === keyName ? true : "输入内容与 Key 名称不一致",
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      },
    );
  } catch {
    return;
  }

  deletingId.value = row.id;
  try {
    await http.delete(`/api/me/api-keys/${row.id}`);
    ElMessage.success("已删除");
    await loadKeys();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "删除失败"));
  } finally {
    deletingId.value = null;
  }
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
