<template>
  <div class="org-page">
    <section class="page-card org-shell">
      <div class="page-head">
        <div>
          <h2 class="page-title">企业管理</h2>
          <p class="page-subtitle">企业 → 团队 → 员工，每张卡片都可以直接操作</p>
        </div>
        <div class="head-actions">
          <el-button :loading="loading" @click="refreshAll">刷新</el-button>
          <el-button type="primary" @click="openCreateEnterprise">新建企业</el-button>
        </div>
      </div>

      <div v-loading="loading" class="split-layout">
        <aside class="list-pane">
          <div class="pane-label">
            <span>企业列表</span>
            <span class="pane-count">{{ enterprises.length }}</span>
          </div>
          <el-empty
            v-if="!loading && !enterprises.length"
            description="暂无企业"
            :image-size="72"
          >
            <el-button type="primary" @click="openCreateEnterprise">新建企业</el-button>
          </el-empty>
          <div v-else class="card-list">
            <button
              v-for="item in enterprises"
              :key="item.id"
              type="button"
              class="nav-card"
              :class="{ selected: selectedEnterpriseId === item.id }"
              @click="selectEnterprise(item.id)"
            >
              <div class="nav-card-top">
                <strong>{{ item.name }}</strong>
                <el-tag
                  :type="statusTagType(item.status)"
                  size="small"
                  effect="light"
                >
                  {{ statusLabel(item.status) }}
                </el-tag>
              </div>
              <div class="nav-card-bottom">
                <span class="mono">{{ item.code }}</span>
                <span>{{ teamCount(item.id) }} 个团队</span>
              </div>
              <div class="nav-card-meta">
                {{ item.contact ? `${item.contact.name} · ${item.contact.phone}` : "暂无企业管理员" }}
              </div>
            </button>
          </div>
        </aside>

        <main class="detail-pane">
          <template v-if="selectedEnterprise">
            <div class="detail-header">
              <div class="detail-copy">
                <h3 class="detail-title">{{ selectedEnterprise.name }}</h3>
                <p class="detail-subtitle">
                  编号 {{ selectedEnterprise.code }}
                  · {{ statusLabel(selectedEnterprise.status) }}
                  · {{ formatDateTime(selectedEnterprise.createdAt) }}
                </p>
              </div>
              <div class="detail-actions">
                <el-button @click="openEditEnterprise(selectedEnterprise)">编辑</el-button>
                <el-button
                  v-if="selectedEnterprise.status === 'pending'"
                  type="success"
                  :loading="approvingId === selectedEnterprise.id"
                  @click="approveEnterprise(selectedEnterprise)"
                >
                  审核通过
                </el-button>
                <el-button
                  v-else-if="selectedEnterprise.status === 'active'"
                  type="danger"
                  plain
                  @click="setEnterpriseStatus(selectedEnterprise, 'disabled')"
                >
                  停用
                </el-button>
                <el-button
                  v-else
                  type="primary"
                  @click="setEnterpriseStatus(selectedEnterprise, 'active')"
                >
                  启用
                </el-button>
                <el-button type="primary" @click="openCreateTeam">新建团队</el-button>
              </div>
            </div>

            <section class="board-section">
              <div class="section-head">
                <h4>团队（{{ teams.length }}）</h4>
              </div>
              <el-empty
                v-if="!teams.length"
                description="该企业还没有团队"
                :image-size="56"
              >
                <el-button type="primary" @click="openCreateTeam">新建团队</el-button>
              </el-empty>
              <div v-else class="card-grid">
                <article
                  v-for="team in teams"
                  :key="team.id"
                  class="unit-card"
                  :class="{ selected: selectedTeamId === team.id }"
                  @click="selectTeam(team.id)"
                >
                  <div class="unit-card-main">
                    <strong>{{ team.name }}</strong>
                    <el-tag :type="team.status === 'active' ? 'success' : 'danger'" size="small" effect="light">
                      {{ team.status === "active" ? "正常" : "已停用" }}
                    </el-tag>
                  </div>
                  <div class="unit-card-meta">
                    <span>{{ team.memberCount }} 人</span>
                    <span>今日 {{ formatTokenCompact(team.todayTotalTokens) }}</span>
                    <span>本月 {{ formatTokenCompact(team.monthTotalTokens) }}</span>
                  </div>
                  <div class="unit-card-actions" @click.stop>
                    <el-button link type="primary" size="small" @click="openEditTeam(team)">编辑</el-button>
                    <el-button
                      v-if="team.status === 'active'"
                      link
                      type="danger"
                      size="small"
                      @click="setTeamStatus(team, 'disabled')"
                    >
                      停用
                    </el-button>
                    <el-button v-else link type="primary" size="small" @click="setTeamStatus(team, 'active')">
                      启用
                    </el-button>
                  </div>
                </article>
              </div>
            </section>

            <section class="board-section">
              <div class="section-head">
                <h4>{{ employeeSectionTitle }}（{{ visibleEmployees.length }}）</h4>
                <el-button type="primary" size="small" @click="openInvite">邀请已注册员工</el-button>
              </div>
              <el-empty
                v-if="!visibleEmployees.length"
                :description="selectedTeamId ? '该团队暂无员工' : '没有未加入团队的员工'"
                :image-size="56"
              />
              <div v-else class="card-grid people-grid">
                <article v-for="person in visibleEmployees" :key="person.id" class="unit-card person-card">
                  <div class="unit-card-main">
                    <strong>{{ person.name }}</strong>
                    <el-tag :type="statusTagType(person.status)" size="small" effect="light">
                      {{ statusLabel(person.status) }}
                    </el-tag>
                  </div>
                  <div class="unit-card-meta">
                    <span>{{ person.phone }}</span>
                    <span>{{ roleLabel(person.role) }}</span>
                    <span v-if="person.teamName">{{ person.teamName }}</span>
                  </div>
                  <div class="unit-card-actions">
                    <template v-if="person.status === 'pending'">
                      <el-button
                        link
                        type="success"
                        size="small"
                        :loading="approvingUserId === person.id"
                        @click="approveUser(person)"
                      >
                        审核通过
                      </el-button>
                    </template>
                    <template v-else>
                      <el-button link type="primary" size="small" @click="openUserDetail(person)">详情</el-button>
                      <el-button link type="primary" size="small" @click="openEditUser(person)">编辑</el-button>
                      <el-button
                        v-if="person.role !== 'org_admin' && person.teamId"
                        link
                        type="primary"
                        size="small"
                        @click="toggleTeamAdmin(person)"
                      >
                        {{ person.teamRole === "team_admin" ? "取消团队管理" : "设为团队管理" }}
                      </el-button>
                      <el-button
                        v-if="person.teamId"
                        link
                        type="warning"
                        size="small"
                        @click="removeFromTeam(person)"
                      >
                        移出团队
                      </el-button>
                      <el-button link type="warning" size="small" @click="openResetPassword(person)">
                        重置密码
                      </el-button>
                      <el-button
                        v-if="person.status === 'active'"
                        link
                        type="danger"
                        size="small"
                        @click="setUserStatus(person, 'disabled')"
                      >
                        停用
                      </el-button>
                      <el-button v-else link type="primary" size="small" @click="setUserStatus(person, 'active')">
                        启用
                      </el-button>
                    </template>
                  </div>
                </article>
              </div>
            </section>
          </template>
          <el-empty
            v-else-if="!loading"
            class="detail-empty"
            :description="enterprises.length ? '请从左侧选择一个企业' : '暂无企业'"
            :image-size="96"
          />
        </main>
      </div>
    </section>

    <el-dialog v-model="showCreateEnterprise" title="新建企业" width="440px">
      <el-form label-width="90px">
        <el-form-item label="企业名称" required>
          <el-input v-model="createEnterpriseName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateEnterprise = false">取消</el-button>
        <el-button type="primary" :loading="savingEnterprise" @click="createEnterprise">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEditEnterprise" :title="`编辑企业 · ${editEnterprise?.name || ''}`" width="440px">
      <el-form label-width="90px">
        <el-form-item label="企业名称" required>
          <el-input v-model="editEnterpriseName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditEnterprise = false">取消</el-button>
        <el-button type="primary" :loading="updatingEnterprise" @click="updateEnterprise">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showCreateTeam" title="新建团队" width="440px">
      <el-form label-width="90px">
        <el-form-item label="所属企业">
          <el-input :model-value="selectedEnterprise?.name" disabled />
        </el-form-item>
        <el-form-item label="团队名称" required>
          <el-input v-model="createTeamName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateTeam = false">取消</el-button>
        <el-button type="primary" :loading="savingTeam" @click="createTeam">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEditTeam" :title="`编辑团队 · ${editTeam?.name || ''}`" width="440px">
      <el-form label-width="90px">
        <el-form-item label="团队名称" required>
          <el-input v-model="editTeamName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditTeam = false">取消</el-button>
        <el-button type="primary" :loading="updatingTeam" @click="updateTeam">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showInvite" title="邀请已注册员工" width="480px">
      <el-form label-width="90px">
        <el-form-item label="手机号" required>
          <el-input v-model="invitePhone" placeholder="已注册用户的手机号" />
        </el-form-item>
        <el-form-item label="加入团队" required>
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
        <p class="form-help">不能新建账号。对方必须已自行注册，邀请进团队后才有员工权限。</p>
      </el-form>
      <template #footer>
        <el-button @click="showInvite = false">取消</el-button>
        <el-button type="primary" :loading="inviting" @click="inviteMember">邀请</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEditUser" :title="`编辑员工 · ${editUser?.name || ''}`" width="480px">
      <el-form label-width="90px">
        <el-form-item label="姓名" required><el-input v-model="editUserForm.name" /></el-form-item>
        <el-form-item label="手机号" required><el-input v-model="editUserForm.phone" /></el-form-item>
        <el-form-item v-if="editUserForm.role !== 'org_admin'" label="团队">
          <el-select v-model="editUserForm.teamId" clearable placeholder="选择团队" style="width: 100%">
            <el-option v-for="item in teams" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="editUserForm.role" style="width: 100%">
            <el-option label="员工" value="employee" />
            <el-option label="团队管理员" value="team_admin" />
            <el-option label="企业管理员" value="org_admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="editUserForm.status" style="width: 100%">
            <el-option label="正常" value="active" />
            <el-option label="已停用" value="disabled" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditUser = false">取消</el-button>
        <el-button type="primary" :loading="updatingUser" @click="updateUser">保存</el-button>
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
          <el-input v-model="resetForm.password" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <el-form-item label="确认密码" required>
          <el-input v-model="resetForm.confirmPassword" type="password" show-password autocomplete="new-password" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showResetPassword = false">取消</el-button>
        <el-button type="primary" :loading="resetting" @click="resetPassword">确认重置</el-button>
      </template>
    </el-dialog>

    <EmployeeUsageDrawer v-model="showUserDetail" :employee="detailEmployee" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";
