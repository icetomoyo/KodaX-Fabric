<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">员工管理</h2>
      <div>
        <el-button @click="showImport = true">批量导入</el-button>
        <el-button type="primary" @click="openCreate">新建员工</el-button>
      </div>
    </div>

    <el-form inline style="margin: 12px 0">
      <el-form-item>
        <el-input v-model="q" placeholder="姓名/手机号" clearable @clear="load" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="load">搜索</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="rows" stripe>
      <el-table-column prop="name" label="姓名" width="120" />
      <el-table-column prop="phone" label="手机号" width="140" />
      <el-table-column prop="dept" label="部门" width="120" />
      <el-table-column label="角色" width="100">
        <template #default="{ row }">
          {{ roleLabel(row.role) }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          {{ statusLabel(row.status) }}
        </template>
      </el-table-column>
      <el-table-column prop="mustChangePassword" label="待改密" width="90">
        <template #default="{ row }">
          {{ row.mustChangePassword ? "是" : "否" }}
        </template>
      </el-table-column>
      <el-table-column label="最近登录" min-width="210">
        <template #default="{ row }">
          {{ formatDateTime(row.lastLoginAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="340">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-tooltip
            v-if="row.role === 'employee'"
            :content="apiKeyAvailabilityHint(row)"
            :disabled="!apiKeyAvailabilityHint(row)"
            placement="top"
          >
            <el-button
              link
              type="primary"
              :loading="copyingKeyUserId === row.id"
              :disabled="copyingKeyUserId !== null && copyingKeyUserId !== row.id"
              @click="copyEmployeeApiKey(row)"
            >
              复制 Key
            </el-button>
          </el-tooltip>
          <el-button
            v-if="row.id !== auth.user?.id"
            link
            type="warning"
            @click="openResetPassword(row)"
          >
            重置密码
          </el-button>
          <el-button
            v-if="row.id !== auth.user?.id && row.status === 'active'"
            link
            type="danger"
            @click="setStatus(row.id, 'disabled')"
          >
            停用
          </el-button>
          <el-button
            v-else-if="row.id !== auth.user?.id"
            link
            type="primary"
            @click="setStatus(row.id, 'active')"
          >
            启用
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showCreate" title="新建员工" width="480px">
      <el-form label-width="90px">
        <el-form-item label="姓名"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="手机号"><el-input v-model="form.phone" /></el-form-item>
        <el-form-item label="初始密码">
          <el-input v-model="form.password" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <el-form-item label="部门"><el-input v-model="form.dept" /></el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" style="width: 100%">
            <el-option label="员工" value="employee" />
            <el-option label="管理员" value="admin" />
            <el-option label="审计员" value="auditor" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="createOne">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEdit" :title="`编辑用户 · ${editUser?.name || ''}`" width="480px">
      <el-form label-width="90px">
        <el-form-item label="姓名" required><el-input v-model="editForm.name" /></el-form-item>
        <el-form-item label="手机号" required><el-input v-model="editForm.phone" /></el-form-item>
        <el-form-item label="部门"><el-input v-model="editForm.dept" /></el-form-item>
        <el-form-item label="角色">
          <el-select
            v-model="editForm.role"
            style="width: 100%"
            :disabled="editUser?.id === auth.user?.id"
          >
            <el-option label="员工" value="employee" />
            <el-option label="管理员" value="admin" />
            <el-option label="审计员" value="auditor" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select
            v-model="editForm.status"
            style="width: 100%"
            :disabled="editUser?.id === auth.user?.id"
          >
            <el-option label="正常" value="active" />
            <el-option label="已停用" value="disabled" />
          </el-select>
        </el-form-item>
        <p v-if="editUser?.id === auth.user?.id" class="muted self-edit-tip">
          当前账号不能在此修改角色或状态。
        </p>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" :loading="updating" @click="updateUser">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showResetPassword"
      :title="`重置密码 · ${resetUser?.name || ''}`"
      width="480px"
      destroy-on-close
    >
      <el-form label-width="100px">
        <el-form-item label="临时密码" required>
          <el-input
            v-model="resetForm.password"
            type="password"
            show-password
            autocomplete="new-password"
          />
        </el-form-item>
        <el-form-item label="确认密码" required>
          <el-input
            v-model="resetForm.confirmPassword"
            type="password"
            show-password
            autocomplete="new-password"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showResetPassword = false">取消</el-button>
        <el-button type="primary" :loading="resetting" @click="resetPassword">确认重置</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showImport" title="批量导入 JSON" width="640px">
      <el-input
        v-model="importText"
        type="textarea"
        :rows="10"
        placeholder='[{"name":"","phone":"","password":"","dept":"","role":"employee"}]'
      />
      <template #footer>
        <el-button @click="showImport = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="doImport">导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";
import { useAuthStore } from "@/stores/auth";

type UserRow = {
  id: number;
  name: string;
  phone: string;
  dept: string | null;
  role: "employee" | "admin" | "auditor";
  status: "active" | "disabled";
  mustChangePassword: boolean;
  lastLoginAt: string | null;
};

const rows = ref<UserRow[]>([]);
const auth = useAuthStore();
const q = ref("");
const showCreate = ref(false);
const showImport = ref(false);
const showEdit = ref(false);
const showResetPassword = ref(false);
const saving = ref(false);
const importing = ref(false);
const updating = ref(false);
const resetting = ref(false);
const copyingKeyUserId = ref<number | null>(null);
const editUser = ref<UserRow | null>(null);
const resetUser = ref<UserRow | null>(null);
const importText = ref("");
const form = reactive({
  name: "",
  phone: "",
  password: "",
  dept: "",
  role: "employee" as "employee" | "admin" | "auditor",
});
const resetForm = reactive({
  password: "",
  confirmPassword: "",
});
const editForm = reactive({
  name: "",
  phone: "",
  dept: "",
  role: "employee" as UserRow["role"],
  status: "active" as UserRow["status"],
});

const roleLabels: Record<UserRow["role"], string> = {
  employee: "员工",
  admin: "管理员",
  auditor: "审计员",
};
const statusLabels: Record<UserRow["status"], string> = {
  active: "正常",
  disabled: "已停用",
};

async function load() {
  const { data } = await http.get("/api/admin/users", { params: { q: q.value || undefined } });
  if (data.success) rows.value = data.data;
}

function openCreate() {
  form.name = "";
  form.phone = "";
  form.password = "";
  form.dept = "";
  form.role = "employee";
  showCreate.value = true;
}

async function createOne() {
  saving.value = true;
  try {
    const { data } = await http.post("/api/admin/users", form);
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已创建");
    showCreate.value = false;
    await load();
  } catch (e: unknown) {
    const msg =
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
      (e as Error).message;
    ElMessage.error(msg);
  } finally {
    saving.value = false;
  }
}

async function doImport() {
  importing.value = true;
  try {
    const users = JSON.parse(importText.value);
    const { data } = await http.post("/api/admin/users/import", { users });
    if (!data.success) throw new Error(data.message);
    ElMessage.success(`成功 ${data.data.success}，失败 ${data.data.failed}`);
    showImport.value = false;
    await load();
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || "导入失败");
  } finally {
    importing.value = false;
  }
}

function roleLabel(role: UserRow["role"]) {
  return roleLabels[role];
}

function statusLabel(status: UserRow["status"]) {
  return statusLabels[status];
}

function apiKeyAvailabilityHint(row: UserRow) {
  const hints: string[] = [];
  if (row.status === "disabled") {
    hints.push("账号已停用，Key 在启用账号前暂不可用");
  }
  if (row.mustChangePassword) {
    hints.push("员工尚待改密，Key 在完成改密前暂不可用");
  }
  return hints.join("；");
}

type ApiKeyResponse = {
  success?: boolean;
  data?: { key?: unknown };
  message?: string;
};

type ApiRequestError = {
  message?: string;
  response?: {
    status?: number;
    data?: {
      code?: string;
      message?: string;
    };
  };
};

function extractApiKey(payload: unknown) {
  const response = payload as ApiKeyResponse;
  if (response.success !== true) {
    throw new Error(response.message || "获取 Key 失败");
  }
  if (typeof response.data?.key !== "string" || !response.data.key) {
    throw new Error("接口未返回有效的 Key");
  }
  return response.data.key;
}

function keyCreationReason(error: unknown) {
  const response = (error as ApiRequestError)?.response;
  if (response?.status !== 404) return null;

  if (response.data?.code === "key_not_recoverable") {
    return "现有活跃 Key 的明文无法恢复";
  }
  if (response.data?.code === "api_key_not_found") {
    return "该员工当前没有活跃 Key";
  }
  return null;
}

function requestErrorMessage(error: unknown, fallback: string) {
  const requestError = error as ApiRequestError;
  return requestError.response?.data?.message || requestError.message || fallback;
}

function isMessageBoxCancel(error: unknown) {
  return error === "cancel" || error === "close";
}

async function copyEmployeeApiKey(row: UserRow) {
  if (copyingKeyUserId.value !== null) return;

  copyingKeyUserId.value = row.id;
  let apiKey = "";
  let created = false;

  try {
    try {
      apiKey = extractApiKey(
        (await http.post(`/api/admin/users/${row.id}/api-key/reveal`)).data,
      );
    } catch (error: unknown) {
      const creationReason = keyCreationReason(error);
      if (!creationReason) throw error;

      const availabilityHint = apiKeyAvailabilityHint(row);
      try {
        await ElMessageBox.confirm(
          `${creationReason}。是否为“${row.name}”生成一个专用 Key 并复制？` +
            "新 Key 将加密托管，管理员以后仍可在此复制；请勿通过聊天或日志传播。" +
            (availabilityHint ? ` ${availabilityHint}。` : ""),
          "生成员工专用 Key",
          {
            type: "warning",
            confirmButtonText: "生成并复制",
            cancelButtonText: "取消",
            distinguishCancelAndClose: true,
          },
        );
      } catch (error: unknown) {
        if (isMessageBoxCancel(error)) return;
        throw error;
      }

      apiKey = extractApiKey(
        (await http.post(`/api/admin/users/${row.id}/api-key`)).data,
      );
      created = true;
    }

    try {
      await navigator.clipboard.writeText(apiKey);
    } catch {
      ElMessage.error(
        created
          ? "专用 Key 已生成，但复制失败；请检查剪贴板权限后再次点击复制"
          : "复制失败，请检查剪贴板权限后重试",
      );
      return;
    } finally {
      apiKey = "";
    }

    const availabilityHint = apiKeyAvailabilityHint(row);
    ElMessage({
      type: "success",
      message:
        (created
          ? "专用 Key 已生成并复制，以后仍可在此复制；请勿通过聊天或日志传播"
          : "Key 已复制") + (availabilityHint ? `。${availabilityHint}` : ""),
      duration: created || availabilityHint ? 6000 : 3000,
      showClose: created || Boolean(availabilityHint),
    });
  } catch (error: unknown) {
    ElMessage.error(requestErrorMessage(error, "获取 Key 失败"));
  } finally {
    apiKey = "";
    copyingKeyUserId.value = null;
  }
}

function openEdit(row: UserRow) {
  editUser.value = row;
  editForm.name = row.name;
  editForm.phone = row.phone;
  editForm.dept = row.dept ?? "";
  editForm.role = row.role;
  editForm.status = row.status;
  showEdit.value = true;
}

async function updateUser() {
  if (!editUser.value) return;
  if (!editForm.name.trim() || !editForm.phone.trim()) {
    ElMessage.warning("请填写姓名和手机号");
    return;
  }

  updating.value = true;
  try {
    const { data } = await http.patch(`/api/admin/users/${editUser.value.id}`, {
      name: editForm.name.trim(),
      phone: editForm.phone.trim(),
      dept: editForm.dept.trim() || null,
      role: editForm.role,
      status: editForm.status,
    });
    if (!data.success) throw new Error(data.message);
    if (editUser.value.id === auth.user?.id) await auth.fetchMe();
    ElMessage.success("用户信息已更新");
    showEdit.value = false;
    await load();
  } catch (e: unknown) {
    const message = (e as { response?: { data?: { message?: string } } })
      .response?.data?.message;
    ElMessage.error(message || (e as Error).message || "更新失败");
  } finally {
    updating.value = false;
  }
}

function openResetPassword(row: UserRow) {
  resetUser.value = row;
  resetForm.password = "";
  resetForm.confirmPassword = "";
  showResetPassword.value = true;
}

async function resetPassword() {
  if (!resetUser.value) return;
  if (resetForm.password.length < 8) {
    ElMessage.warning("密码至少 8 位");
    return;
  }
  if (resetForm.password !== resetForm.confirmPassword) {
    ElMessage.warning("两次密码不一致");
    return;
  }

  resetting.value = true;
  try {
    await http.post(`/api/admin/users/${resetUser.value.id}/reset-password`, {
      password: resetForm.password,
    });
    ElMessage.success("密码已重置");
    showResetPassword.value = false;
    await load();
  } catch (e: unknown) {
    const message = (e as { response?: { data?: { message?: string } } })
      .response?.data?.message;
    ElMessage.error(message || "重置失败");
  } finally {
    resetting.value = false;
  }
}

async function setStatus(id: number, status: "active" | "disabled") {
  await http.patch(`/api/admin/users/${id}/status`, { status });
  ElMessage.success("已更新");
  await load();
}

onMounted(load);
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.self-edit-tip {
  margin: -8px 0 0 90px;
}
</style>
