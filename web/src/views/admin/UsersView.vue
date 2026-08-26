<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">员工管理</h2>
      <el-button v-if="auth.isOrgAdmin" type="primary" @click="openInvite">邀请已注册员工</el-button>
    </div>

    <el-form inline style="margin: 12px 0">
      <el-form-item>
        <el-input v-model="q" placeholder="姓名/手机号" clearable @clear="search" />
      </el-form-item>
      <el-form-item>
        <el-select v-model="statusFilter" placeholder="全部状态" clearable style="width: 120px" @change="search">
          <el-option label="待审核" value="pending" />
          <el-option label="正常" value="active" />
          <el-option label="已停用" value="disabled" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="auth.isSuperAdmin">
        <el-select
          v-model="enterpriseFilter"
          placeholder="全部企业"
          clearable
          style="width: 180px"
          @change="search"
        >
          <el-option
            v-for="item in enterprises"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">搜索</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="pagedRows" stripe>
      <el-table-column prop="name" label="姓名" width="120" />
      <el-table-column prop="phone" label="手机号" width="140" />
      <el-table-column label="所属团队" min-width="180">
        <template #default="{ row }">
          {{ row.teamName || "—" }}
        </template>
      </el-table-column>
      <el-table-column v-if="auth.isSuperAdmin" label="企业" min-width="140">
        <template #default="{ row }">
          {{ enterpriseName(row.enterpriseId) }}
        </template>
      </el-table-column>
      <el-table-column label="角色" width="120">
        <template #default="{ row }">
          {{ formatRoleLabel(row.role) }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag
            :type="row.status === 'active' ? 'success' : row.status === 'pending' ? 'warning' : 'danger'"
            size="small"
          >
            {{ statusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="最近登录" min-width="210">
        <template #default="{ row }">
          {{ formatDateTime(row.lastLoginAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="300">
        <template #default="{ row }">
          <template v-if="row.status === 'pending'">
            <el-button
              link
              type="success"
              :loading="approvingId === row.id"
              @click="approveRegistration(row)"
            >
              审核通过
            </el-button>
          </template>
          <template v-else>
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
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
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        background
        size="small"
        layout="total, prev, pager, next"
        :total="rows.length"
        :page-size="pageSize"
      />
    </div>

    <el-dialog v-model="showEdit" :title="`编辑用户 · ${editUser?.name || ''}`" width="480px">
      <el-form label-width="90px">
        <el-form-item label="姓名" required><el-input v-model="editForm.name" /></el-form-item>
        <el-form-item label="手机号" required><el-input v-model="editForm.phone" /></el-form-item>
        <el-form-item
          v-if="editForm.role !== 'admin' && editForm.role !== 'org_admin'"
          label="团队"
        >
          <el-select
            v-model="editForm.teamId"
            clearable
            placeholder="选择团队"
            style="width: 100%"
            :disabled="editForm.status !== 'active'"
          >
            <el-option v-for="item in teams" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="auth.isSuperAdmin" label="所属企业">
          <el-select v-model="editForm.enterpriseId" style="width: 100%">
            <el-option
              v-for="item in enterprises"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="auth.isSuperAdmin" label="角色">
          <el-select
            v-model="editForm.role"
            style="width: 100%"
            :disabled="editUser?.id === auth.user?.id || editForm.role === 'team_admin'"
          >
            <el-option label="员工" value="employee" />
            <el-option label="团队管理员" value="team_admin" disabled />
            <el-option label="企业管理员" value="org_admin" />
            <el-option label="超级管理员" value="admin" />
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

    <el-dialog v-model="showInvite" title="邀请已注册员工" width="480px">
      <el-form label-width="90px">
        <el-form-item label="手机号" required>
          <el-input v-model="invitePhone" placeholder="已注册用户的手机号" />
        </el-form-item>
        <el-form-item label="团队" required>
          <el-select v-model="inviteTeamId" style="width: 100%" placeholder="选择团队">
            <el-option v-for="item in teams" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="inviteRole" style="width: 100%">
            <el-option label="成员" value="member" />
            <el-option label="团队管理员" value="team_admin" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showInvite = false">取消</el-button>
        <el-button type="primary" :loading="inviting" @click="inviteMember">邀请</el-button>
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

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";
import { roleLabel as formatRoleLabel } from "@/lib/roles";
import { useAuthStore } from "@/stores/auth";

type UserRow = {
  id: number;
  name: string;
  phone: string;
  dept: string | null;
  role: "employee" | "admin" | "org_admin" | "team_admin";
  status: "pending" | "active" | "disabled";
  enterpriseId: number | null;
  createdAt: string;
  lastLoginAt: string | null;
  teamId?: number | null;
  teamName?: string | null;
};

type EnterpriseRow = { id: number; name: string; status: string };
type TeamRow = { id: number; name: string };

const rows = ref<UserRow[]>([]);
const page = ref(1);
const pageSize = 10;
const router = useRouter();
const auth = useAuthStore();
const q = ref("");
const statusFilter = ref<"" | UserRow["status"]>("");
const enterpriseFilter = ref<number | "">("");
const enterprises = ref<EnterpriseRow[]>([]);
const teams = ref<TeamRow[]>([]);
const showEdit = ref(false);
const showInvite = ref(false);
const showResetPassword = ref(false);
const updating = ref(false);
const inviting = ref(false);
const resetting = ref(false);
const invitePhone = ref("");
const inviteTeamId = ref<number | undefined>();
const inviteRole = ref<"member" | "team_admin">("member");
const approvingId = ref<number | null>(null);
const editUser = ref<UserRow | null>(null);
const resetUser = ref<UserRow | null>(null);
const resetForm = reactive({
  password: "",
  confirmPassword: "",
});
const editForm = reactive({
  name: "",
  phone: "",
  role: "employee" as UserRow["role"],
  status: "active" as UserRow["status"],
  enterpriseId: undefined as number | undefined,
  teamId: undefined as number | undefined,
});

const statusLabels: Record<UserRow["status"], string> = {
  pending: "待审核",
  active: "正常",
  disabled: "已停用",
};

const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize;
  return rows.value.slice(start, start + pageSize);
});

async function loadEnterprises() {
  if (!auth.isSuperAdmin) return;
  const { data } = await http.get("/api/admin/enterprises");
  if (data.success) enterprises.value = data.data;
}

async function loadTeams() {
  if (!auth.isOrgAdmin) return;
  const { data } = await http.get("/api/admin/teams");
  if (data.success) teams.value = data.data;
}

function openInvite() {
  invitePhone.value = "";
  inviteRole.value = "member";
  inviteTeamId.value = teams.value[0]?.id;
  showInvite.value = true;
}

async function inviteMember() {
  const phone = invitePhone.value.trim();
  if (phone.length < 5) {
    ElMessage.warning("请填写已注册用户的手机号");
    return;
  }
  if (!inviteTeamId.value) {
    ElMessage.warning("请先创建团队，再邀请员工入团");
    return;
  }
  inviting.value = true;
  try {
    const { data } = await http.post(`/api/admin/teams/${inviteTeamId.value}/members`, {
      phone,
      role: inviteRole.value,
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已邀请入团");
    showInvite.value = false;
    await load();
  } catch (e: unknown) {
    const message = (e as { response?: { data?: { message?: string } }; message?: string })
      .response?.data?.message;
    ElMessage.error(message || (e as Error).message || "邀请失败");
  } finally {
    inviting.value = false;
  }
}

function enterpriseName(id: number | null | undefined) {
  if (id == null) return "未加入企业";
  return enterprises.value.find((item) => item.id === id)?.name || String(id);
}

async function loadTeamNameMap() {
  const { data } = await http.get("/api/admin/teams");
  if (!data.success) return new Map<number, { teamId: number; teamName: string }>();
  const map = new Map<number, { teamId: number; teamName: string }>();
  await Promise.all(
    (data.data as TeamRow[]).map(async (team) => {
      try {
        const res = await http.get(`/api/admin/teams/${team.id}/members`);
        if (!res.data.success) return;
        for (const member of res.data.data as { employeeId: number }[]) {
          map.set(member.employeeId, { teamId: team.id, teamName: team.name });
        }
      } catch {
        // Ignore teams the current admin cannot read.
      }
    }),
  );
  return map;
}

async function load() {
  const { data } = await http.get("/api/admin/users", {
    params: {
      q: q.value || undefined,
      status: statusFilter.value || undefined,
      enterpriseId: enterpriseFilter.value || undefined,
      limit: 200,
    },
  });
  if (!data.success) return;
  const list = data.data as UserRow[];
  const hasTeamFromApi = list.some((row) => row.teamName != null);
  if (hasTeamFromApi) {
    rows.value = list;
  } else {
    const map = await loadTeamNameMap();
    rows.value = list.map((row) => {
      const membership = map.get(row.id);
      return {
        ...row,
        teamId: membership?.teamId ?? null,
        teamName: membership?.teamName ?? null,
      };
    });
  }
  const maxPage = Math.max(1, Math.ceil(rows.value.length / pageSize));
  if (page.value > maxPage) page.value = maxPage;
}

function search() {
  page.value = 1;
  void load();
}

function openDetail(row: UserRow) {
  router.push(`/admin/users/${row.id}`);
}

async function approveRegistration(row: UserRow) {
  try {
    await ElMessageBox.confirm(
      `确认审核通过 ${row.name} 的注册申请？账号将使用初始密码 Hz@123456，首次登录后需要修改密码。`,
      "审核通过",
      { confirmButtonText: "确认通过", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }

  approvingId.value = row.id;
  try {
    const { data } = await http.post(`/api/admin/users/${row.id}/approve`);
    if (!data.success) throw new Error(data.message);
    ElMessage.success("审核已通过，初始密码为 Hz@123456");
    await load();
  } catch (e: unknown) {
    const message = (e as { response?: { data?: { message?: string } } })
      .response?.data?.message;
    ElMessage.error(message || (e as Error).message || "审核失败");
  } finally {
    approvingId.value = null;
  }
}

function statusLabel(status: UserRow["status"]) {
  return statusLabels[status];
}

function openEdit(row: UserRow) {
  editUser.value = row;
  editForm.name = row.name;
  editForm.phone = row.phone;
  editForm.role = row.role;
  editForm.status = row.status;
  editForm.enterpriseId = row.enterpriseId ?? undefined;
  editForm.teamId = row.teamId ?? undefined;
  showEdit.value = true;
}

async function syncUserTeam(employeeId: number, fromTeamId: number | null | undefined, toTeamId: number | undefined) {
  const prev = fromTeamId ?? null;
  const next = toTeamId ?? null;
  if (prev === next) return;
  if (prev != null) {
    await http.delete(`/api/admin/teams/${prev}/members/${employeeId}`);
  }
  if (next != null) {
    const { data } = await http.post(`/api/admin/teams/${next}/members`, {
      employeeId,
      role: "member",
    });
    if (!data.success) throw new Error(data.message);
  }
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
      role: editForm.role,
      status: editForm.status,
      ...(auth.isSuperAdmin ? { enterpriseId: editForm.enterpriseId } : {}),
    });
    if (!data.success) throw new Error(data.message);
    if (editForm.role !== "admin" && editForm.role !== "org_admin") {
      await syncUserTeam(editUser.value.id, editUser.value.teamId, editForm.teamId);
    }
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

onMounted(async () => {
  await Promise.all([loadEnterprises(), loadTeams()]);
  await load();
});
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.self-edit-tip {
  margin: -8px 0 0 90px;
}

.muted {
  color: #94a3b8;
  font-size: 13px;
}

</style>
