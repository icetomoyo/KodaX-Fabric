<template>
  <div class="project-page">
    <aside class="pane pane-list">
      <div class="pane-head">
        <strong>项目</strong>
        <el-button type="primary" size="small" @click="openCreate">新建</el-button>
      </div>
      <el-select
        v-if="teams.length > 1"
        v-model="teamFilter"
        clearable
        placeholder="全部团队"
        class="team-filter"
        @change="onTeamFilter"
      >
        <el-option v-for="item in teams" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
      <el-scrollbar class="list-scroll">
        <button
          v-for="item in visibleProjects"
          :key="item.id"
          type="button"
          class="project-item"
          :class="{ active: item.id === selectedId }"
          @click="selectProject(item.id)"
        >
          <span>{{ item.name }}</span>
          <el-tag :type="item.status === 'active' ? 'success' : 'info'" size="small">
            {{ item.status === "active" ? "正常" : "已停用" }}
          </el-tag>
        </button>
        <p v-if="visibleProjects.length === 0" class="empty">还没有项目</p>
      </el-scrollbar>
    </aside>

    <main class="pane pane-detail">
      <template v-if="selected">
        <div class="pane-head">
          <strong>项目详情</strong>
          <el-button size="small" @click="openEdit">编辑</el-button>
        </div>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="项目名称">{{ selected.name }}</el-descriptions-item>
          <el-descriptions-item label="所属团队">{{ selected.teamName }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            {{ selected.status === "active" ? "正常" : "已停用" }}
          </el-descriptions-item>
          <el-descriptions-item label="成员数">{{ selected.memberCount }}</el-descriptions-item>
        </el-descriptions>
        <p class="hint">用量和套餐目前仍记在团队上。项目用于协作分组，为以后按项目记账预留。</p>
      </template>
      <el-empty v-else description="请选择左侧项目" />
    </main>

    <aside class="pane pane-members">
      <div class="pane-head">
        <strong>项目成员</strong>
        <el-button type="primary" size="small" :disabled="!selected" @click="openAddMember">
          添加成员
        </el-button>
      </div>
      <el-table v-if="selected" :data="members" stripe height="100%">
        <el-table-column prop="name" label="姓名" min-width="90" />
        <el-table-column prop="phone" label="手机号" width="120" />
        <el-table-column label="操作" width="70">
          <template #default="{ row }">
            <el-button link type="danger" @click="removeMember(row)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="选择项目后查看成员" />
    </aside>

    <el-dialog v-model="showCreate" title="新建项目" width="420px">
      <el-form label-width="90px">
        <el-form-item v-if="teams.length > 1" label="所属团队" required>
          <el-select v-model="createTeamId" style="width: 100%">
            <el-option v-for="item in teams" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="项目名称" required>
          <el-input v-model="createName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="createOne">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEdit" :title="`编辑项目 · ${selected?.name || ''}`" width="420px">
      <el-form label-width="90px">
        <el-form-item label="项目名称" required>
          <el-input v-model="editName" maxlength="100" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="editStatus" style="width: 100%">
            <el-option label="正常" value="active" />
            <el-option label="已停用" value="disabled" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" :loading="updating" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showAddMember" title="添加项目成员" width="420px">
      <el-form label-width="90px">
        <el-form-item label="团队成员" required>
          <el-select v-model="addEmployeeId" filterable style="width: 100%" placeholder="选择本团队成员">
            <el-option
              v-for="item in addableMembers"
              :key="item.employeeId"
              :label="`${item.name} · ${item.phone}`"
              :value="item.employeeId"
            />
          </el-select>
        </el-form-item>
        <p class="form-help">员工可以同时加入多个项目，但必须先是本团队成员。</p>
      </el-form>
      <template #footer>
        <el-button @click="showAddMember = false">取消</el-button>
        <el-button type="primary" :loading="adding" @click="addMember">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";

type TeamRow = { id: number; name: string };
type ProjectRow = {
  id: number;
  name: string;
  status: "active" | "disabled";
  teamId: number;
  teamName: string;
  memberCount: number;
};
type ProjectMember = {
  id: number;
  employeeId: number;
  name: string;
  phone: string;
};
type TeamMember = {
  employeeId: number;
  name: string;
  phone: string;
};

const teams = ref<TeamRow[]>([]);
const projects = ref<ProjectRow[]>([]);
const members = ref<ProjectMember[]>([]);
const teamMembers = ref<TeamMember[]>([]);
const teamFilter = ref<number | "">("");
const selectedId = ref<number | null>(null);
const showCreate = ref(false);
const showEdit = ref(false);
const showAddMember = ref(false);
const saving = ref(false);
const updating = ref(false);
const adding = ref(false);
const createName = ref("");
const createTeamId = ref<number | undefined>();
const editName = ref("");
const editStatus = ref<"active" | "disabled">("active");
const addEmployeeId = ref<number | undefined>();

const visibleProjects = computed(() =>
  teamFilter.value ? projects.value.filter((item) => item.teamId === teamFilter.value) : projects.value,
);
const selected = computed(
  () => projects.value.find((item) => item.id === selectedId.value) ?? null,
);
const addableMembers = computed(() => {
  const taken = new Set(members.value.map((item) => item.employeeId));
  return teamMembers.value.filter((item) => !taken.has(item.employeeId));
});

async function loadTeams() {
  const { data } = await http.get("/api/admin/teams");
  if (data.success) teams.value = data.data;
}

async function loadProjects() {
  const { data } = await http.get("/api/admin/projects");
  if (data.success) projects.value = data.data;
  if (selectedId.value && !projects.value.some((item) => item.id === selectedId.value)) {
    selectedId.value = null;
    members.value = [];
  }
}

async function selectProject(id: number) {
  const project = projects.value.find((item) => item.id === id);
  selectedId.value = id;
  if (!project) {
    members.value = [];
    teamMembers.value = [];
    return;
  }
  const [membersRes, teamRes] = await Promise.all([
    http.get(`/api/admin/projects/${id}/members`),
    http.get(`/api/admin/teams/${project.teamId}/members`),
  ]);
  if (membersRes.data.success) members.value = membersRes.data.data;
  if (teamRes.data.success) teamMembers.value = teamRes.data.data;
}

function onTeamFilter() {
  if (selected.value && teamFilter.value && selected.value.teamId !== teamFilter.value) {
    selectedId.value = null;
    members.value = [];
  }
}

function openCreate() {
  createName.value = "";
  createTeamId.value =
    typeof teamFilter.value === "number" ? teamFilter.value : teams.value[0]?.id;
  showCreate.value = true;
}

function openEdit() {
  if (!selected.value) return;
  editName.value = selected.value.name;
  editStatus.value = selected.value.status;
  showEdit.value = true;
}

function openAddMember() {
  addEmployeeId.value = undefined;
  showAddMember.value = true;
}

async function createOne() {
  const name = createName.value.trim();
  if (!name) {
    ElMessage.warning("请填写项目名称");
    return;
  }
  if (!createTeamId.value) {
    ElMessage.warning("请选择团队");
    return;
  }
  saving.value = true;
  try {
    const { data } = await http.post("/api/admin/projects", {
      teamId: createTeamId.value,
      name,
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已创建");
    showCreate.value = false;
    await loadProjects();
    await selectProject(data.data.id);
  } catch (e: unknown) {
    ElMessage.error(requestMessage(e, "创建失败"));
  } finally {
    saving.value = false;
  }
}

async function saveEdit() {
  if (!selected.value) return;
  const name = editName.value.trim();
  if (!name) {
    ElMessage.warning("请填写项目名称");
    return;
  }
  updating.value = true;
  try {
    const { data } = await http.patch(`/api/admin/projects/${selected.value.id}`, {
      name,
      status: editStatus.value,
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已更新");
    showEdit.value = false;
    const id = selected.value.id;
    await loadProjects();
    await selectProject(id);
  } catch (e: unknown) {
    ElMessage.error(requestMessage(e, "更新失败"));
  } finally {
    updating.value = false;
  }
}

async function addMember() {
  if (!selected.value || !addEmployeeId.value) {
    ElMessage.warning("请选择团队成员");
    return;
  }
  adding.value = true;
  try {
    const { data } = await http.post(`/api/admin/projects/${selected.value.id}/members`, {
      employeeId: addEmployeeId.value,
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已加入项目");
    showAddMember.value = false;
    await loadProjects();
    await selectProject(selected.value.id);
  } catch (e: unknown) {
    ElMessage.error(requestMessage(e, "添加失败"));
  } finally {
    adding.value = false;
  }
}

async function removeMember(row: ProjectMember) {
  if (!selected.value) return;
  try {
    await ElMessageBox.confirm(`将 ${row.name} 移出项目？`, "移除成员", { type: "warning" });
  } catch {
    return;
  }
  await http.delete(`/api/admin/projects/${selected.value.id}/members/${row.employeeId}`);
  ElMessage.success("已移除");
  await loadProjects();
  await selectProject(selected.value.id);
}

function requestMessage(error: unknown, fallback: string) {
  const requestError = error as { message?: string; response?: { data?: { message?: string } } };
  return requestError.response?.data?.message || requestError.message || fallback;
}

onMounted(async () => {
  await loadTeams();
  await loadProjects();
  if (visibleProjects.value[0]) await selectProject(visibleProjects.value[0].id);
});
</script>

<style scoped>
.project-page {
  display: flex;
  flex: 1;
  min-height: calc(100vh - 120px);
  overflow: hidden;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}
.pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.pane-list {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid #e5e7eb;
}
.pane-detail {
  flex: 1;
  padding: 0 16px 16px;
  overflow: auto;
}
.pane-members {
  width: 320px;
  flex-shrink: 0;
  border-left: 1px solid #e5e7eb;
}
.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 12px 8px;
}
.team-filter {
  width: calc(100% - 24px);
  margin: 0 12px 8px;
}
.list-scroll {
  flex: 1;
  min-height: 0;
}
.project-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.project-item.active {
  background: #eff6ff;
  color: #1d4ed8;
}
.empty,
.hint,
.form-help {
  margin: 12px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.5;
}
.hint {
  margin: 16px 0 0;
}
.form-help {
  margin: 0 0 0 90px;
}
.pane-members :deep(.el-table) {
  flex: 1;
}
</style>
