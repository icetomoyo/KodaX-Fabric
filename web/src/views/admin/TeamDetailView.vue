<template>
  <div>
    <div class="page-card">
      <el-button link type="primary" @click="router.push('/admin/teams')">← 返回团队列表</el-button>
      <h2 class="page-title">{{ teamName || "团队详情" }}</h2>
    </div>

    <div class="page-card">
      <div class="head">
        <h3 class="section-title">团队成员</h3>
        <el-button type="primary" @click="openAddMember">添加成员</el-button>
      </div>
      <el-table :data="members" stripe>
        <el-table-column prop="name" label="姓名" width="140" />
        <el-table-column prop="phone" label="手机号" width="140" />
        <el-table-column prop="dept" label="部门" min-width="140" />
        <el-table-column label="团队角色" width="140">
          <template #default="{ row }">
            {{ row.role === "team_admin" ? "团队管理员" : "成员" }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220">
          <template #default="{ row }">
            <el-button
              v-if="canAssignAdmin && row.role !== 'team_admin'"
              link
              type="primary"
              @click="setMemberRole(row, 'team_admin')"
            >
              设为团队管理员
            </el-button>
            <el-button
              v-if="canAssignAdmin && row.role === 'team_admin'"
              link
              type="warning"
              @click="setMemberRole(row, 'member')"
            >
              取消管理员
            </el-button>
            <el-button link type="danger" @click="removeMember(row)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="page-card">
      <div class="head">
        <h3 class="section-title">项目</h3>
        <el-button type="primary" @click="openCreateProject">新建项目</el-button>
      </div>
      <el-table :data="projectRows" stripe>
        <el-table-column prop="name" label="项目" min-width="180" />
        <el-table-column prop="memberCount" label="成员" width="90" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
              {{ row.status === "active" ? "正常" : "已停用" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <el-button link type="primary" @click="openProjectMembers(row)">成员</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="showAddMember" title="添加团队成员" width="480px">
      <el-form label-width="90px">
        <el-form-item label="员工 ID" required>
          <el-input v-model="addEmployeeId" placeholder="本企业员工 ID" />
        </el-form-item>
        <el-form-item v-if="canAssignAdmin" label="角色">
          <el-select v-model="addRole" style="width: 100%">
            <el-option label="成员" value="member" />
            <el-option label="团队管理员" value="team_admin" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddMember = false">取消</el-button>
        <el-button type="primary" :loading="addingMember" @click="addMember">添加</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showCreateProject" title="新建项目" width="440px">
      <el-form label-width="90px">
        <el-form-item label="项目名称" required>
          <el-input v-model="projectName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateProject = false">取消</el-button>
        <el-button type="primary" :loading="savingProject" @click="createProject">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showProjectMembers" :title="`项目成员 · ${activeProject?.name || ''}`" width="640px">
      <div class="head">
        <span />
        <el-button type="primary" @click="addProjectMember">添加项目成员</el-button>
      </div>
      <el-table :data="projectMemberRows" stripe>
        <el-table-column prop="name" label="姓名" width="140" />
        <el-table-column prop="phone" label="手机号" width="140" />
        <el-table-column prop="dept" label="部门" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button link type="danger" @click="removeProjectMember(row)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { useAuthStore } from "@/stores/auth";

type MemberRow = {
  id: number;
  employeeId: number;
  name: string;
  phone: string;
  dept: string | null;
  role: "member" | "team_admin";
};

type ProjectRow = {
  id: number;
  name: string;
  status: "active" | "disabled";
  memberCount: number;
};

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const teamId = computed(() => Number(route.params.id));
const teamName = ref("");
const members = ref<MemberRow[]>([]);
const projectRows = ref<ProjectRow[]>([]);
const showAddMember = ref(false);
const showCreateProject = ref(false);
const showProjectMembers = ref(false);
const addingMember = ref(false);
const savingProject = ref(false);
const addEmployeeId = ref("");
const addRole = ref<"member" | "team_admin">("member");
const projectName = ref("");
const activeProject = ref<ProjectRow | null>(null);
const projectMemberRows = ref<MemberRow[]>([]);
const canAssignAdmin = computed(() => auth.isSuperAdmin || auth.isOrgAdmin);

async function loadTeamName() {
  const { data } = await http.get("/api/admin/teams");
  if (data.success) {
    const row = data.data.find((item: { id: number; name: string }) => item.id === teamId.value);
    teamName.value = row?.name ?? "";
  }
}

async function loadMembers() {
  const { data } = await http.get(`/api/admin/teams/${teamId.value}/members`);
  if (data.success) members.value = data.data;
}

async function loadProjects() {
  const { data } = await http.get(`/api/admin/teams/${teamId.value}/projects`);
  if (data.success) projectRows.value = data.data;
}

function openAddMember() {
  addEmployeeId.value = "";
  addRole.value = "member";
  showAddMember.value = true;
}

function openCreateProject() {
  projectName.value = "";
  showCreateProject.value = true;
}

async function addMember() {
  const employeeId = Number(addEmployeeId.value);
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
    ElMessage.warning("请填写有效的员工 ID");
    return;
  }
  addingMember.value = true;
  try {
    const { data } = await http.post(`/api/admin/teams/${teamId.value}/members`, {
      employeeId,
      role: canAssignAdmin.value ? addRole.value : "member",
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已添加");
    showAddMember.value = false;
    await loadMembers();
  } catch (e: unknown) {
    ElMessage.error(requestMessage(e, "添加失败"));
  } finally {
    addingMember.value = false;
  }
}

async function setMemberRole(row: MemberRow, role: "member" | "team_admin") {
  await http.patch(`/api/admin/teams/${teamId.value}/members/${row.employeeId}`, { role });
  ElMessage.success("已更新");
  await loadMembers();
}

async function removeMember(row: MemberRow) {
  try {
    await ElMessageBox.confirm(`将 ${row.name} 移出团队？`, "移除成员", { type: "warning" });
  } catch {
    return;
  }
  await http.delete(`/api/admin/teams/${teamId.value}/members/${row.employeeId}`);
  ElMessage.success("已移除");
  await loadMembers();
}

async function createProject() {
  const name = projectName.value.trim();
  if (!name) {
    ElMessage.warning("请填写项目名称");
    return;
  }
  savingProject.value = true;
  try {
    const { data } = await http.post(`/api/admin/teams/${teamId.value}/projects`, { name });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已创建");
    showCreateProject.value = false;
    await loadProjects();
  } catch (e: unknown) {
    ElMessage.error(requestMessage(e, "创建失败"));
  } finally {
    savingProject.value = false;
  }
}

async function openProjectMembers(row: ProjectRow) {
  activeProject.value = row;
  const { data } = await http.get(`/api/admin/projects/${row.id}/members`);
  if (data.success) projectMemberRows.value = data.data;
  showProjectMembers.value = true;
}

async function addProjectMember() {
  const raw = window.prompt("输入要加入该项目的员工 ID（须已在本团队）");
  if (!raw) return;
  const employeeId = Number(raw);
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
    ElMessage.warning("员工 ID 无效");
    return;
  }
  try {
    const { data } = await http.post(`/api/admin/projects/${activeProject.value?.id}/members`, {
      employeeId,
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已添加");
    if (activeProject.value) await openProjectMembers(activeProject.value);
    await loadProjects();
  } catch (e: unknown) {
    ElMessage.error(requestMessage(e, "添加失败"));
  }
}

async function removeProjectMember(row: MemberRow) {
  if (!activeProject.value) return;
  await http.delete(`/api/admin/projects/${activeProject.value.id}/members/${row.employeeId}`);
  ElMessage.success("已移除");
  await openProjectMembers(activeProject.value);
  await loadProjects();
}

function requestMessage(error: unknown, fallback: string) {
  const requestError = error as { message?: string; response?: { data?: { message?: string } } };
  return requestError.response?.data?.message || requestError.message || fallback;
}

watch(teamId, async () => {
  if (!Number.isSafeInteger(teamId.value)) return;
  await Promise.all([loadTeamName(), loadMembers(), loadProjects()]);
}, { immediate: true });

onMounted(() => undefined);
</script>

<style scoped>
.page-card {
  margin-bottom: 16px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.section-title {
  margin: 0;
  font-size: 16px;
}
</style>