import { roleLabel } from "@/lib/roles";
import { formatTokenCompact } from "@/lib/tokens";
import EmployeeUsageDrawer from "./EmployeeUsageDrawer.vue";

type EnterpriseStatus = "pending" | "active" | "disabled";
type UserStatus = "pending" | "active" | "disabled";
type UserRole = "employee" | "admin" | "org_admin" | "team_admin";

type EnterpriseRow = {
  id: number;
  name: string;
  code: string;
  status: EnterpriseStatus;
  createdAt: string;
  contact: { employeeId: number; name: string; phone: string; role: string } | null;
};

type TeamRow = {
  id: number;
  name: string;
  status: "active" | "disabled";
  enterpriseId: number;
  memberCount: number;
  todayTotalTokens: number;
  monthTotalTokens: number;
};

type EmployeeRow = {
  id: number;
  name: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  enterpriseId: number | null;
  teamId: number | null;
  teamName: string | null;
  teamRole: "member" | "team_admin" | null;
  lastLoginAt: string | null;
};

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const enterprises = ref<EnterpriseRow[]>([]);
const teams = ref<TeamRow[]>([]);
const employees = ref<EmployeeRow[]>([]);
const teamCounts = ref<Record<number, number>>({});
const selectedEnterpriseId = ref<number | null>(null);
const selectedTeamId = ref<number | null>(null);

