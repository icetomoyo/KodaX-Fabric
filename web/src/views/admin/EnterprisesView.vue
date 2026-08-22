<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">企业管理</h2>
      <el-button type="primary" @click="openCreate">新建企业</el-button>
    </div>

    <el-table :data="rows" stripe>
      <el-table-column prop="name" label="企业名称" min-width="160" />
      <el-table-column prop="code" label="企业编号" width="140" />
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag
            :type="row.status === 'active' ? 'success' : row.status === 'pending' ? 'warning' : 'danger'"
            size="small"
          >
            {{ row.status === "active" ? "正常" : row.status === "pending" ? "待审核" : "已停用" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" min-width="180">
        <template #default="{ row }">
          {{ formatDateTime(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="280">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="primary" @click="openAssign(row)">指定企业管理员</el-button>
          <el-button
            v-if="row.status === 'active'"
            link
            type="danger"
            @click="setStatus(row, 'disabled')"
          >
            停用
          </el-button>
          <el-button v-else link type="primary" @click="setStatus(row, 'active')">启用</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showCreate" title="新建企业" width="440px">
      <el-form label-width="90px">
        <el-form-item label="企业名称" required>
          <el-input v-model="createName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="createOne">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEdit" :title="`编辑企业 · ${editRow?.name || ''}`" width="440px">
      <el-form label-width="90px">
        <el-form-item label="企业名称" required>
          <el-input v-model="editName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" :loading="updating" @click="updateOne">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showAssign" :title="`指定企业管理员 · ${assignRow?.name || ''}`" width="480px">
      <el-form label-width="90px">
        <el-form-item label="员工 ID" required>
          <el-input v-model="assignEmployeeId" placeholder="要绑定为企业管理员的员工 ID" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAssign = false">取消</el-button>
        <el-button type="primary" :loading="assigning" @click="assignAdmin">绑定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";

type EnterpriseRow = {
  id: number;
  name: string;
  code: string;
  status: "pending" | "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

const rows = ref<EnterpriseRow[]>([]);
const showCreate = ref(false);
const showEdit = ref(false);
const showAssign = ref(false);
const saving = ref(false);
const updating = ref(false);
const assigning = ref(false);
const createName = ref("");
const editName = ref("");
const editRow = ref<EnterpriseRow | null>(null);
const assignRow = ref<EnterpriseRow | null>(null);
const assignEmployeeId = ref("");

async function load() {
  const { data } = await http.get("/api/admin/enterprises");
  if (data.success) rows.value = data.data;
}

function openCreate() {
  createName.value = "";
  showCreate.value = true;
}

function openEdit(row: EnterpriseRow) {
  editRow.value = row;
  editName.value = row.name;
  showEdit.value = true;
}

function openAssign(row: EnterpriseRow) {
  assignRow.value = row;
  assignEmployeeId.value = "";
  showAssign.value = true;
}

async function createOne() {
  const name = createName.value.trim();
  if (!name) {
    ElMessage.warning("请填写企业名称");
    return;
  }
  saving.value = true;
  try {
    const { data } = await http.post("/api/admin/enterprises", { name });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已创建");
    showCreate.value = false;
    await load();
  } catch (e: unknown) {
    ElMessage.error(requestMessage(e, "创建失败"));
  } finally {
    saving.value = false;
  }
}

async function updateOne() {
  if (!editRow.value) return;
  const name = editName.value.trim();
  if (!name) {
    ElMessage.warning("请填写企业名称");
    return;
  }
  updating.value = true;
  try {
    const { data } = await http.patch(`/api/admin/enterprises/${editRow.value.id}`, { name });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已更新");
    showEdit.value = false;
    await load();
  } catch (e: unknown) {
    ElMessage.error(requestMessage(e, "更新失败"));
  } finally {
    updating.value = false;
  }
}

async function assignAdmin() {
  if (!assignRow.value) return;
  const employeeId = Number(assignEmployeeId.value);
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
    ElMessage.warning("请填写有效的员工 ID");
    return;
  }
  assigning.value = true;
  try {
    const { data } = await http.post(`/api/admin/enterprises/${assignRow.value.id}/admins`, {
      employeeId,
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已指定为企业管理员");
    showAssign.value = false;
  } catch (e: unknown) {
    ElMessage.error(requestMessage(e, "绑定失败"));
  } finally {
    assigning.value = false;
  }
}

async function setStatus(row: EnterpriseRow, status: "active" | "disabled") {
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
  await load();
}

function requestMessage(error: unknown, fallback: string) {
  const requestError = error as {
    message?: string;
    response?: { data?: { message?: string } };
  };
  return requestError.response?.data?.message || requestError.message || fallback;
}

onMounted(load);
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
</style>
