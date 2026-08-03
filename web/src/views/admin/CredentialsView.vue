<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">上游凭证池</h2>
      <el-button type="primary" @click="openCreate">录入凭证</el-button>
    </div>
    <p class="muted">官方 API Key / Coding Plan 凭证加密存储，列表仅显示末四位。不会回显明文。</p>

    <el-form inline style="margin-bottom: 12px">
      <el-form-item label="产品线">
        <el-select v-model="filterPl" clearable placeholder="全部" style="width: 260px" @change="load">
          <el-option
            v-for="pl in productLines"
            :key="pl.id"
            :label="`${pl.providerName} / ${pl.code} (${pl.productType})`"
            :value="pl.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="filterStatus" clearable placeholder="全部" style="width: 140px" @change="load">
          <el-option label="active" value="active" />
          <el-option label="disabled" value="disabled" />
          <el-option label="auto_disabled" value="auto_disabled" />
          <el-option label="cooling" value="cooling" />
        </el-select>
      </el-form-item>
    </el-form>

    <el-table :data="rows" stripe>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="providerName" label="供应商" width="120" />
      <el-table-column prop="productLineCode" label="产品线" width="100" />
      <el-table-column prop="productType" label="类型" width="110" />
      <el-table-column prop="label" label="备注" width="140" />
      <el-table-column prop="secretSuffix" label="末四位" width="90" />
      <el-table-column prop="priority" label="优先级" width="80" />
      <el-table-column prop="weight" label="权重" width="70" />
      <el-table-column prop="status" label="状态" width="120" />
      <el-table-column prop="successCount" label="成功" width="80" />
      <el-table-column prop="errorCount" label="失败" width="80" />
      <el-table-column prop="lastError" label="最近错误" show-overflow-tooltip />
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button
            v-if="row.status !== 'active'"
            link
            type="success"
            @click="setStatus(row.id, 'active')"
          >
            启用
          </el-button>
          <el-button
            v-else
            link
            type="danger"
            @click="setStatus(row.id, 'disabled')"
          >
            停用
          </el-button>
          <el-button
            v-if="row.productType === 'coding_plan' || row.shareMode === 'grant_only'"
            link
            @click="openGrants(row)"
          >
            授权
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showForm" :title="form.id ? '编辑凭证' : '录入凭证'" width="560px">
      <el-form label-width="100px">
        <el-form-item v-if="!form.id" label="产品线" required>
          <el-select v-model="form.productLineId" style="width: 100%">
            <el-option
              v-for="pl in productLines"
              :key="pl.id"
              :label="`${pl.providerName} / ${pl.code} (${pl.productType})`"
              :value="pl.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注" required>
          <el-input v-model="form.label" placeholder="如：采购批次-A" />
        </el-form-item>
        <el-form-item :label="form.id ? '新 Secret' : 'Secret'" :required="!form.id">
          <el-input
            v-model="form.secret"
            type="password"
            show-password
            :placeholder="form.id ? '留空则不修改' : '上游 API Key'"
          />
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="form.priority" :min="-1000" :max="1000" />
        </el-form-item>
        <el-form-item label="权重">
          <el-input-number v-model="form.weight" :min="0" :max="10000" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showForm = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showGrants" title="凭证员工授权" width="640px">
      <el-form inline @submit.prevent>
        <el-form-item label="员工">
          <el-select v-model="grantEmployeeId" filterable style="width: 280px" placeholder="选择员工">
            <el-option
              v-for="u in users"
              :key="u.id"
              :label="`${u.name} (${u.phone})`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="addGrant">添加授权</el-button>
        </el-form-item>
      </el-form>
      <el-table :data="grants" size="small">
        <el-table-column prop="employeeName" label="姓名" />
        <el-table-column prop="employeePhone" label="手机" />
        <el-table-column prop="createdAt" label="授权时间" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button link type="danger" @click="removeGrant(row.id)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";

const rows = ref<any[]>([]);
const productLines = ref<any[]>([]);
const users = ref<any[]>([]);
const filterPl = ref<number | undefined>();
const filterStatus = ref<string | undefined>();
const showForm = ref(false);
const showGrants = ref(false);
const saving = ref(false);
const grantEmployeeId = ref<number | undefined>();
const grants = ref<any[]>([]);
const grantCredentialId = ref(0);

const form = reactive({
  id: 0,
  productLineId: undefined as number | undefined,
  label: "",
  secret: "",
  priority: 0,
  weight: 100,
});

async function load() {
  const { data } = await http.get("/api/admin/credentials", {
    params: {
      productLineId: filterPl.value,
      status: filterStatus.value,
    },
  });
  if (data.success) rows.value = data.data;
}

async function loadMeta() {
  const [pl, us] = await Promise.all([
    http.get("/api/admin/product-lines"),
    http.get("/api/admin/users", { params: { limit: 200 } }),
  ]);
  if (pl.data.success) productLines.value = pl.data.data;
  if (us.data.success) users.value = us.data.data;
}

function openCreate() {
  form.id = 0;
  form.productLineId = productLines.value[0]?.id;
  form.label = "";
  form.secret = "";
  form.priority = 0;
  form.weight = 100;
  showForm.value = true;
}

function openEdit(row: any) {
  form.id = row.id;
  form.productLineId = row.productLineId;
  form.label = row.label;
  form.secret = "";
  form.priority = row.priority;
  form.weight = row.weight;
  showForm.value = true;
}

async function save() {
  saving.value = true;
  try {
    if (form.id) {
      await http.patch(`/api/admin/credentials/${form.id}`, {
        label: form.label,
        secret: form.secret || undefined,
        priority: form.priority,
        weight: form.weight,
      });
    } else {
      if (!form.productLineId || !form.secret) {
        ElMessage.warning("请填写产品线与 Secret");
        return;
      }
      await http.post("/api/admin/credentials", {
        productLineId: form.productLineId,
        label: form.label,
        secret: form.secret,
        priority: form.priority,
        weight: form.weight,
      });
    }
    ElMessage.success("已保存");
    showForm.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "保存失败");
  } finally {
    saving.value = false;
  }
}

async function setStatus(id: number, status: string) {
  await http.patch(`/api/admin/credentials/${id}`, { status });
  ElMessage.success("已更新");
  await load();
}

async function openGrants(row: any) {
  grantCredentialId.value = row.id;
  grantEmployeeId.value = undefined;
  const { data } = await http.get(`/api/admin/credentials/${row.id}/grants`);
  if (data.success) grants.value = data.data;
  showGrants.value = true;
}

async function addGrant() {
  if (!grantEmployeeId.value) return;
  await http.post(`/api/admin/credentials/${grantCredentialId.value}/grants`, {
    employeeId: grantEmployeeId.value,
  });
  ElMessage.success("已授权");
  const { data } = await http.get(`/api/admin/credentials/${grantCredentialId.value}/grants`);
  if (data.success) grants.value = data.data;
}

async function removeGrant(grantId: number) {
  await http.delete(`/api/admin/credentials/${grantCredentialId.value}/grants/${grantId}`);
  ElMessage.success("已移除");
  const { data } = await http.get(`/api/admin/credentials/${grantCredentialId.value}/grants`);
  if (data.success) grants.value = data.data;
}

onMounted(async () => {
  await loadMeta();
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