const showCreateEnterprise = ref(false);
const showEditEnterprise = ref(false);
const showCreateTeam = ref(false);
const showEditTeam = ref(false);
const showInvite = ref(false);
const showEditUser = ref(false);
const showResetPassword = ref(false);
const showUserDetail = ref(false);

const savingEnterprise = ref(false);
const updatingEnterprise = ref(false);
const savingTeam = ref(false);
const updatingTeam = ref(false);
const inviting = ref(false);
const updatingUser = ref(false);
const resetting = ref(false);
const approvingId = ref<number | null>(null);
const approvingUserId = ref<number | null>(null);

const createEnterpriseName = ref("");
const editEnterpriseName = ref("");
const editEnterprise = ref<EnterpriseRow | null>(null);
const createTeamName = ref("");
const editTeamName = ref("");
const editTeam = ref<TeamRow | null>(null);
const invitePhone = ref("");
const inviteTeamId = ref<number | undefined>();
const inviteRole = ref<"member" | "team_admin">("member");
const editUser = ref<EmployeeRow | null>(null);
const detailEmployee = ref<EmployeeRow | null>(null);
const resetUser = ref<EmployeeRow | null>(null);
const resetForm = reactive({ password: "", confirmPassword: "" });
const editUserForm = reactive({
  name: "",
  phone: "",
  role: "employee" as UserRole,
  status: "active" as UserStatus,
  teamId: undefined as number | undefined,
});

