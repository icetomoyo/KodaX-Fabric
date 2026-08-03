<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">日志查阅授权</h2>
      <el-button type="primary" @click="openCreate">新建授权</el-button>
    </div>
    <p class="muted">将指定范围内的调用日志（可选全文）授权给审计员或其他员工查看。</p>

    <el-table :data="rows" stripe>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="granteeName" label="被授权人" width="100" />
      <el-table-column prop="granteePhone" label="手机" width="120" />
      <el-table-column prop="scopeType" label="范围类型" width="110" />
      <el-table-column label="范围详情" min-width="180">
        <template #default="{ row }">
          {{ formatScope(row) }}
        </template>
      </el-table-column>
      <el-table-column prop="canReadBody" label="可读正文" width="90">
        <template #default="{ row }">{{ row.canReadBody ? "是" : "否" }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="90" />
      <el-table-column prop="expiresAt" label="过期时间" width="170" />
      <el-table-column prop="createdAt" label="创建时间" width="170" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.status === 'active'"
            link
            type="danger"
            @click="revoke(row.id)"
          >
            撤销
          </el-button>
          <el-button v-else link type="success" @click="activate(row.id)">恢复</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="show" title="新建日志授权" width="560px">
      <el-form label-width="110px">
        <el-form-item label="被授权人" required>
          <el-select v-model="form.granteeEmployeeId" filterable style="width: 100%">
            <el-option
              v-for="u in users"
              :key="u.id"
              :label="`${u.name} (${u.phone}) · ${u.role}`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="范围类型">
          <el-select v-model="form.scopeType" style="width: 100%">
            <el-option label="全员 all" value="all" />
            <el-option label="部门 dept" value="dept" />
            <el-option label="指定员工 employees" value="employees" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.scopeType === 'dept'" label="部门列表">
          <el-select
            v-model="form.depts"
            multiple
            filterable
            allow-create
            default-first-option
            style="width: 100%"
            placeholder="输入部门名回车"
          />
        </el-form-item>
        <el-form-item v-if="form.scopeType === 'employees'" label="员工">
          <el-select v-model="form.employeeIds" multiple filterable style="width: 100%">
            <el-option
              v-for="u in users"
              :key="u.id"
              :label="`${u.name} (${u.phone})`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="可读正文">
          <el-switch v-model="form.canReadBody" />
        </el-form-item>
        <el-form-item label="过期时间">
          <el-date-picker
            v-model="form.expiresAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
            style="width: 100%"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="show = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";

const rows = ref<any[]>([]);
const users = ref<any[]>([]);
const show = ref(false);
const saving = ref(false);
const form = reactive({
  granteeEmployeeId: undefined as number | undefined,
  scopeType: "all" as "all" | "dept" | "employees",
  depts: [] as string[],
  employeeIds: [] as number[],
  canReadBody: true,
  expiresAt: null as string | null,
});

function formatScope(row: any) {
  if (row.scopeType === "all") return "全员";
  const p = row.scopePayload || {};
  if (row.scopeType === "dept") return (p.depts || []).join(", ");
  if (row.scopeType === "employees") return `员工IDs: ${(p.employeeIds || []).join(", ")}`;
  return "";
}

async function load() {
  const { data } = await http.get("/api/admin/log-grants");
  if (data.success) rows.value = data.data;
}

async function loadUsers() {
  const { data } = await http.get("/api/admin/users", { params: { limit: 200 } });
  if (data.success) users.value = data.data;
}

function openCreate() {
  form.granteeEmployeeId = undefined;
  form.scopeType = "all";
  form.depts = [];
  form.employeeIds = [];
  form.canReadBody = true;
  form.expiresAt = null;
  show.value = true;
}

async function save() {
  if (!form.granteeEmployeeId) {
    ElMessage.warning("请选择被授权人");
    return;
  }
  saving.value = true;
  try {
    await http.post("/api/admin/log-grants", {
      granteeEmployeeId: form.granteeEmployeeId,
      scopeType: form.scopeType,
      scopePayload: {
        depts: form.scopeType === "dept" ? form.depts : undefined,
        employeeIds: form.scopeType === "employees" ? form.employeeIds : undefined,
      },
      canReadBody: form.canReadBody,
      expiresAt: form.expiresAt,
    });
    ElMessage.success("已创建");
    show.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "创建失败");
  } finally {
    saving.value = false;
  }
}

async function revoke(id: number) {
  await http.patch(`/api/admin/log-grants/${id}`, { status: "revoked" });
  ElMessage.success("已撤销");
  await load();
}

async function activate(id: number) {
  await http.patch(`/api/admin/log-grants/${id}`, { status: "active" });
  ElMessage.success("已恢复");
  await load();
}

onMounted(async () => {
  await loadUsers();
  await load();
});
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
</style>
