<template>
  <div class="users-page">
    <div class="head">
      <h2 class="page-title" style="margin: 0">员工管理</h2>
      <el-button v-if="auth.isOrgAdmin" type="primary" @click="openInvite">邀请已注册员工</el-button>
    </div>

    <div class="split">
      <aside class="page-card team-pane">
        <div class="team-pane-title">团队</div>
        <button
          v-for="item in teamNav"
          :key="String(item.key)"
          type="button"
          class="team-item"
          :class="{ active: selectedKey === item.key }"
          @click="selectTeam(item.key)"
        >
          <span class="team-name">{{ item.name }}</span>
          <span class="team-meta">
            <el-badge v-if="item.pendingCount" :value="item.pendingCount" type="warning" />
            <span class="team-count">{{ item.count }}</span>
          </span>
        </button>
      </aside>

      <section class="page-card people-pane">
        <div class="people-head">
          <div>
            <h3 class="people-title">{{ currentGroupTitle }}</h3>
            <p class="muted">{{ filteredRows.length }} 人</p>
          </div>
        </div>

        <el-form inline class="filters" @submit.prevent>
          <el-form-item>
            <el-input v-model="q" placeholder="姓名/手机号" clearable />
          </el-form-item>
          <el-form-item>
            <el-select v-model="statusFilter" placeholder="全部状态" clearable style="width: 120px">
              <el-option label="待审核" value="pending" />
              <el-option label="正常" value="active" />
              <el-option label="已停用" value="disabled" />
            </el-select>
          </el-form-item>
        </el-form>

        <el-table :data="pagedRows" stripe :empty-text="emptyText">
          <el-table-column prop="name" label="姓名" width="120" />
          <el-table-column prop="phone" label="手机号" width="140" />
          <el-table-column v-if="selectedKey === UNASSIGNED_KEY" label="所属团队" min-width="160">
            <template #default>—</template>
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
            :total="filteredRows.length"
            :page-size="pageSize"
          />
        </div>
      </section>
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
            placeholder="选择本部门下的团队"
            style="width: 100%"
            :disabled="editForm.status !== 'active'"
          >
            <el-option
              v-for="item in editTeamOptions"
              :key="item.id"
              :label="teamLabel(item)"
              :value="item.id"
            />
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
        <el-form-item label="角色">
          <el-select
            v-model="editForm.role"
            style="width: 100%"
            :disabled="
              editUser?.id === auth.user?.id ||
              editForm.role === 'org_admin' ||
              editForm.role === 'admin'
            "
          >
            <el-option label="员工" value="employee" />
            <el-option label="团队管理员" value="team_admin" />
            <el-option v-if="auth.isSuperAdmin" label="企业管理员" value="org_admin" />
            <el-option v-if="auth.isSuperAdmin" label="超级管理员" value="admin" />
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
            <el-option v-for="item in teams" :key="item.id" :label="teamLabel(item)" :value="item.id" />
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

    <EmployeeUsageDrawer v-model="showDetail" :employee="detailEmployee" />

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
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";
import { roleLabel as formatRoleLabel } from "@/lib/roles";
import { useAuthStore } from "@/stores/auth";
import EmployeeUsageDrawer from "./EmployeeUsageDrawer.vue";

const UNASSIGNED_KEY = "unassigned" as const;
type TeamNavKey = number | typeof UNASSIGNED_KEY;

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
type TeamRow = {
  id: number;
  name: string;
  departmentId?: number;
  departmentName?: string;
  isDefault?: boolean;
};
type TeamNavItem = {
  key: TeamNavKey;
  name: string;
  count: number;
  pendingCount: number;
};

const rows = ref<UserRow[]>([]);
const page = ref(1);
const pageSize = 10;
const auth = useAuthStore();
const q = ref("");
const statusFilter = ref<"" | UserRow["status"]>("");
const enterprises = ref<EnterpriseRow[]>([]);
const teams = ref<TeamRow[]>([]);
const selectedKey = ref<TeamNavKey>(UNASSIGNED_KEY);
const showEdit = ref(false);
const showInvite = ref(false);
const showResetPassword = ref(false);
const showDetail = ref(false);
const detailEmployee = ref<UserRow | null>(null);
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