const selectedEnterprise = computed(
  () => enterprises.value.find((row) => row.id === selectedEnterpriseId.value) ?? null,
);

const visibleEmployees = computed(() => {
  if (selectedTeamId.value == null) {
    return employees.value.filter((row) => row.teamId == null);
  }
  return employees.value.filter((row) => row.teamId === selectedTeamId.value);
});

const employeeSectionTitle = computed(() => {
  if (selectedTeamId.value == null) return "未加入团队";
  return teams.value.find((team) => team.id === selectedTeamId.value)?.name ?? "员工";
});

function parseQueryId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function statusLabel(status: string) {
  if (status === "active") return "正常";
  if (status === "pending") return "待审核";
  return "已停用";
}

function statusTagType(status: string) {
  if (status === "active") return "success";
  if (status === "pending") return "warning";
  return "danger";
}

function teamCount(enterpriseId: number) {
  return teamCounts.value[enterpriseId] ?? 0;
}

function requestMessage(error: unknown, fallback: string) {
  const requestError = error as { message?: string; response?: { data?: { message?: string } } };
  return requestError.response?.data?.message || requestError.message || fallback;
}

function syncQuery() {
  const query = { ...route.query };
  if (selectedEnterpriseId.value == null) delete query.enterpriseId;
  else query.enterpriseId = String(selectedEnterpriseId.value);
  if (selectedTeamId.value == null) delete query.teamId;
  else query.teamId = String(selectedTeamId.value);
  void router.replace({ query });
}

function selectEnterprise(id: number) {
  selectedEnterpriseId.value = id;
  selectedTeamId.value = null;
  syncQuery();
}

