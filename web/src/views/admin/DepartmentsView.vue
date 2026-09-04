<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">部门管理</h2>
      <el-button type="primary" @click="openCreate">新建部门</el-button>
    </div>

    <el-table :data="rows" stripe>
      <el-table-column prop="name" label="部门" min-width="160" />
      <el-table-column prop="teamCount" label="团队" width="90" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
            {{ row.status === "active" ? "正常" : "已停用" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="removeOne(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showCreate" title="新建部门" width="440px">
      <el-form label-width="90px">
        <el-form-item label="部门名称" required>
          <el-input v-model="createName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="createOne">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEdit" :title="`编辑部门 · ${editRow?.name || ''}`" width="440px">
      <el-form label-width="90px">
        <el-form-item label="部门名称" required>
          <el-input v-model="editName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" :loading="updating" @click="updateOne">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";

type DepartmentRow = {
  id: number;
  name: string;
  status: "active" | "disabled";
  teamCount: number;
  memberCount?: number;
};

const rows = ref<DepartmentRow[]>([]);
const showCreate = ref(false);
const showEdit = ref(false);
const saving = ref(false);
const updating = ref(false);
const createName = ref("");
const editName = ref("");
const editRow = ref<DepartmentRow | null>(null);

function requestMessage(error: unknown, fallback: string) {
  const requestError = error as { message?: string; response?: { data?: { message?: string } } };
  return requestError.response?.data?.message || requestError.message || fallback;
}

async function load() {
  const { data } = await http.get("/api/admin/departments");
  if (data.success) rows.value = data.data;
}

function openCreate() {
  createName.value = "";
  showCreate.value = true;
}

async function createOne() {
  const name = createName.value.trim();
  if (!name) {
    ElMessage.warning("请填写部门名称");
    return;
  }
  saving.value = true;
  try {
    const { data } = await http.post("/api/admin/departments", { name });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已创建");
    showCreate.value = false;
    await load();
  } catch (error: unknown) {
    ElMessage.error(requestMessage(error, "创建失败"));
  } finally {
    saving.value = false;
  }
}

function openEdit(row: DepartmentRow) {
  editRow.value = row;
  editName.value = row.name;
  showEdit.value = true;
}

async function updateOne() {
  if (!editRow.value) return;
  const name = editName.value.trim();
  if (!name) {
    ElMessage.warning("请填写部门名称");
    return;
  }
  updating.value = true;
  try {
    const { data } = await http.patch(`/api/admin/departments/${editRow.value.id}`, { name });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已更新");
    showEdit.value = false;
    await load();
  } catch (error: unknown) {
    ElMessage.error(requestMessage(error, "更新失败"));
  } finally {
    updating.value = false;
  }
}

async function removeOne(row: DepartmentRow) {
  if (row.teamCount > 0) {
    ElMessage.warning("部门下已绑定团队，无法删除");
    return;
  }
  if ((row.memberCount ?? 0) > 0) {
    ElMessage.warning("部门下已绑定员工，无法删除");
    return;
  }
  try {
    await http.delete(`/api/admin/departments/${row.id}`);
    ElMessage.success("已删除");
    await load();
  } catch (error: unknown) {
    ElMessage.error(requestMessage(error, "删除失败"));
  }
}

onMounted(() => {
  void load();
});
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
</style>
