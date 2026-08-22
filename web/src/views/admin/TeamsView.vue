<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">团队管理</h2>
      <el-button v-if="canCreate" type="primary" @click="openCreate">新建团队</el-button>
    </div>

    <el-table :data="rows" stripe>
      <el-table-column prop="name" label="团队" min-width="160" />
      <el-table-column v-if="auth.isSuperAdmin" prop="enterpriseName" label="企业" min-width="140" />
      <el-table-column prop="memberCount" label="成员" width="90" />
      <el-table-column prop="projectCount" label="项目" width="90" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
            {{ row.status === "active" ? "正常" : "已停用" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">管理</el-button>
          <el-button v-if="canCreate" link type="primary" @click="openEdit(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showCreate" title="新建团队" width="440px">
      <el-form label-width="90px">
        <el-form-item v-if="auth.isSuperAdmin" label="所属企业" required>
          <el-select v-model="createEnterpriseId" style="width: 100%">
            <el-option
              v-for="item in enterprises"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="团队名称" required>
          <el-input v-model="createName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="createOne">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEdit" :title="`编辑团队 · ${editRow?.name || ''}`" width="440px">
      <el-form label-width="90px">
        <el-form-item label="团队名称" required>
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
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { useAuthStore } from "@/stores/auth";

type TeamRow = {
  id: number;
  name: string;
  status: "active" | "disabled";
  enterpriseId: number;
  enterpriseName: string;
  memberCount: number;
  projectCount: number;
};

const auth = useAuthStore();
const router = useRouter();
const rows = ref<TeamRow[]>([]);
const enterprises = ref<Array<{ id: number; name: string }>>([]);
const showCreate = ref(false);
const showEdit = ref(false);
const saving = ref(false);
const updating = ref(false);
const createName = ref("");
const createEnterpriseId = ref<number | undefined>();
const editName = ref("");
const editRow = ref<TeamRow | null>(null);
const canCreate = computed(() => auth.isSuperAdmin || auth.isOrgAdmin);

async function load() {
  const { data } = await http.get("/api/admin/teams");
  if (data.success) rows.value = data.data;
}

async function loadEnterprises() {
  if (!auth.isSuperAdmin) return;
  const { data } = await http.get("/api/admin/enterprises");
  if (data.success) enterprises.value = data.data;
}

function openCreate() {
  createName.value = "";
  createEnterpriseId.value = auth.user?.enterpriseId ?? enterprises.value[0]?.id;
  showCreate.value = true;
}

function openEdit(row: TeamRow) {
  editRow.value = row;
  editName.value = row.name;
  showEdit.value = true;
}

function openDetail(row: TeamRow) {
  router.push(`/admin/teams/${row.id}`);
}

async function createOne() {
  const name = createName.value.trim();
  if (!name) {
    ElMessage.warning("请填写团队名称");
    return;
  }
  if (auth.isSuperAdmin && !createEnterpriseId.value) {
    ElMessage.warning("请选择企业");
    return;
  }
  saving.value = true;
  try {
    const { data } = await http.post("/api/admin/teams", {
      name,
      enterpriseId: createEnterpriseId.value,
    });
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
    ElMessage.warning("请填写团队名称");
    return;
  }
  updating.value = true;
  try {
    const { data } = await http.patch(`/api/admin/teams/${editRow.value.id}`, { name });
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

function requestMessage(error: unknown, fallback: string) {
  const requestError = error as { message?: string; response?: { data?: { message?: string } } };
  return requestError.response?.data?.message || requestError.message || fallback;
}

onMounted(async () => {
  await loadEnterprises();
  await load();
});
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
</style>