function selectTeam(id: number) {
  selectedTeamId.value = selectedTeamId.value === id ? null : id;
  syncQuery();
}

async function loadEnterprises() {
  const { data } = await http.get("/api/admin/enterprises");
  if (data.success) enterprises.value = data.data;
  const teamsRes = await http.get("/api/admin/teams");
  const counts: Record<number, number> = {};
  if (teamsRes.data.success) {
    for (const team of teamsRes.data.data as TeamRow[]) {
      counts[team.enterpriseId] = (counts[team.enterpriseId] ?? 0) + 1;
    }
  }
  teamCounts.value = counts;
}

async function loadTeamsAndPeople() {
  if (selectedEnterpriseId.value == null) {
    teams.value = [];
    employees.value = [];
    return;
  }
  const [teamRes, userRes] = await Promise.all([
    http.get("/api/admin/teams", { params: { enterpriseId: selectedEnterpriseId.value } }),
    http.get("/api/admin/users", { params: { enterpriseId: selectedEnterpriseId.value, limit: 200 } }),
  ]);
  teams.value = teamRes.data.success ? teamRes.data.data : [];
  const users = (userRes.data.success ? userRes.data.data : []) as Array<{
    id: number;
    name: string;
    phone: string;
    role: UserRole;
    status: UserStatus;
    enterpriseId: number | null;
    teamId?: number | null;
    teamName?: string | null;
    lastLoginAt: string | null;
  }>;
  const membership = new Map<number, { teamId: number; teamName: string; teamRole: "member" | "team_admin" }>();
  await Promise.all(
    teams.value.map(async (team) => {
      const { data } = await http.get(`/api/admin/teams/${team.id}/members`);
      if (!data.success) return;
      for (const member of data.data as Array<{ employeeId: number; role: "member" | "team_admin"; name: string }>) {
        membership.set(member.employeeId, {
          teamId: team.id,
          teamName: team.name,
          teamRole: member.role,
        });
      }
    }),
  );
  employees.value = users
    .filter((row) => row.role !== "admin")
    .map((row) => {
      const joined = membership.get(row.id);
      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        role: row.role,
        status: row.status,
        enterpriseId: row.enterpriseId,
        teamId: joined?.teamId ?? row.teamId ?? null,
        teamName: joined?.teamName ?? row.teamName ?? null,
        teamRole: joined?.teamRole ?? (row.role === "team_admin" ? "team_admin" : row.teamId ? "member" : null),
        lastLoginAt: row.lastLoginAt,
      };
    });
  if (selectedTeamId.value != null && !teams.value.some((team) => team.id === selectedTeamId.value)) {
    selectedTeamId.value = null;
  }
}

async function refreshAll() {
  loading.value = true;
  try {
    await loadEnterprises();
    const requested = parseQueryId(route.query.enterpriseId);
    if (requested && enterprises.value.some((row) => row.id === requested)) {
      selectedEnterpriseId.value = requested;
    } else if (
      selectedEnterpriseId.value == null ||
      !enterprises.value.some((row) => row.id === selectedEnterpriseId.value)
    ) {
      selectedEnterpriseId.value = enterprises.value[0]?.id ?? null;
    }
    const requestedTeam = parseQueryId(route.query.teamId);
    selectedTeamId.value = requestedTeam;
    await loadTeamsAndPeople();
    if (requestedTeam && !teams.value.some((team) => team.id === requestedTeam)) {
      selectedTeamId.value = null;
    }
    syncQuery();
  } catch (error) {
    ElMessage.error(requestMessage(error, "加载失败"));
  } finally {
    loading.value = false;
  }
}

function openCreateEnterprise() {
  createEnterpriseName.value = "";
  showCreateEnterprise.value = true;
}