function teamLabel(team: TeamRow) {
  return team.isDefault ? `${team.departmentName || "部门"}（未拆团队）` : team.name;
}

const editTeamOptions = computed(() => {
  const current = teams.value.find((team) => team.id === editUser.value?.teamId);
  if (current?.departmentId == null) return teams.value;
  return teams.value.filter((team) => team.departmentId === current.departmentId);
});

const teamNav = computed<TeamNavItem[]>(() => {
  const counts = new Map<number, { count: number; pendingCount: number }>();
  let unassignedCount = 0;
  let unassignedPending = 0;
  for (const row of rows.value) {
    if (row.teamId == null) {
      unassignedCount += 1;
      if (row.status === "pending") unassignedPending += 1;
      continue;
    }
    const current = counts.get(row.teamId) ?? { count: 0, pendingCount: 0 };
    current.count += 1;
    if (row.status === "pending") current.pendingCount += 1;
    counts.set(row.teamId, current);
  }
  const items: TeamNavItem[] = teams.value.map((team) => {
    const current = counts.get(team.id) ?? { count: 0, pendingCount: 0 };
    return {
      key: team.id,
      name: teamLabel(team),
      count: current.count,
      pendingCount: current.pendingCount,
    };
  });
  items.push({
    key: UNASSIGNED_KEY,
    name: "未加入团队",
    count: unassignedCount,
    pendingCount: unassignedPending,
  });
  return items;
});

const groupRows = computed(() => {
  if (selectedKey.value === UNASSIGNED_KEY) {
    return rows.value.filter((row) => row.teamId == null);
  }
  return rows.value.filter((row) => row.teamId === selectedKey.value);
});

const filteredRows = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return groupRows.value.filter((row) => {
    if (statusFilter.value && row.status !== statusFilter.value) return false;
    if (!needle) return true;
    return row.name.toLowerCase().includes(needle) || row.phone.includes(needle);
  });
});

const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize;
  return filteredRows.value.slice(start, start + pageSize);
});

const currentGroupTitle = computed(() => {
  if (selectedKey.value === UNASSIGNED_KEY) return "未加入团队";
  const team = teams.value.find((row) => row.id === selectedKey.value);
  return team ? teamLabel(team) : "员工";
});

const emptyText = computed(() => {
  if (filteredRows.value.length === 0 && (q.value.trim() || statusFilter.value)) {
    return "没有符合筛选条件的员工";
  }
  return selectedKey.value === UNASSIGNED_KEY ? "没有未加入团队的员工" : "该团队暂无员工";
});

watch([selectedKey, q, statusFilter], () => {
  page.value = 1;
});

function selectTeam(key: TeamNavKey) {
  selectedKey.value = key;
}

function ensureSelection() {
  const valid = new Set(teamNav.value.map((item) => item.key));
  if (valid.has(selectedKey.value)) return;
  selectedKey.value = teams.value[0]?.id ?? UNASSIGNED_KEY;
}

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
  inviteTeamId.value = typeof selectedKey.value === "number" ? selectedKey.value : undefined;
  showInvite.value = true;
}

async function inviteMember() {
  const phone = invitePhone.value.trim();
  if (phone.length < 5) {
    ElMessage.warning("请填写已注册用户的手机号");
    return;
  }
  if (!inviteTeamId.value) {
    ElMessage.warning(teams.value.length ? "请选择要加入的团队" : "请先创建团队，再邀请员工入团队");
    return;
  }
  inviting.value = true;
  try {
    const { data } = await http.post(`/api/admin/teams/${inviteTeamId.value}/members`, {
      phone,
      role: inviteRole.value,
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已邀请进团队");
    showInvite.value = false;
    selectedKey.value = inviteTeamId.value;
    await load();
  } catch (e: unknown) {
    const message = (e as { response?: { data?: { message?: string } }; message?: string })
      .response?.data?.message;
    ElMessage.error(message || (e as Error).message || "邀请失败");
  } finally {
    inviting.value = false;
  }
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
    params: { limit: 200 },
  });
  if (!data.success) return;
  const list = (data.data as UserRow[]).filter(
    (row) => row.role !== "org_admin" && row.role !== "admin",
  );
  const hasTeamFromApi = list.some((row) => row.teamName != null || row.teamId != null);
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
  ensureSelection();
  const maxPage = Math.max(1, Math.ceil(filteredRows.value.length / pageSize));
  if (page.value > maxPage) page.value = maxPage;
}

