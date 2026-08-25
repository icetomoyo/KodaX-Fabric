<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">企业管理</h2>
      <el-button type="primary" @click="openCreate">新建企业</el-button>
    </div>

    <el-table :data="rows" stripe>
      <el-table-column prop="name" label="企业名称" min-width="160" />
      <el-table-column prop="code" label="企业编号" width="140" />
      <el-table-column label="申请人 / 企业管理员" min-width="180">
        <template #default="{ row }">
          <span v-if="row.contact">{{ row.contact.name }} · {{ row.contact.phone }}</span>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
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
      <el-table-column label="套餐" min-width="120">
        <template #default="{ row }">
          <el-tag v-if="!row.packagePlan" type="danger" size="small">未发放</el-tag>
          <span v-else>{{ packageLabel(row.packagePlan) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="每月额度" min-width="140">
        <template #default="{ row }">
          <span class="mono-num">{{ formatYuan(row.monthlyYuan) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="已分给团队" min-width="140">
        <template #default="{ row }">
          <span class="mono-num">{{ formatYuan(row.assignedTeamQuota) }}</span>
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
          <el-button link type="primary" @click="openQuota(row)">分配套餐</el-button>
          <el-button
            v-if="row.status === 'pending'"
            link
            type="success"
            :loading="approvingId === row.id"
            @click="approve(row)"
          >
            审核通过
          </el-button>
          <el-button
            v-else-if="row.status === 'active'"
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

    <el-dialog v-model="showQuota" :title="`分配套餐 · ${quotaRow?.name || ''}`" width="480px">
      <el-form label-width="90px">
        <el-form-item label="套餐" required>
          <el-radio-group v-model="quotaPlan">
            <el-radio value="">未发放</el-radio>
            <el-radio v-for="item in ENTERPRISE_PACKAGES" :key="item.plan" :value="item.plan">
              {{ item.label }}（每月 {{ formatYuan(item.monthlyYuan) }}）
            </el-radio>
          </el-radio-group>
          <div class="form-help">
            套餐按月计费，金额按模型单价折算。不能低于已分给团队的 {{ formatYuan(quotaRow?.assignedTeamQuota ?? 0) }}。
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showQuota = false">取消</el-button>
        <el-button type="primary" :loading="updatingQuota" @click="saveQuota">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";
import { ENTERPRISE_PACKAGES, packageLabel, packageMonthlyYuan, type EnterprisePackagePlan } from "@/lib/packages";
import { formatYuan } from "@/lib/tokens";

type EnterpriseRow = {
  id: number;
  name: string;
  code: string;
  status: "pending" | "active" | "disabled";
  packagePlan: EnterprisePackagePlan | null;
  monthlyYuan: number;
  assignedTeamQuota: number;
  createdAt: string;
  updatedAt: string;
  contact: { employeeId: number; name: string; phone: string; role: string } | null;
};

const rows = ref<EnterpriseRow[]>([]);
const showCreate = ref(false);
const showEdit = ref(false);
const showQuota = ref(false);
const saving = ref(false);
const updating = ref(false);
const updatingQuota = ref(false);
const approvingId = ref<number | null>(null);
const createName = ref("");
const editName = ref("");
const editRow = ref<EnterpriseRow | null>(null);
const quotaRow = ref<EnterpriseRow | null>(null);
const quotaPlan = ref<EnterprisePackagePlan | "">("");

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

function openQuota(row: EnterpriseRow) {
  quotaRow.value = row;
  quotaPlan.value = row.packagePlan ?? "";
  showQuota.value = true;
}

async function saveQuota() {
  if (!quotaRow.value) return;
  if (packageMonthlyYuan(quotaPlan.value) < Number(quotaRow.value.assignedTeamQuota || 0)) {
    ElMessage.warning("已分配给团队的额度超过该套餐，请先下调团队额度");
    return;
  }
  updatingQuota.value = true;
  try {
    const { data } = await http.patch(`/api/admin/enterprises/${quotaRow.value.id}`, {
      packagePlan: quotaPlan.value === "" ? null : quotaPlan.value,
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已分配套餐");
    showQuota.value = false;
    await load();
  } catch (e: unknown) {
    ElMessage.error(requestMessage(e, "分配失败"));
  } finally {
    updatingQuota.value = false;
  }
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

async function approve(row: EnterpriseRow) {
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
    await load();
  } catch (e: unknown) {
    ElMessage.error(requestMessage(e, "审核失败"));
  } finally {
    approvingId.value = null;
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
.muted {
  color: #94a3b8;
}
.mono-num {
  font-variant-numeric: tabular-nums;
}
.form-help {
  margin-top: 6px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.5;
}
:deep(.el-radio-group) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
</style>