async function createEnterprise() {
  const name = createEnterpriseName.value.trim();
  if (!name) {
    ElMessage.warning("请填写企业名称");
    return;
  }
  savingEnterprise.value = true;
  try {
    const { data } = await http.post("/api/admin/enterprises", { name });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已创建");
    showCreateEnterprise.value = false;
    await refreshAll();
    selectedEnterpriseId.value = data.data.id;
    syncQuery();
    await loadTeamsAndPeople();
  } catch (error) {
    ElMessage.error(requestMessage(error, "创建失败"));
  } finally {
    savingEnterprise.value = false;
  }
}

function openEditEnterprise(row: EnterpriseRow) {
  editEnterprise.value = row;
  editEnterpriseName.value = row.name;
  showEditEnterprise.value = true;
}

async function updateEnterprise() {
  if (!editEnterprise.value) return;
  const name = editEnterpriseName.value.trim();
  if (!name) {
    ElMessage.warning("请填写企业名称");
    return;
  }
  updatingEnterprise.value = true;
  try {
    const { data } = await http.patch(`/api/admin/enterprises/${editEnterprise.value.id}`, { name });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已更新");
    showEditEnterprise.value = false;
    await loadEnterprises();
  } catch (error) {
    ElMessage.error(requestMessage(error, "更新失败"));
  } finally {
    updatingEnterprise.value = false;
  }
}

async function approveEnterprise(row: EnterpriseRow) {
  try {
    await ElMessageBox.confirm(
      `确认通过「${row.name}」的合作申请？申请人将同时成为企业管理员。`,
      "审核通过",
      { confirmButtonText: "确认", cancelButtonText: "取消", type: "info" },
    );
  } catch {
    return;
  }
  approvingId.value = row.id;
  try {
    const { data } = await http.post(`/api/admin/enterprises/${row.id}/approve`);
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已通过，申请人已成为企业管理员");
    await refreshAll();
  } catch (error) {
    ElMessage.error(requestMessage(error, "审核失败"));
  } finally {
    approvingId.value = null;
  }
}

async function setEnterpriseStatus(row: EnterpriseRow, status: "active" | "disabled") {
  const action = status === "disabled" ? "停用" : "启用";
  try {
    await ElMessageBox.confirm(`确认${action}企业「${row.name}」？`, action, {
      confirmButtonText: "确认",
      cancelButtonText: "取消",
      type: status === "disabled" ? "warning" : "info",
    });
  } catch {
    return;
  }
  await http.patch(`/api/admin/enterprises/${row.id}/status`, { status });
  ElMessage.success("已更新");
  await loadEnterprises();
}

function openCreateTeam() {
  createTeamName.value = "";
  showCreateTeam.value = true;
}

