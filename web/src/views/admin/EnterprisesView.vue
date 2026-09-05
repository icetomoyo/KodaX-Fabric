<template>
  <div class="org-page">
    <section class="page-card org-shell">
      <div class="page-head">
        <div>
          <h2 class="page-title">{{ pageTitle }}</h2>
          <p class="page-subtitle">{{ pageSubtitle }}</p>
        </div>
        <div class="head-actions">
          <el-button :loading="loading" @click="refreshAll">刷新</el-button>
          <el-button v-if="canCreateEnterprise" type="primary" @click="openCreateEnterprise">新建企业</el-button>
        </div>
      </div>

      <div v-loading="loading" class="split-layout" :class="layoutClass">
        <aside v-if="showEnterprisePane" class="list-pane">
          <div class="pane-label">
            <span>企业</span>
            <span class="pane-count">{{ enterprises.length }}</span>
          </div>
          <el-empty
            v-if="!loading && !enterprises.length"
            description="暂无企业"
            :image-size="64"
          >
            <el-button type="primary" @click="openCreateEnterprise">新建企业</el-button>
          </el-empty>
          <div v-else class="card-list">
            <article
              v-for="item in enterprises"
              :key="item.id"
              class="nav-card"
              :class="{ selected: selectedEnterpriseId === item.id }"
              @click="selectEnterprise(item.id)"
            >
              <div class="nav-card-top">
                <strong>{{ item.name }}</strong>
                <el-tag :type="statusTagType(item.status)" size="small" effect="light">
                  {{ statusLabel(item.status) }}
                </el-tag>
              </div>
              <div class="nav-card-bottom">
                <span class="mono">{{ item.code }}</span>
                <span>{{ departmentCount(item.id) }} 个部门</span>
              </div>
              <div class="nav-card-meta">
                {{ item.contact ? `${item.contact.name} · ${item.contact.phone}` : "暂无企业管理员" }}
              </div>
              <div v-if="selectedEnterpriseId === item.id" class="unit-card-actions" @click.stop>
                <el-button link type="primary" size="small" @click="openEditEnterprise(item)">编辑</el-button>
                <el-button
                  v-if="item.status === 'active'"
                  link
                  type="danger"
                  size="small"
                  @click="setEnterpriseStatus(item, 'disabled')"
                >
                  停用
                </el-button>
                <el-button v-else link type="primary" size="small" @click="setEnterpriseStatus(item, 'active')">
                  启用
                </el-button>
              </div>
            </article>
          </div>
        </aside>

        <aside v-if="showDepartmentPane" class="list-pane">
          <div class="pane-label">
            <span>部门</span>
            <span class="pane-count">{{ selectedEnterprise ? departments.length : 0 }}</span>
            <el-button
              v-if="canManageDepartments"
              type="primary"
              size="small"
              :disabled="!selectedEnterprise"
              @click="openCreateDepartment"
            >
              新建部门
            </el-button>
          </div>
          <el-empty
            v-if="!selectedEnterprise"
            description="请先选择企业"
            :image-size="64"
          />
          <el-empty
            v-else-if="!departments.length"
            description="该企业还没有部门"
            :image-size="64"
          >
            <el-button type="primary" @click="openCreateDepartment">新建部门</el-button>
          </el-empty>
          <div v-else class="card-list">
            <article
              v-for="department in departments"
              :key="department.id"
              class="nav-card"
              :class="{ selected: selectedDepartmentId === department.id }"
              @click="selectDepartment(department.id)"
            >
              <div class="nav-card-top">
                <strong>{{ department.name }}</strong>
                <el-tag :type="department.status === 'active' ? 'success' : 'danger'" size="small" effect="light">
                  {{ department.status === "active" ? "正常" : "已停用" }}
                </el-tag>
              </div>
              <div class="nav-card-meta">
                <span>{{ department.teamCount }} 个团队</span>
              </div>
              <div v-if="canManageDepartments" class="unit-card-actions" @click.stop>
                <el-button link type="primary" size="small" @click="openEditDepartment(department)">编辑</el-button>
                <el-button
                  v-if="department.status === 'active'"
                  link
                  type="danger"
                  size="small"
                  @click="setDepartmentStatus(department, 'disabled')"
                >
                  停用
                </el-button>
                <el-button v-else link type="primary" size="small" @click="setDepartmentStatus(department, 'active')">
                  启用
                </el-button>
                <el-button link type="danger" size="small" @click="deleteDepartment(department)">删除</el-button>
              </div>
            </article>
          </div>
        </aside>

        <aside v-if="showTeamPane" class="list-pane">
          <div class="pane-label">
            <span>团队</span>
            <span class="pane-count">{{ selectedDepartment ? visibleTeams.length : 0 }}</span>
            <el-button
              v-if="canManageTeams"
              type="primary"
              size="small"
              :disabled="!selectedDepartment"
              @click="openCreateTeam"
            >
              新建团队
            </el-button>
          </div>
          <el-empty
            v-if="!selectedDepartment"
            description="请先选择部门"
            :image-size="64"
          />
          <div v-else class="card-list">
            <p v-if="!visibleTeams.length" class="pane-hint">没有拆团队时，人直接挂在部门下</p>
            <article
              v-for="team in visibleTeams"
              :key="team.id"
              class="nav-card"
              :class="{ selected: selectedTeamId === team.id }"
              @click="selectTeam(team.id)"
            >
              <div class="nav-card-top">
                <strong>{{ team.name }}</strong>
                <el-tag :type="team.status === 'active' ? 'success' : 'danger'" size="small" effect="light">
                  {{ team.status === "active" ? "正常" : "已停用" }}
                </el-tag>
              </div>
              <div class="nav-card-meta">
                <span>{{ team.memberCount }} 人</span>
                <span>今日 {{ formatTokenCompact(team.todayTotalTokens) }}</span>
                <span>本月 {{ formatTokenCompact(team.monthTotalTokens) }}</span>
              </div>
              <div v-if="canManageTeams" class="unit-card-actions" @click.stop>
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
                <el-button link type="danger" size="small" @click="deleteTeam(team)">删除</el-button>
              </div>
            </article>
            <article
              v-if="canSeeUnassigned"
              class="nav-card"
              :class="{ selected: selectedTeamId === null }"
              @click="selectTeam(null)"
            >
              <div class="nav-card-top">
                <strong>未加入团队</strong>
              </div>
              <div class="nav-card-meta">{{ unassignedCount }} 人</div>
            </article>
          </div>
        </aside>

        <aside class="list-pane people-pane">
          <div class="pane-label">
            <span>{{ employeeSectionTitle }}</span>
            <span class="pane-count">{{ visibleEmployees.length }}</span>
            <el-button
              type="primary"
              size="small"
              :disabled="!canInvite"
              @click="openInvite"
            >
              邀请已注册员工
            </el-button>
          </div>
          <el-empty
            v-if="showEnterprisePane && !selectedEnterprise"
            description="请先选择企业"
            :image-size="64"
          />
          <el-empty
            v-else-if="!visibleEmployees.length"
            :description="auth.isTeamAdmin ? '本团队暂无员工' : selectedTeamId ? '该团队暂无员工' : '没有未加入团队的员工'"
            :image-size="64"
          />
          <div v-else class="card-list">
            <article v-for="person in visibleEmployees" :key="person.id" class="nav-card person-card">
              <div class="nav-card-top">
                <strong>{{ person.name }}</strong>
                <el-tag :type="statusTagType(person.status)" size="small" effect="light">
                  {{ statusLabel(person.status) }}
                </el-tag>
              </div>
              <div class="nav-card-meta">
                <span>{{ person.phone }}</span>
                <span>{{ roleLabel(person.role) }}</span>
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
        </aside>
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

    <el-dialog v-model="showCreateDepartment" title="新建部门" width="440px">
      <el-form label-width="90px">
        <el-form-item label="所属企业">
          <el-input :model-value="selectedEnterprise?.name" disabled />
        </el-form-item>
        <el-form-item label="部门名称" required>
          <el-input v-model="createDepartmentName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDepartment = false">取消</el-button>
        <el-button type="primary" :loading="savingDepartment" @click="createDepartment">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEditDepartment" :title="`编辑部门 · ${editDepartment?.name || ''}`" width="440px">
      <el-form label-width="90px">
        <el-form-item label="部门名称" required>
          <el-input v-model="editDepartmentName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDepartment = false">取消</el-button>
        <el-button type="primary" :loading="updatingDepartment" @click="updateDepartment">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showCreateTeam" title="新建团队" width="440px">
      <el-form label-width="90px">
        <el-form-item label="所属企业">
          <el-input :model-value="selectedEnterprise?.name" disabled />
        </el-form-item>
        <el-form-item label="所属部门">
          <el-input :model-value="selectedDepartment?.name" disabled />
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
        <el-form-item label="所属部门" required>
          <el-select v-model="editTeamDepartmentId" style="width: 100%" placeholder="选择部门">
            <el-option
              v-for="item in departments"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
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
            <el-option v-for="item in teamOptions" :key="item.id" :label="item.name" :value="item.id" />
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
          <el-select v-model="editUserForm.teamId" clearable placeholder="选择本部门下的团队" style="width: 100%">
            <el-option
              v-for="item in editUserTeamOptions"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="editUserForm.role" style="width: 100%">
            <el-option label="员工" value="employee" />
            <el-option label="团队管理员" value="team_admin" />
            <el-option v-if="canAppointDeptAdmin" label="部门管理员" value="dept_admin" />
            <el-option v-if="canAppointOrgAdmin" label="企业管理员" value="org_admin" />
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
import { roleLabel } from "@/lib/roles";
import { formatTokenCompact } from "@/lib/tokens";
import { useAuthStore } from "@/stores/auth";
import EmployeeUsageDrawer from "./EmployeeUsageDrawer.vue";