function openDetail(row: UserRow) {
  detailEmployee.value = row;
  showDetail.value = true;
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

async function syncUserTeam(
  employeeId: number,
  fromTeamId: number | null | undefined,
  toTeamId: number | undefined,
  teamRole: "member" | "team_admin" = "member",
) {
  const prev = fromTeamId ?? null;
  const next = toTeamId ?? null;
  if (prev != null && prev !== next) {
    await http.delete(`/api/admin/teams/${prev}/members/${employeeId}`);
  }
  if (next == null) return;
  if (prev === next) {
    await http.patch(`/api/admin/teams/${next}/members/${employeeId}`, { role: teamRole });
    return;
  }
  try {
    const { data } = await http.post(`/api/admin/teams/${next}/members`, {
      employeeId,
      role: teamRole,
    });
    if (!data.success) throw new Error(data.message);
  } catch (error: unknown) {
    const response = (error as { response?: { status?: number; data?: { message?: string } } })
      .response;
    const alreadyHere =
      response?.status === 409 && response.data?.message === "该员工已在团队中";
    if (!alreadyHere) throw error;
    await http.patch(`/api/admin/teams/${next}/members/${employeeId}`, { role: teamRole });
  }
}

async function updateUser() {
  if (!editUser.value) return;
  if (!editForm.name.trim() || !editForm.phone.trim()) {
    ElMessage.warning("请填写姓名和手机号");
    return;
  }

  if (editForm.role === "team_admin" && !editForm.teamId) {
    ElMessage.warning("团队管理员必须选择所属团队");
    return;
  }

  updating.value = true;
  try {
    const teamChanged = (editUser.value.teamId ?? null) !== (editForm.teamId ?? null);
    const roleChanged = editUser.value.role !== editForm.role;
    if (teamChanged || roleChanged) {
      if (editForm.role === "org_admin" || editForm.role === "admin") {
        await syncUserTeam(editUser.value.id, editUser.value.teamId, undefined);
      } else {
        await syncUserTeam(
          editUser.value.id,
          editUser.value.teamId,
          editForm.teamId,
          editForm.role === "team_admin" ? "team_admin" : "member",
        );
      }
    }
    const { data } = await http.patch(`/api/admin/users/${editUser.value.id}`, {
      name: editForm.name.trim(),
      phone: editForm.phone.trim(),
      status: editForm.status,
      ...(auth.isSuperAdmin
        ? { enterpriseId: editForm.enterpriseId, role: editForm.role }
        : {}),
    });
    if (!data.success) throw new Error(data.message);
    if (editUser.value.id === auth.user?.id) await auth.fetchMe();
    ElMessage.success("用户信息已更新");
    showEdit.value = false;
    if (editForm.role === "org_admin" || editForm.role === "admin" || !editForm.teamId) {
      selectedKey.value = UNASSIGNED_KEY;
    } else {
      selectedKey.value = editForm.teamId;
    }
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
  selectedKey.value = teams.value[0]?.id ?? UNASSIGNED_KEY;
  await load();
});
</script>

<style scoped>
.users-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: calc(100vh - 100px);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.split {
  display: flex;
  flex: 1;
  gap: 16px;
  min-height: 480px;
  align-items: stretch;
}

.team-pane,
.people-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.team-pane {
  width: 260px;
  flex-shrink: 0;
  padding: 16px 12px;
}

.people-pane {
  flex: 1;
  min-width: 0;
}

.team-pane-title {
  margin: 0 8px 10px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.team-item {
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

.team-item:hover {
  background: #f3f4f6;
}

.team-item.active {
  background: #eff6ff;
  color: #1d4ed8;
}

.team-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.team-meta {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}

.team-count {
  color: #6b7280;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.team-item.active .team-count {
  color: #2563eb;
}

.people-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 4px;
}

.people-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.filters {
  margin: 8px 0 4px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.self-edit-tip {
  margin: -8px 0 0 90px;
}

@media (max-width: 900px) {
  .split {
    flex-direction: column;
    min-height: 0;
  }

  .team-pane {
    width: 100%;
    max-height: 240px;
    overflow: auto;
  }
}
</style>