async function createTeam() {
  if (!selectedEnterpriseId.value) return;
  const name = createTeamName.value.trim();
  if (!name) {
    ElMessage.warning("请填写团队名称");
    return;
  }
  savingTeam.value = true;
  try {
    const { data } = await http.post("/api/admin/teams", {
      name,
      enterpriseId: selectedEnterpriseId.value,
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已创建");
    showCreateTeam.value = false;
    await loadEnterprises();
    await loadTeamsAndPeople();
    selectedTeamId.value = data.data.id;
    syncQuery();
  } catch (error) {
    ElMessage.error(requestMessage(error, "创建失败"));
  } finally {
    savingTeam.value = false;
  }
}

function openEditTeam(team: TeamRow) {
  editTeam.value = team;
  editTeamName.value = team.name;
  showEditTeam.value = true;
}

async function updateTeam() {
  if (!editTeam.value) return;
  const name = editTeamName.value.trim();
  if (!name) {
    ElMessage.warning("请填写团队名称");
    return;
  }
  updatingTeam.value = true;
  try {
    const { data } = await http.patch(`/api/admin/teams/${editTeam.value.id}`, { name });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已更新");
    showEditTeam.value = false;
    await loadTeamsAndPeople();
  } catch (error) {
    ElMessage.error(requestMessage(error, "更新失败"));
  } finally {
    updatingTeam.value = false;
  }
}

async function setTeamStatus(team: TeamRow, status: "active" | "disabled") {
  const action = status === "disabled" ? "停用" : "启用";
  try {
    await ElMessageBox.confirm(`确认${action}团队「${team.name}」？`, action, {
      confirmButtonText: "确认",
      cancelButtonText: "取消",
      type: status === "disabled" ? "warning" : "info",
    });
  } catch {
    return;
  }
  await http.patch(`/api/admin/teams/${team.id}`, { status });
  ElMessage.success("已更新");
  await loadTeamsAndPeople();
}

function openInvite() {
  invitePhone.value = "";
  inviteRole.value = "member";
  inviteTeamId.value = selectedTeamId.value ?? undefined;
  showInvite.value = true;
}

async function inviteMember() {
  const phone = invitePhone.value.trim();
  if (phone.length < 5) {
    ElMessage.warning("请填写已注册用户的手机号");
    return;
  }
  if (!inviteTeamId.value) {
    ElMessage.warning(teams.value.length ? "请选择要加入的团队" : "请先创建团队，再邀请员工入团");
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
    selectedTeamId.value = inviteTeamId.value;
    await loadTeamsAndPeople();
    syncQuery();
  } catch (error) {
    ElMessage.error(requestMessage(error, "邀请失败"));
  } finally {
    inviting.value = false;
  }
}

function openUserDetail(person: EmployeeRow) {
  detailEmployee.value = person;
  showUserDetail.value = true;
}

function openEditUser(person: EmployeeRow) {
  editUser.value = person;
  editUserForm.name = person.name;
  editUserForm.phone = person.phone;
  editUserForm.role = person.role;
  editUserForm.status = person.status === "pending" ? "active" : person.status;
  editUserForm.teamId = person.teamId ?? undefined;
  showEditUser.value = true;
}

async function syncUserTeam(
  employeeId: number,
  fromTeamId: number | null,
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
    const { data } = await http.post(`/api/admin/teams/${next}/members`, { employeeId, role: teamRole });
    if (!data.success) throw new Error(data.message);
  } catch (error: unknown) {
    const response = (error as { response?: { status?: number; data?: { message?: string } } }).response;
    if (response?.status === 409 && response.data?.message === "该员工已在团队中") {
      await http.patch(`/api/admin/teams/${next}/members/${employeeId}`, { role: teamRole });
      return;
    }
    throw error;
  }
}

async function updateUser() {
  if (!editUser.value) return;
  if (!editUserForm.name.trim() || !editUserForm.phone.trim()) {
    ElMessage.warning("请填写姓名和手机号");
    return;
  }
  if (editUserForm.role === "team_admin" && !editUserForm.teamId) {
    ElMessage.warning("团队管理员必须选择所属团队");
    return;
  }
  updatingUser.value = true;
  try {
    if (editUserForm.role === "org_admin") {
      await syncUserTeam(editUser.value.id, editUser.value.teamId, undefined);
    } else {
      await syncUserTeam(
        editUser.value.id,
        editUser.value.teamId,
        editUserForm.teamId,
        editUserForm.role === "team_admin" ? "team_admin" : "member",
      );
    }
    const { data } = await http.patch(`/api/admin/users/${editUser.value.id}`, {
      name: editUserForm.name.trim(),
      phone: editUserForm.phone.trim(),
      status: editUserForm.status,
      role: editUserForm.role,
      enterpriseId: selectedEnterpriseId.value,
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已更新");
    showEditUser.value = false;
    await loadTeamsAndPeople();
    await loadEnterprises();
  } catch (error) {
    ElMessage.error(requestMessage(error, "更新失败"));
  } finally {
    updatingUser.value = false;
  }
}

async function approveUser(person: EmployeeRow) {
  try {
    await ElMessageBox.confirm(
      `确认审核通过 ${person.name} 的注册申请？账号将使用初始密码 Hz@123456，首次登录后需要修改密码。`,
      "审核通过",
      { confirmButtonText: "确认通过", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }
  approvingUserId.value = person.id;
  try {
    const { data } = await http.post(`/api/admin/users/${person.id}/approve`);
    if (!data.success) throw new Error(data.message);
    ElMessage.success("审核已通过，初始密码为 Hz@123456");
    await loadTeamsAndPeople();
  } catch (error) {
    ElMessage.error(requestMessage(error, "审核失败"));
  } finally {
    approvingUserId.value = null;
  }
}

async function toggleTeamAdmin(person: EmployeeRow) {
  if (!person.teamId) return;
  const next = person.teamRole === "team_admin" ? "member" : "team_admin";
  await http.patch(`/api/admin/teams/${person.teamId}/members/${person.id}`, { role: next });
  ElMessage.success(next === "team_admin" ? "已设为团队管理员" : "已取消团队管理员");
  await loadTeamsAndPeople();
}

async function removeFromTeam(person: EmployeeRow) {
  if (!person.teamId) return;
  try {
    await ElMessageBox.confirm(`确认将 ${person.name} 移出团队「${person.teamName}」？`, "移出团队", {
      confirmButtonText: "移出",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    return;
  }
  await http.delete(`/api/admin/teams/${person.teamId}/members/${person.id}`);
  ElMessage.success("已移出团队");
  await loadTeamsAndPeople();
}

async function setUserStatus(person: EmployeeRow, status: "active" | "disabled") {
  const action = status === "disabled" ? "停用" : "启用";
  try {
    await ElMessageBox.confirm(`确认${action} ${person.name}？`, action, {
      confirmButtonText: "确认",
      cancelButtonText: "取消",
      type: status === "disabled" ? "warning" : "info",
    });
  } catch {
    return;
  }
  await http.patch(`/api/admin/users/${person.id}/status`, { status });
  ElMessage.success("已更新");
  await loadTeamsAndPeople();
}

function openResetPassword(person: EmployeeRow) {
  resetUser.value = person;
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
  } catch (error) {
    ElMessage.error(requestMessage(error, "重置失败"));
  } finally {
    resetting.value = false;
  }
}

watch(
  () => [route.query.enterpriseId, route.query.teamId],
  () => {
    const enterpriseId = parseQueryId(route.query.enterpriseId);
    const teamId = parseQueryId(route.query.teamId);
    if (enterpriseId !== selectedEnterpriseId.value || teamId !== selectedTeamId.value) {
      void refreshAll();
    }
  },
);

onMounted(() => {
  void refreshAll();
});
</script>

<style scoped>
.org-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.org-shell {
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

.head-actions,
.detail-actions,
.unit-card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.split-layout {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.list-pane,
.detail-pane {
  min-width: 0;
  min-height: 0;
  height: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.list-pane {
  display: flex;
  flex-direction: column;
  padding: 12px;
  overflow: hidden;
  background: #f8fafc;
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
}

.card-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
}

.nav-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.nav-card:hover {
  border-color: #93c5fd;
}

.nav-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
}

.nav-card-top,
.unit-card-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.nav-card-top strong,
.unit-card-main strong {
  color: #0f172a;
  font-size: 14px;
}

.nav-card-bottom,
.unit-card-meta,
.nav-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: #64748b;
  font-size: 12px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.detail-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 18px 20px;
  background: #fff;
  overflow: auto;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.detail-title {
  margin: 0;
  font-size: 20px;
}

.detail-subtitle {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 12px;
}

.board-section + .board-section {
  margin-top: 22px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.section-head h4 {
  margin: 0;
  font-size: 15px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}

.unit-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
}

.unit-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
}

.person-card {
  cursor: default;
}

.form-help {
  margin: 0;
  color: #94a3b8;
  font-size: 12px;
}

.detail-empty {
  margin: auto;
}
</style>