type EnterpriseStatus = "pending" | "active" | "disabled";
type UserStatus = "pending" | "active" | "disabled";
type UserRole = "employee" | "admin" | "org_admin" | "dept_admin" | "team_admin";

type EnterpriseRow = {
  id: number;
  name: string;
  code: string;
  status: EnterpriseStatus;
  createdAt: string;
  contact: { employeeId: number; name: string; phone: string; role: string } | null;
};

type DepartmentRow = {
  id: number;
  name: string;
  status: "active" | "disabled";
  isDefault?: boolean;
  enterpriseId: number;
  teamCount: number;
  memberCount?: number;
  defaultTeamId: number | null;
};

type TeamRow = {
  id: number;
  name: string;
  status: "active" | "disabled";
  enterpriseId: number;
  departmentId: number;
  isDefault?: boolean;
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
const auth = useAuthStore();
const showEnterprisePane = computed(() => auth.isSuperAdmin);
const showDepartmentPane = computed(() => auth.isSuperAdmin || auth.isOrgAdmin);
const showTeamPane = computed(() => auth.isSuperAdmin || auth.isOrgAdmin || auth.isDeptAdmin);
const canCreateEnterprise = computed(() => auth.isSuperAdmin);
const canManageDepartments = computed(() => auth.isSuperAdmin || auth.isOrgAdmin);
const canManageTeams = computed(() => auth.isSuperAdmin || auth.isOrgAdmin || auth.isDeptAdmin);
const canAppointOrgAdmin = computed(() => auth.isSuperAdmin);
const canAppointDeptAdmin = computed(() => auth.isSuperAdmin || auth.isOrgAdmin);
const canSeeUnassigned = computed(() => showTeamPane.value);
const pageTitle = computed(() => {
  if (auth.isSuperAdmin) return "企业管理";
  if (auth.isOrgAdmin) return "本企业编制";
  if (auth.isDeptAdmin) return "本部门编制";
  return "员工";
});
const pageSubtitle = computed(() => {
  if (auth.isSuperAdmin) return "企业 → 部门 → 团队 → 员工，每张卡片都可以直接操作";
  if (auth.isOrgAdmin) return "部门 → 团队 → 员工";
  if (auth.isDeptAdmin) return "团队 → 员工";
  return "本团队成员，邀请和日常操作都在列表上完成";
});
const layoutClass = computed(() => {
  if (auth.isTeamAdmin) return "layout-people";
  if (auth.isDeptAdmin) return "layout-team-people";
  if (auth.isOrgAdmin) return "layout-dept-team-people";
  return "layout-full";
});
const loading = ref(false);
const enterprises = ref<EnterpriseRow[]>([]);
const departments = ref<DepartmentRow[]>([]);
const teams = ref<TeamRow[]>([]);
const employees = ref<EmployeeRow[]>([]);
const departmentCounts = ref<Record<number, number>>({});
const selectedEnterpriseId = ref<number | null>(null);
const selectedDepartmentId = ref<number | null>(null);
const selectedTeamId = ref<number | null>(null);

const showCreateEnterprise = ref(false);
const showEditEnterprise = ref(false);
const showCreateDepartment = ref(false);
const showEditDepartment = ref(false);
const showCreateTeam = ref(false);
const showEditTeam = ref(false);
const showInvite = ref(false);
const showEditUser = ref(false);
const showResetPassword = ref(false);
const showUserDetail = ref(false);

const savingEnterprise = ref(false);
const updatingEnterprise = ref(false);
const savingDepartment = ref(false);
const updatingDepartment = ref(false);
const savingTeam = ref(false);
const updatingTeam = ref(false);
const inviting = ref(false);
const updatingUser = ref(false);
const resetting = ref(false);
const approvingUserId = ref<number | null>(null);

const createEnterpriseName = ref("");
const editEnterpriseName = ref("");
const editEnterprise = ref<EnterpriseRow | null>(null);
const createDepartmentName = ref("");
const editDepartmentName = ref("");
const editDepartment = ref<DepartmentRow | null>(null);
const createTeamName = ref("");
const editTeamName = ref("");
const editTeamDepartmentId = ref<number | undefined>();
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

const canInvite = computed(() => {
  if (auth.isTeamAdmin) return teams.value.length > 0;
  return selectedEnterpriseId.value != null;
});
const selectedEnterprise = computed(
  () => enterprises.value.find((row) => row.id === selectedEnterpriseId.value) ?? null,
);
const selectedDepartment = computed(
  () => departments.value.find((row) => row.id === selectedDepartmentId.value) ?? null,
);
const visibleTeams = computed(() =>
  selectedDepartmentId.value == null
    ? []
    : teams.value.filter((row) => row.departmentId === selectedDepartmentId.value && !row.isDefault),
);

const selectedDepartmentDefaultTeamId = computed(() => selectedDepartment.value?.defaultTeamId ?? null);

const teamOptions = computed(() =>
  teams.value.map((team) => ({
    id: team.id,
    name: team.isDefault
      ? `${departments.value.find((row) => row.id === team.departmentId)?.name ?? "部门"}（未拆团队）`
      : team.name,
  })),
);

const editUserTeamOptions = computed(() => {
  const current = teams.value.find((team) => team.id === editUser.value?.teamId);
  const scoped =
    current?.departmentId == null
      ? teams.value
      : teams.value.filter((team) => team.departmentId === current.departmentId);
  return scoped.map((team) => ({
    id: team.id,
    name: team.isDefault
      ? `${departments.value.find((row) => row.id === team.departmentId)?.name ?? "部门"}（未拆团队）`
      : team.name,
  }));
});

const unassignedCount = computed(
  () => employees.value.filter((row) => row.teamId == null).length,
);

const visibleEmployees = computed(() => {
  if (auth.isTeamAdmin) return employees.value;
  if (selectedTeamId.value == null) {
    return employees.value.filter((row) => row.teamId == null);
  }
  return employees.value.filter((row) => row.teamId === selectedTeamId.value);
});

const employeeSectionTitle = computed(() => {
  if (auth.isTeamAdmin) return "员工";
  if (selectedTeamId.value == null) return "未加入团队";
  if (selectedTeamId.value === selectedDepartmentDefaultTeamId.value) {
    return selectedDepartment.value?.name ?? "部门成员";
  }
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

function departmentCount(enterpriseId: number) {
  return departmentCounts.value[enterpriseId] ?? 0;
}

function requestMessage(error: unknown, fallback: string) {
  const requestError = error as { message?: string; response?: { data?: { message?: string } } };
  return requestError.response?.data?.message || requestError.message || fallback;
}

function syncQuery() {
  const query = { ...route.query };
  if (selectedEnterpriseId.value == null) delete query.enterpriseId;
  else query.enterpriseId = String(selectedEnterpriseId.value);
  if (selectedDepartmentId.value == null) delete query.departmentId;
  else query.departmentId = String(selectedDepartmentId.value);
  if (selectedTeamId.value == null) delete query.teamId;
  else query.teamId = String(selectedTeamId.value);
  void router.replace({ query });
}

function selectEnterprise(id: number) {
  selectedEnterpriseId.value = id;
  selectedDepartmentId.value = null;
  selectedTeamId.value = null;
  syncQuery();
  void loadTeamsAndPeople().then(() => {
    if (selectedDepartmentId.value == null && departments.value[0]) {
      selectedDepartmentId.value = departments.value[0].id;
    }
    selectedTeamId.value = selectedDepartmentDefaultTeamId.value;
    syncQuery();
  });
}

function selectDepartment(id: number) {
  selectedDepartmentId.value = id;
  selectedTeamId.value =
    departments.value.find((row) => row.id === id)?.defaultTeamId ?? null;
  syncQuery();
}

function selectTeam(id: number | null) {
  selectedTeamId.value = id;
  syncQuery();
}

async function loadEnterprises() {
  if (auth.isSuperAdmin) {
    const { data } = await http.get("/api/admin/enterprises");
    if (data.success) enterprises.value = data.data;
  } else if (auth.user?.enterprise) {
    enterprises.value = [
      {
        id: auth.user.enterprise.id,
        name: auth.user.enterprise.name,
        code: auth.user.enterprise.code,
        status: auth.user.enterprise.status as EnterpriseStatus,
        createdAt: "",
        contact: null,
      },
    ];
    selectedEnterpriseId.value = auth.user.enterprise.id;
  } else {
    enterprises.value = [];
  }
  const deptRes = await http.get("/api/admin/departments");
  const counts: Record<number, number> = {};
  if (deptRes.data.success) {
    for (const department of deptRes.data.data as DepartmentRow[]) {
      counts[department.enterpriseId] = (counts[department.enterpriseId] ?? 0) + 1;
    }
  }
  departmentCounts.value = counts;
}

async function loadTeamsAndPeople() {
  if (selectedEnterpriseId.value == null) {
    departments.value = [];
    teams.value = [];
    employees.value = [];
    return;
  }
  const [deptRes, teamRes, userRes] = await Promise.all([
    http.get("/api/admin/departments", { params: { enterpriseId: selectedEnterpriseId.value } }),
    http.get("/api/admin/teams", { params: { enterpriseId: selectedEnterpriseId.value } }),
    http.get("/api/admin/users", { params: { enterpriseId: selectedEnterpriseId.value, limit: 200 } }),
  ]);
  departments.value = deptRes.data.success ? deptRes.data.data : [];
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
  if (
    selectedDepartmentId.value != null &&
    !departments.value.some((row) => row.id === selectedDepartmentId.value)
  ) {
    selectedDepartmentId.value = departments.value[0]?.id ?? null;
  }
  const teamIds = new Set(teams.value.map((team) => team.id));
  if (selectedTeamId.value != null && !teamIds.has(selectedTeamId.value)) {
    selectedTeamId.value = selectedDepartmentDefaultTeamId.value;
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
    const requestedDepartment = parseQueryId(route.query.departmentId);
    const requestedTeam = parseQueryId(route.query.teamId);
    selectedDepartmentId.value = requestedDepartment;
    selectedTeamId.value = requestedTeam;
    await loadTeamsAndPeople();
    if (requestedDepartment && departments.value.some((row) => row.id === requestedDepartment)) {
      selectedDepartmentId.value = requestedDepartment;
    } else {
      selectedDepartmentId.value = departments.value[0]?.id ?? null;
    }
    if (requestedTeam && visibleTeams.value.some((team) => team.id === requestedTeam)) {
      selectedTeamId.value = requestedTeam;
    } else {
      selectedTeamId.value = selectedDepartmentDefaultTeamId.value;
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

function openCreateDepartment() {
  createDepartmentName.value = "";
  showCreateDepartment.value = true;
}

async function createDepartment() {
  if (!selectedEnterpriseId.value) return;
  const name = createDepartmentName.value.trim();
  if (!name) {
    ElMessage.warning("请填写部门名称");
    return;
  }
  savingDepartment.value = true;
  try {
    const { data } = await http.post("/api/admin/departments", {
      name,
      enterpriseId: selectedEnterpriseId.value,
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已创建");
    showCreateDepartment.value = false;
    await loadEnterprises();
    await loadTeamsAndPeople();
    selectedDepartmentId.value = data.data.id;
    selectedTeamId.value = data.data.defaultTeamId ?? null;
    syncQuery();
  } catch (error) {
    ElMessage.error(requestMessage(error, "创建失败"));
  } finally {
    savingDepartment.value = false;
  }
}

function openEditDepartment(department: DepartmentRow) {
  editDepartment.value = department;
  editDepartmentName.value = department.name;
  showEditDepartment.value = true;
}

async function updateDepartment() {
  if (!editDepartment.value) return;
  const name = editDepartmentName.value.trim();
  if (!name) {
    ElMessage.warning("请填写部门名称");
    return;
  }
  updatingDepartment.value = true;
  try {
    const { data } = await http.patch(`/api/admin/departments/${editDepartment.value.id}`, { name });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已更新");
    showEditDepartment.value = false;
    await loadEnterprises();
    await loadTeamsAndPeople();
  } catch (error) {
    ElMessage.error(requestMessage(error, "更新失败"));
  } finally {
    updatingDepartment.value = false;
  }
}

async function setDepartmentStatus(department: DepartmentRow, status: "active" | "disabled") {
  const action = status === "disabled" ? "停用" : "启用";
  try {
    await ElMessageBox.confirm(`确认${action}部门「${department.name}」？`, action, {
      confirmButtonText: "确认",
      cancelButtonText: "取消",
      type: status === "disabled" ? "warning" : "info",
    });
  } catch {
    return;
  }
  await http.patch(`/api/admin/departments/${department.id}`, { status });
  ElMessage.success("已更新");
  await loadTeamsAndPeople();
}

async function deleteDepartment(department: DepartmentRow) {
  if (department.teamCount > 0) {
    ElMessage.warning("部门下已绑定团队，无法删除");
    return;
  }
  const departmentTeamIds = new Set(
    teams.value.filter((team) => team.departmentId === department.id).map((team) => team.id),
  );
  const hasMembers =
    (department.memberCount ?? 0) > 0 ||
    employees.value.some((person) => person.teamId != null && departmentTeamIds.has(person.teamId));
  if (hasMembers) {
    ElMessage.warning("部门下已绑定员工，无法删除");
    return;
  }
  try {
    await http.delete(`/api/admin/departments/${department.id}`);
    ElMessage.success("已删除");
    if (selectedDepartmentId.value === department.id) {
      selectedDepartmentId.value = null;
      selectedTeamId.value = null;
    }
    await loadEnterprises();
    await loadTeamsAndPeople();
    syncQuery();
  } catch (error) {
    ElMessage.error(requestMessage(error, "删除失败"));
  }
}

function openCreateTeam() {
  createTeamName.value = "";
  showCreateTeam.value = true;
}

async function createTeam() {
  if (!selectedEnterpriseId.value || !selectedDepartmentId.value) return;
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
      departmentId: selectedDepartmentId.value,
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
  editTeamDepartmentId.value = team.departmentId;
  showEditTeam.value = true;
}

async function updateTeam() {
  if (!editTeam.value) return;
  const name = editTeamName.value.trim();
  if (!name) {
    ElMessage.warning("请填写团队名称");
    return;
  }
  if (!editTeamDepartmentId.value) {
    ElMessage.warning("请选择部门");
    return;
  }
  updatingTeam.value = true;
  try {
    const { data } = await http.patch(`/api/admin/teams/${editTeam.value.id}`, {
      name,
      departmentId: editTeamDepartmentId.value,
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已更新");
    showEditTeam.value = false;
    selectedDepartmentId.value = editTeamDepartmentId.value;
    selectedTeamId.value = editTeam.value.id;
    await loadTeamsAndPeople();
    syncQuery();
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

async function deleteTeam(team: TeamRow) {
  if (team.memberCount > 0) {
    ElMessage.warning("团队下已绑定员工，无法删除");
    return;
  }
  try {
    await http.delete(`/api/admin/teams/${team.id}`);
    ElMessage.success("已删除");
    if (selectedTeamId.value === team.id) {
      selectedTeamId.value = selectedDepartmentDefaultTeamId.value;
    }
    await loadEnterprises();
    await loadTeamsAndPeople();
    syncQuery();
  } catch (error) {
    ElMessage.error(requestMessage(error, "删除失败"));
  }
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
  if ((editUserForm.role === "team_admin" || editUserForm.role === "dept_admin") && !editUserForm.teamId) {
    ElMessage.warning(
      editUserForm.role === "dept_admin" ? "部门管理员必须选择所属团队" : "团队管理员必须选择所属团队",
    );
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
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.split-layout.layout-full {
  grid-template-columns: minmax(180px, 0.9fr) minmax(180px, 0.9fr) minmax(180px, 0.9fr) minmax(240px, 1.2fr);
}
.split-layout.layout-dept-team-people {
  grid-template-columns: minmax(180px, 0.9fr) minmax(180px, 0.9fr) minmax(240px, 1.3fr);
}
.split-layout.layout-team-people {
  grid-template-columns: minmax(220px, 1fr) minmax(280px, 1.4fr);
}
.split-layout.layout-people {
  grid-template-columns: 1fr;
}

.list-pane {
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
  gap: 8px;
  margin-bottom: 10px;
  padding: 0 4px;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.pane-label > span:first-child {
  margin-right: auto;
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

.person-card {
  cursor: default;
}

.nav-card:hover {
  border-color: #93c5fd;
}

.nav-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
}

.nav-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.nav-card-top strong {
  color: #0f172a;
  font-size: 14px;
}

.nav-card-bottom,
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

.pane-hint {
  margin: 0 0 8px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.5;
}

.form-help {
  margin: 0;
  color: #94a3b8;
  font-size: 12px;
}
</style>
