<template>
  <div class="org-page">
    <div class="page-head">
      <div class="page-head-text">
        <h2 class="page-title">组织架构</h2>
        <span class="muted">管理企业、部门与员工</span>
      </div>
      <div class="head-actions">
        <el-button :icon="Refresh" :loading="loading" @click="refreshAll">刷新</el-button>
        <el-button v-if="canBulkRegisterUsers" :icon="Upload" @click="openBulkRegister">批量注册用户</el-button>
        <el-button v-if="canCreateEnterprise" type="primary" :icon="Plus" @click="openCreateEnterprise">
          新建企业
        </el-button>
      </div>
    </div>

    <div v-loading="loading" class="split-layout" :class="layoutClass">
      <el-card v-if="showOrgTree" shadow="never" class="pane tree-pane" body-class="pane-body">
        <template #header>
          <div class="pane-header">
            <span class="pane-title">编制</span>
            <el-dropdown
              v-if="canCreateRootDepartment || canCreateChildDepartment"
              trigger="click"
              @command="onCreateDepartmentCommand"
            >
              <el-button type="primary" size="small" :icon="Plus" plain>
                新建
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-if="canCreateRootDepartment"
                    command="root"
                    :disabled="!selectedEnterprise"
                  >
                    新建部门
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="canCreateChildDepartment"
                    command="child"
                    :disabled="!selectedDepartment"
                  >
                    新建子部门
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </template>

        <el-empty v-if="!loading && !orgTree.length" description="暂无编制" :image-size="64">
          <el-button v-if="canCreateEnterprise" type="primary" @click="openCreateEnterprise">
            新建企业
          </el-button>
        </el-empty>
        <el-scrollbar v-else class="tree-scroll">
          <el-tree
            ref="orgTreeRef"
            class="org-tree"
            :data="orgTree"
            node-key="key"
            highlight-current
            default-expand-all
            :expand-on-click-node="false"
            :current-node-key="currentTreeKey"
            @node-click="onOrgNodeClick"
          >
            <template #default="{ data }">
              <div class="tree-row">
                <el-icon class="tree-icon">
                  <OfficeBuilding v-if="data.kind === 'enterprise'" />
                  <Folder v-else />
                </el-icon>
                <span class="tree-label">{{ data.label }}</span>
                <el-tag
                  v-if="data.status && data.status !== 'active'"
                  size="small"
                  :type="statusTagType(data.status)"
                >
                  {{ statusLabel(data.status) }}
                </el-tag>
                <span v-if="data.count != null" class="tree-count">{{ data.count }}</span>
                <span v-if="nodeActions(data).length" class="tree-more" @click.stop>
                  <el-dropdown trigger="click" @command="(action: string) => onNodeAction(action, data)">
                    <el-button link :icon="MoreFilled" class="tree-more-btn" />
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item
                          v-for="action in nodeActions(data)"
                          :key="action.command"
                          :command="action.command"
                          :class="{ 'is-danger': action.danger }"
                        >
                          {{ action.label }}
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </span>
              </div>
            </template>
          </el-tree>
        </el-scrollbar>
      </el-card>

      <el-card shadow="never" class="pane people-pane" body-class="pane-body">
        <template #header>
          <div class="pane-header">
            <span class="pane-title">{{ employeeSectionTitle }}</span>
            <el-tag type="info" size="small" round>{{ visibleEmployees.length }} 人</el-tag>
            <el-button
              class="pane-header-action"
              type="primary"
              size="small"
              :icon="Plus"
              :disabled="!canInvite"
              @click="openInvite"
            >
              邀请已注册员工
            </el-button>
          </div>
        </template>

        <el-empty
          v-if="showOrgTree && !selectedEnterprise"
          description="请先选择企业"
          :image-size="64"
        />
        <template v-else>
          <div class="people-table-wrap">
            <el-table
              class="people-table"
              :data="pagedEmployees"
              stripe
              height="100%"
              :empty-text="employeeEmptyText"
            >
              <el-table-column prop="name" label="姓名" min-width="120" show-overflow-tooltip />
              <el-table-column prop="phone" label="手机号" min-width="130" />
              <el-table-column label="部门" min-width="140" show-overflow-tooltip>
                <template #default="{ row }">
                  <span :class="{ muted: !row.teamName }">{{ row.teamName || "未分配" }}</span>
                </template>
              </el-table-column>
              <el-table-column label="角色" width="120">
                <template #default="{ row }">{{ employeeRoleLabel(row.role) }}</template>
              </el-table-column>
              <el-table-column label="状态" width="90" align="center">
                <template #default="{ row }">
                  <el-tag :type="statusTagType(row.status)" size="small">
                    {{ statusLabel(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="160" fixed="right" align="center">
                <template #default="{ row }">
                  <el-button
                    v-if="row.status === 'pending'"
                    link
                    type="success"
                    :loading="approvingUserId === row.id"
                    @click="approveUser(row)"
                  >
                    审核通过
                  </el-button>
                  <el-button link type="primary" @click="openUserDetail(row)">详情</el-button>
                  <el-button link type="primary" @click="openEditUser(row)">编辑</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
          <div v-if="visibleEmployees.length" class="pager">
            <el-pagination
              v-model:current-page="page"
              background
              layout="total, prev, pager, next"
              :total="total"
              :page-size="pageSize"
            />
          </div>
        </template>
      </el-card>
    </div>

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

    <el-dialog
      v-model="showCreateDepartment"
      :title="createDepartmentParentId ? '新建子部门' : '新建部门'"
      width="440px"
    >
      <el-form label-width="90px">
        <el-form-item label="所属企业">
          <el-input :model-value="selectedEnterprise?.name" disabled />
        </el-form-item>
        <el-form-item v-if="createDepartmentParent" label="上级部门">
          <el-input :model-value="createDepartmentParent.name" disabled />
        </el-form-item>
        <el-form-item :label="createDepartmentParentId ? '子部门名称' : '部门名称'" required>
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

    <el-dialog v-model="showBulkRegister" title="批量注册用户" width="560px">
      <el-form label-position="top">
        <el-form-item label="姓名和手机号" required>
          <el-input
            v-model="bulkRegisterRaw"
            type="textarea"
            :rows="10"
            resize="vertical"
            placeholder="每行一人：姓名,手机号&#10;也支持用空格或 Tab 分隔"
          />
          <el-text class="form-help" type="info" size="small">
            只开通注册账号，不加入企业或团队。初始密码 Hz123456，首次登录必须修改。单次最多 200 人。
            <b v-if="bulkRegisterParse.users.length">已识别 {{ bulkRegisterParse.users.length }} 人</b>
          </el-text>
          <el-alert
            v-if="bulkRegisterParse.errors.length"
            class="parse-errors"
            type="error"
            :closable="false"
            show-icon
          >
            <div v-for="error in bulkRegisterParse.errors.slice(0, 4)" :key="error">{{ error }}</div>
            <div v-if="bulkRegisterParse.errors.length > 4">
              另有 {{ bulkRegisterParse.errors.length - 4 }} 项格式错误
            </div>
          </el-alert>
        </el-form-item>
        <el-table
          v-if="bulkRegisterParse.users.length"
          :data="bulkRegisterParse.users.slice(0, 5)"
          size="small"
          stripe
        >
          <el-table-column prop="name" label="姓名" />
          <el-table-column prop="phone" label="手机号" class-name="mono" />
        </el-table>
        <el-text v-if="bulkRegisterParse.users.length > 5" class="form-help" type="info" size="small">
          其余 {{ bulkRegisterParse.users.length - 5 }} 人将一并注册
        </el-text>
      </el-form>
      <template #footer>
        <el-button @click="showBulkRegister = false">取消</el-button>
        <el-button
          type="primary"
          :loading="bulkRegistering"
          :disabled="!bulkRegisterParse.users.length || Boolean(bulkRegisterParse.errors.length)"
          @click="submitBulkRegister"
        >
          注册 {{ bulkRegisterParse.users.length || "" }} 人
        </el-button>
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
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="不能新建账号。对方必须已自行注册，邀请进团队后才有员工权限。"
        />
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
        <el-form-item v-if="editUserForm.role !== 'org_admin'" label="部门">
          <el-select v-model="editUserForm.teamId" clearable placeholder="选择部门" style="width: 100%">
            <el-option
              v-for="item in editUserDepartmentOptions"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="editUserForm.role" style="width: 100%">
            <el-option label="员工" value="employee" />
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
        <el-button v-if="editUser?.teamId" @click="removeFromTeam(editUser)">移出部门</el-button>
        <el-button v-if="editUser" @click="openResetPassword(editUser)">重置密码</el-button>
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
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  ArrowDown,
  Folder,
  MoreFilled,
  OfficeBuilding,
  Plus,
  Refresh,
  Upload,
} from "@element-plus/icons-vue";
import { http } from "@/api/http";
import { parseBulkRegisterText } from "@/lib/bulk-register-users";
import { employeeDepartmentLabel, visibleOrgEmployees } from "@/lib/org-employees";
import { roleLabel } from "@/lib/roles";
import { useTablePage } from "@/lib/table-page";

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
  parentId?: number | null;
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
  departmentName?: string;
  isDefault?: boolean;
  memberCount: number;
  todayTotalTokens: number;
  monthTotalTokens: number;
};

type OrgNodeKind = "enterprise" | "department";

type OrgTreeNode = {
  key: string;
  kind: OrgNodeKind;
  id: number;
  enterpriseId: number;
  departmentId?: number;
  label: string;
  status?: string;
  count?: number;
  children?: OrgTreeNode[];
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
const showOrgTree = computed(() => !auth.isTeamAdmin);
const canCreateEnterprise = computed(() => auth.isSuperAdmin);
const canBulkRegisterUsers = computed(() => auth.isSuperAdmin);
const canManageDepartments = computed(() => auth.isSuperAdmin || auth.isOrgAdmin || auth.isDeptAdmin);
const canCreateRootDepartment = computed(() => auth.isSuperAdmin || auth.isOrgAdmin);
const canCreateChildDepartment = computed(() => auth.isSuperAdmin || auth.isOrgAdmin || auth.isDeptAdmin);
const canManageTeams = computed(() => auth.isSuperAdmin || auth.isOrgAdmin || auth.isDeptAdmin);
const canAppointOrgAdmin = computed(() => auth.isSuperAdmin);
const canAppointDeptAdmin = computed(() => auth.isSuperAdmin || auth.isOrgAdmin);
const layoutClass = computed(() => (auth.isTeamAdmin ? "layout-people" : "layout-tree"));
const loading = ref(false);
const enterprises = ref<EnterpriseRow[]>([]);
const departments = ref<DepartmentRow[]>([]);
const teams = ref<TeamRow[]>([]);
const employees = ref<EmployeeRow[]>([]);
const selectedEnterpriseId = ref<number | null>(null);
const selectedDepartmentId = ref<number | null>(null);
const selectedTeamId = ref<number | null>(null);
const selectedNodeKind = ref<OrgNodeKind>("enterprise");
const orgTreeRef = ref<{ setCurrentKey: (key: string | number | null) => void } | null>(null);

const showCreateEnterprise = ref(false);
const showEditEnterprise = ref(false);
const showCreateDepartment = ref(false);
const showEditDepartment = ref(false);
const showCreateTeam = ref(false);
const showEditTeam = ref(false);
const showBulkRegister = ref(false);
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
const bulkRegistering = ref(false);
const inviting = ref(false);
const updatingUser = ref(false);
const resetting = ref(false);
const approvingUserId = ref<number | null>(null);

const createEnterpriseName = ref("");
const editEnterpriseName = ref("");
const editEnterprise = ref<EnterpriseRow | null>(null);
const createDepartmentName = ref("");
const createDepartmentParentId = ref<number | null>(null);
const editDepartmentName = ref("");
const editDepartment = ref<DepartmentRow | null>(null);
const createTeamName = ref("");
const editTeamName = ref("");
const editTeamDepartmentId = ref<number | undefined>();
const editTeam = ref<TeamRow | null>(null);
const bulkRegisterRaw = ref("");
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

const bulkRegisterParse = computed(() => parseBulkRegisterText(bulkRegisterRaw.value));

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
const createDepartmentParent = computed(
  () => namedDepartments.value.find((row) => row.id === createDepartmentParentId.value) ?? null,
);
const namedTeams = computed(() => teams.value.filter((row) => !row.isDefault));
const namedDepartments = computed(() => departments.value.filter((row) => !row.isDefault));

function departmentChildIds(parentId: number | null, enterpriseId: number): DepartmentRow[] {
  return namedDepartments.value.filter((row) =>
    row.enterpriseId === enterpriseId
    && (parentId == null ? row.parentId == null : row.parentId === parentId),
  );
}

function buildDepartmentNodes(enterpriseId: number, parentId: number | null): OrgTreeNode[] {
  return departmentChildIds(parentId, enterpriseId).map((department) => ({
    key: `department:${department.id}`,
    kind: "department" as const,
    id: department.id,
    enterpriseId,
    departmentId: department.id,
    label: department.name,
    status: department.status,
    count: department.memberCount,
    children: buildDepartmentNodes(enterpriseId, department.id),
  }));
}

const orgTree = computed((): OrgTreeNode[] => {
  if (auth.isDeptAdmin) {
    const enterpriseId = selectedEnterpriseId.value ?? auth.user?.enterprise?.id;
    if (enterpriseId == null) return [];
    const roots = namedDepartments.value.filter((row) => {
      if (row.enterpriseId !== enterpriseId) return false;
      return row.parentId == null
        || !namedDepartments.value.some((parent) => parent.id === row.parentId);
    });
    return roots.map((department) => ({
      key: `department:${department.id}`,
      kind: "department" as const,
      id: department.id,
      enterpriseId,
      departmentId: department.id,
      label: department.name,
      status: department.status,
      count: department.memberCount,
      children: buildDepartmentNodes(enterpriseId, department.id),
    }));
  }

  return enterprises.value.map((enterprise) => ({
    key: `enterprise:${enterprise.id}`,
    kind: "enterprise" as const,
    id: enterprise.id,
    enterpriseId: enterprise.id,
    label: enterprise.name,
    status: enterprise.status,
    children: buildDepartmentNodes(enterprise.id, null),
  }));
});

const currentTreeKey = computed(() => {
  if (selectedNodeKind.value === "department" && selectedDepartmentId.value != null) {
    return `department:${selectedDepartmentId.value}`;
  }
  if (selectedEnterpriseId.value != null) return `enterprise:${selectedEnterpriseId.value}`;
  return undefined;
});

const teamOptions = computed(() =>
  namedTeams.value.map((team) => ({
    id: team.id,
    name: team.name,
  })),
);

const editUserTeamOptions = computed(() => {
  const current = teams.value.find((team) => team.id === editUser.value?.teamId);
  const scoped =
    current?.departmentId == null
      ? namedTeams.value
      : namedTeams.value.filter((team) => team.departmentId === current.departmentId);
  return scoped.map((team) => ({
    id: team.id,
    name: team.name,
  }));
});

const editUserDepartmentOptions = computed(() => {
  const enterpriseId = editUser.value?.enterpriseId ?? selectedEnterpriseId.value;
  const options = namedDepartments.value
    .filter((department) => enterpriseId == null || department.enterpriseId === enterpriseId)
    .map((department) => ({
      id: department.defaultTeamId ?? 0,
      name: department.name,
    }))
    .filter((item) => item.id > 0);
  const currentId = editUser.value?.teamId;
  if (currentId && !options.some((item) => item.id === currentId)) {
    options.unshift({
      id: currentId,
      name: editUser.value?.teamName || "当前部门",
    });
  }
  return options;
});

const visibleEmployees = computed(() =>
  visibleOrgEmployees({
    isTeamAdmin: auth.isTeamAdmin,
    selectedKind: selectedNodeKind.value === "department" ? "department" : "enterprise",
    selectedDepartmentId: selectedDepartmentId.value,
    employees: employees.value,
    teams: teams.value,
    departments: departments.value,
  }),
);
const { page, paged: pagedEmployees, total, pageSize, resetPage } = useTablePage(visibleEmployees);

watch(
  [selectedNodeKind, selectedEnterpriseId, selectedDepartmentId],
  () => resetPage(),
);

const employeeSectionTitle = computed(() => {
  if (auth.isTeamAdmin) return "员工";
  if (selectedNodeKind.value === "department") return selectedDepartment.value?.name ?? "部门成员";
  return selectedEnterprise.value?.name ?? "员工";
});

const employeeEmptyText = computed(() => {
  if (auth.isTeamAdmin) return "本部门暂无员工";
  if (selectedNodeKind.value === "department") return "该部门暂无员工";
  return "该企业暂无员工";
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

function employeeRoleLabel(role: UserRole): string {
  if (role === "team_admin") return "部门管理员";
  return roleLabel(role);
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
  delete query.unassigned;
  void router.replace({ query });
}

function highlightTree() {
  void nextTick(() => {
    orgTreeRef.value?.setCurrentKey(currentTreeKey.value ?? null);
  });
}

function applyOrgNode(node: Pick<OrgTreeNode, "kind" | "id" | "enterpriseId" | "departmentId">) {
  selectedNodeKind.value = node.kind;
  selectedEnterpriseId.value = node.enterpriseId;
  if (node.kind === "department") {
    selectedDepartmentId.value = node.id;
    selectedTeamId.value =
      departments.value.find((row) => row.id === node.id)?.defaultTeamId ?? null;
  } else {
    selectedDepartmentId.value = null;
    selectedTeamId.value = null;
  }
}

async function onOrgNodeClick(data: OrgTreeNode) {
  const enterpriseChanged = data.enterpriseId !== selectedEnterpriseId.value;
  applyOrgNode(data);
  syncQuery();
  if (enterpriseChanged) await loadPeople();
  highlightTree();
}

function nodeActions(node: OrgTreeNode): Array<{ command: string; label: string; danger?: boolean }> {
  if (node.kind === "enterprise" && auth.isSuperAdmin) {
    const row = enterprises.value.find((item) => item.id === node.id);
    return [
      { command: "edit", label: "编辑" },
      {
        command: row?.status === "active" ? "disable" : "enable",
        label: row?.status === "active" ? "停用" : "启用",
        danger: row?.status === "active",
      },
    ];
  }
  if (node.kind === "department" && canManageDepartments.value) {
    const row = departments.value.find((item) => item.id === node.id);
    return [
      { command: "edit", label: "编辑" },
      {
        command: row?.status === "active" ? "disable" : "enable",
        label: row?.status === "active" ? "停用" : "启用",
        danger: row?.status === "active",
      },
      { command: "delete", label: "删除", danger: true },
    ];
  }
  if (node.kind === "team" && canManageTeams.value) {
    const row = teams.value.find((item) => item.id === node.id);
    return [
      { command: "edit", label: "编辑" },
      {
        command: row?.status === "active" ? "disable" : "enable",
        label: row?.status === "active" ? "停用" : "启用",
        danger: row?.status === "active",
      },
      { command: "delete", label: "删除", danger: true },
    ];
  }
  return [];
}

function onNodeAction(action: string, node: OrgTreeNode) {
  if (node.kind === "enterprise") {
    const row = enterprises.value.find((item) => item.id === node.id);
    if (!row) return;
    if (action === "edit") openEditEnterprise(row);
    if (action === "disable") void setEnterpriseStatus(row, "disabled");
    if (action === "enable") void setEnterpriseStatus(row, "active");
    return;
  }
  if (node.kind === "department") {
    const row = departments.value.find((item) => item.id === node.id);
    if (!row) return;
    if (action === "edit") openEditDepartment(row);
    if (action === "disable") void setDepartmentStatus(row, "disabled");
    if (action === "enable") void setDepartmentStatus(row, "active");
    if (action === "delete") void deleteDepartment(row);
    return;
  }
  if (node.kind === "team") {
    const row = teams.value.find((item) => item.id === node.id);
    if (!row) return;
    if (action === "edit") openEditTeam(row);
    if (action === "disable") void setTeamStatus(row, "disabled");
    if (action === "enable") void setTeamStatus(row, "active");
    if (action === "delete") void deleteTeam(row);
  }
}

function selectEnterprise(id: number) {
  applyOrgNode({ kind: "enterprise", id, enterpriseId: id });
  syncQuery();
  void loadPeople();
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
  departments.value = deptRes.data.success ? (deptRes.data.data as DepartmentRow[]) : [];
}

async function loadPeople() {
  if (selectedEnterpriseId.value == null) {
    employees.value = [];
    return;
  }
  const userRes = await http.get("/api/admin/users", {
    params: { enterpriseId: selectedEnterpriseId.value, limit: 200 },
  });
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
  const scopedTeams = teams.value.filter((team) => team.enterpriseId === selectedEnterpriseId.value);
  await Promise.all(
    scopedTeams.map(async (team) => {
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
      const teamId = joined?.teamId ?? row.teamId ?? null;
      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        role: row.role,
        status: row.status,
        enterpriseId: row.enterpriseId,
        teamId,
        teamName: employeeDepartmentLabel({
          teamId,
          fallbackName: joined?.teamName ?? row.teamName ?? null,
          teams: teams.value,
          departments: departments.value,
        }),
        teamRole: joined?.teamRole ?? (row.role === "team_admin" ? "team_admin" : row.teamId ? "member" : null),
        lastLoginAt: row.lastLoginAt,
      };
    });
}

async function loadTeamsAndPeople() {
  const teamRes = await http.get("/api/admin/teams");
  teams.value = teamRes.data.success ? teamRes.data.data : [];
  await loadPeople();
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
    await loadTeamsAndPeople();
    const requestedDepartment = parseQueryId(route.query.departmentId);
    const requestedTeam = parseQueryId(route.query.teamId);
    const teamDepartmentId = requestedTeam
      ? teams.value.find((row) => row.id === requestedTeam)?.departmentId ?? null
      : null;
    if (teamDepartmentId && namedDepartments.value.some((row) => row.id === teamDepartmentId)) {
      selectedNodeKind.value = "department";
      selectedDepartmentId.value = teamDepartmentId;
      selectedTeamId.value = requestedTeam;
    } else if (
      requestedDepartment
      && namedDepartments.value.some((row) => row.id === requestedDepartment)
    ) {
      selectedNodeKind.value = "department";
      selectedDepartmentId.value = requestedDepartment;
      selectedTeamId.value =
        departments.value.find((row) => row.id === requestedDepartment)?.defaultTeamId ?? null;
    } else {
      selectedNodeKind.value = auth.isDeptAdmin ? "department" : "enterprise";
      if (auth.isDeptAdmin) {
        selectedDepartmentId.value = namedDepartments.value[0]?.id ?? null;
        selectedTeamId.value = null;
      } else {
        selectedDepartmentId.value = null;
        selectedTeamId.value = null;
      }
    }
    syncQuery();
    highlightTree();
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
    selectedNodeKind.value = "enterprise";
    selectedDepartmentId.value = null;
    selectedTeamId.value = null;
    syncQuery();
    await loadTeamsAndPeople();
    highlightTree();
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

function openCreateRootDepartment() {
  createDepartmentName.value = "";
  createDepartmentParentId.value = null;
  showCreateDepartment.value = true;
}

function openCreateChildDepartment() {
  if (selectedDepartmentId.value == null) return;
  createDepartmentName.value = "";
  createDepartmentParentId.value = selectedDepartmentId.value;
  showCreateDepartment.value = true;
}

function onCreateDepartmentCommand(command: string | number | object) {
  if (command === "root") openCreateRootDepartment();
  if (command === "child") openCreateChildDepartment();
}

async function createDepartment() {
  if (!selectedEnterpriseId.value) return;
  const name = createDepartmentName.value.trim();
  if (!name) {
    ElMessage.warning(createDepartmentParentId.value ? "请填写子部门名称" : "请填写部门名称");
    return;
  }
  savingDepartment.value = true;
  try {
    const { data } = await http.post("/api/admin/departments", {
      name,
      enterpriseId: selectedEnterpriseId.value,
      parentId: createDepartmentParentId.value ?? undefined,
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已创建");
    showCreateDepartment.value = false;
    await loadEnterprises();
    await loadTeamsAndPeople();
    selectedNodeKind.value = "department";
    selectedDepartmentId.value = data.data.id;
    selectedTeamId.value = null;
    syncQuery();
    highlightTree();
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
      selectedNodeKind.value = "enterprise";
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
    selectedNodeKind.value = "team";
    selectedTeamId.value = data.data.id;
    syncQuery();
    highlightTree();
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
    selectedNodeKind.value = "team";
    selectedDepartmentId.value = editTeamDepartmentId.value;
    selectedTeamId.value = editTeam.value.id;
    await loadTeamsAndPeople();
    syncQuery();
    highlightTree();
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
      selectedNodeKind.value = "department";
      selectedTeamId.value = null;
    }
    await loadEnterprises();
    await loadTeamsAndPeople();
    syncQuery();
  } catch (error) {
    ElMessage.error(requestMessage(error, "删除失败"));
  }
}

function openBulkRegister() {
  bulkRegisterRaw.value = "";
  showBulkRegister.value = true;
}

async function submitBulkRegister() {
  const parsed = bulkRegisterParse.value;
  if (!parsed.users.length) {
    ElMessage.warning("请填写姓名和手机号");
    return;
  }
  if (parsed.errors.length) {
    ElMessage.warning("请先修正名单格式错误");
    return;
  }

  bulkRegistering.value = true;
  try {
    const { data } = await http.post("/api/admin/users/import", {
      users: parsed.users.map(({ name, phone }) => ({ name, phone })),
    });
    if (!data.success) throw new Error(data.message || "注册失败");
    const createdCount = Number(data.data?.createdCount ?? data.data?.created?.length ?? 0);
    const skipped = Array.isArray(data.data?.existingPhones) ? data.data.existingPhones.length : 0;
    const initialPassword = String(data.data?.initialPassword ?? "");
    const parts = [`已注册 ${createdCount} 人`];
    if (skipped) parts.push(`跳过 ${skipped} 个已注册手机号`);
    if (initialPassword && createdCount) parts.push(`初始密码 ${initialPassword}，首次登录须改密`);
    ElMessage.success(parts.join("，"));
    bulkRegisterRaw.value = "";
    showBulkRegister.value = false;
  } catch (error) {
    ElMessage.error(requestMessage(error, "批量注册失败"));
  } finally {
    bulkRegistering.value = false;
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
  editUserForm.role = person.role === "team_admin" ? "dept_admin" : person.role;
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
  if (editUserForm.role === "dept_admin" && !editUserForm.teamId) {
    ElMessage.warning("部门管理员必须选择所属部门");
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
        "member",
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
      `确认审核通过 ${person.name} 的注册申请？账号将使用初始密码 Hz123456，首次登录后需要修改密码。`,
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
    ElMessage.success("审核已通过，初始密码为 Hz123456");
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
    await ElMessageBox.confirm(`确认将 ${person.name} 移出部门「${person.teamName || "当前部门"}」？`, "移出部门", {
      confirmButtonText: "移出",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    return;
  }
  await http.delete(`/api/admin/teams/${person.teamId}/members/${person.id}`);
  ElMessage.success("已移出部门");
  showEditUser.value = false;
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
  () => [route.query.enterpriseId, route.query.departmentId, route.query.teamId],
  () => {
    const enterpriseId = parseQueryId(route.query.enterpriseId);
    const departmentId = parseQueryId(route.query.departmentId);
    const teamId = parseQueryId(route.query.teamId);
    if (
      enterpriseId !== selectedEnterpriseId.value
      || departmentId !== selectedDepartmentId.value
      || teamId !== selectedTeamId.value
    ) {
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
  gap: 16px;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.page-head {
  display: flex;
  flex-shrink: 0;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.page-head-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.page-head-text .page-title {
  margin: 0;
  font-size: 18px;
  line-height: 1.4;
}

.page-head-text .muted {
  font-size: 13px;
}

.head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.split-layout {
  display: grid;
  gap: 16px;
  flex: 1;
  min-height: 0;
}
.split-layout.layout-tree {
  grid-template-columns: 280px minmax(0, 1fr);
}
.split-layout.layout-people {
  grid-template-columns: 1fr;
}

.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.pane :deep(.el-card__header) {
  padding: 12px 16px;
}

.pane :deep(.pane-body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 0;
}

.pane-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}

.pane-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-header-action {
  flex-shrink: 0;
}

.tree-scroll {
  flex: 1;
  min-height: 0;
}

.org-tree {
  padding: 8px;
}

.org-tree :deep(.el-tree-node__content) {
  height: 34px;
  border-radius: var(--el-border-radius-base);
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  width: 100%;
  padding-right: 4px;
}

.tree-icon {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}

.tree-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-count {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}

.tree-more {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--el-transition-duration-fast);
}

.org-tree :deep(.el-tree-node__content:hover) .tree-more,
.org-tree :deep(.is-current > .el-tree-node__content) .tree-more {
  opacity: 1;
}

.tree-more-btn {
  padding: 0 2px;
  color: var(--el-text-color-secondary);
}

.tree-more :deep(.is-danger) {
  color: var(--el-color-danger);
}

.people-table-wrap {
  flex: 1;
  min-height: 0;
}

.people-table {
  height: 100%;
}

.people-pane .pager {
  flex-shrink: 0;
  margin-top: 0;
  padding: 8px 16px 12px;
}

.people-pane :deep(.el-empty) {
  flex: 1;
}

:deep(.mono) {
  font-family: var(--el-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}

.form-help {
  display: block;
  margin-top: 8px;
  line-height: 1.6;
}

.parse-errors {
  margin-top: 8px;
}

@media (max-width: 900px) {
  .split-layout.layout-tree {
    grid-template-columns: 1fr;
  }
  .tree-pane {
    max-height: 320px;
  }
}
</style>
