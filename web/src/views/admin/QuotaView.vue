<template>
  <div>
    <div class="page-card" style="margin-bottom: 16px">
      <div class="head">
        <h2 class="page-title" style="margin: 0">配额策略</h2>
        <el-button type="primary" @click="openPolicyCreate">新建策略</el-button>
      </div>
      <el-table :data="policies" stripe>
        <el-table-column prop="name" label="名称" width="120" />
        <el-table-column prop="isDefault" label="默认" width="70">
          <template #default="{ row }">{{ row.isDefault ? "是" : "" }}</template>
        </el-table-column>
        <el-table-column prop="softTpmDay" label="日Token软限" />
        <el-table-column prop="hardTpmDay" label="日Token硬限" />
        <el-table-column prop="rpm" label="RPM" width="80" />
        <el-table-column prop="maxConcurrency" label="并发" width="80" />
        <el-table-column prop="softReqDay" label="日请求软限" />
        <el-table-column prop="hardReqDay" label="日请求硬限" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button link type="primary" @click="openPolicyEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="page-card">
      <div class="head">
        <h2 class="page-title" style="margin: 0">员工配额覆盖</h2>
        <el-button type="primary" @click="openOverride">添加覆盖</el-button>
      </div>
      <el-table :data="overrides" stripe empty-text="无单独覆盖，走默认策略">
        <el-table-column prop="employeeName" label="姓名" width="100" />
        <el-table-column prop="employeePhone" label="手机" width="120" />
        <el-table-column prop="policyName" label="策略模板" width="120" />
        <el-table-column prop="softTpmDay" label="日Token软限" />
        <el-table-column prop="hardTpmDay" label="日Token硬限" />
        <el-table-column prop="rpm" label="RPM" width="80" />
        <el-table-column prop="maxConcurrency" label="并发" width="80" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button link type="danger" @click="removeOverride(row.employeeId)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="showPolicy" :title="policyForm.id ? '编辑策略' : '新建策略'" width="560px">
      <el-form label-width="130px">
        <el-form-item label="名称"><el-input v-model="policyForm.name" /></el-form-item>
        <el-form-item label="日Token软限">
          <el-input-number v-model="policyForm.softTpmDay" :min="0" :step="100000" />
        </el-form-item>
        <el-form-item label="日Token硬限">
          <el-input-number v-model="policyForm.hardTpmDay" :min="0" :step="100000" placeholder="不限" />
        </el-form-item>
        <el-form-item label="RPM">
          <el-input-number v-model="policyForm.rpm" :min="1" />
        </el-form-item>
        <el-form-item label="并发">
          <el-input-number v-model="policyForm.maxConcurrency" :min="1" />
        </el-form-item>
        <el-form-item label="日请求软限">
          <el-input-number v-model="policyForm.softReqDay" :min="0" />
        </el-form-item>
        <el-form-item label="日请求硬限">
          <el-input-number v-model="policyForm.hardReqDay" :min="0" placeholder="不限" />
        </el-form-item>
        <el-form-item label="设为默认">
          <el-switch v-model="policyForm.isDefault" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showPolicy = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="savePolicy">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showOverride" title="员工配额覆盖" width="560px">
      <el-form label-width="120px">
        <el-form-item label="员工" required>
          <el-select v-model="overrideForm.employeeId" filterable style="width: 100%">
            <el-option
              v-for="u in users"
              :key="u.id"
              :label="`${u.name} (${u.phone})`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="策略模板">
          <el-select v-model="overrideForm.policyId" clearable style="width: 100%">
            <el-option v-for="p in policies" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="日Token软限">
          <el-input-number v-model="overrideForm.softTpmDay" :min="0" />
        </el-form-item>
        <el-form-item label="日Token硬限">
          <el-input-number v-model="overrideForm.hardTpmDay" :min="0" placeholder="不限" />
        </el-form-item>
        <el-form-item label="RPM">
          <el-input-number v-model="overrideForm.rpm" :min="1" />
        </el-form-item>
        <el-form-item label="并发">
          <el-input-number v-model="overrideForm.maxConcurrency" :min="1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showOverride = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveOverride">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";

const policies = ref<any[]>([]);
const overrides = ref<any[]>([]);
const users = ref<any[]>([]);
const showPolicy = ref(false);
const showOverride = ref(false);
const saving = ref(false);

const policyForm = reactive({
  id: 0,
  name: "",
  softTpmDay: 2_000_000 as number | null,
  hardTpmDay: null as number | null,
  rpm: 60,
  maxConcurrency: 5,
  softReqDay: 2000 as number | null,
  hardReqDay: null as number | null,
  isDefault: false,
});

const overrideForm = reactive({
  employeeId: undefined as number | undefined,
  policyId: undefined as number | undefined,
  softTpmDay: null as number | null,
  hardTpmDay: null as number | null,
  rpm: null as number | null,
  maxConcurrency: null as number | null,
});

async function load() {
  const [p, o, u] = await Promise.all([
    http.get("/api/admin/quota-policies"),
    http.get("/api/admin/quota-overrides"),
    http.get("/api/admin/users", { params: { limit: 200 } }),
  ]);
  if (p.data.success) policies.value = p.data.data;
  if (o.data.success) overrides.value = o.data.data;
  if (u.data.success) users.value = u.data.data;
}

function openPolicyCreate() {
  policyForm.id = 0;
  policyForm.name = "";
  policyForm.softTpmDay = 2_000_000;
  policyForm.hardTpmDay = null;
  policyForm.rpm = 60;
  policyForm.maxConcurrency = 5;
  policyForm.softReqDay = 2000;
  policyForm.hardReqDay = null;
  policyForm.isDefault = false;
  showPolicy.value = true;
}

function openPolicyEdit(row: any) {
  Object.assign(policyForm, {
    id: row.id,
    name: row.name,
    softTpmDay: row.softTpmDay,
    hardTpmDay: row.hardTpmDay,
    rpm: row.rpm,
    maxConcurrency: row.maxConcurrency,
    softReqDay: row.softReqDay,
    hardReqDay: row.hardReqDay,
    isDefault: row.isDefault,
  });
  showPolicy.value = true;
}

async function savePolicy() {
  saving.value = true;
  try {
    const payload = {
      name: policyForm.name,
      softTpmDay: policyForm.softTpmDay,
      hardTpmDay: policyForm.hardTpmDay,
      rpm: policyForm.rpm,
      maxConcurrency: policyForm.maxConcurrency,
      softReqDay: policyForm.softReqDay,
      hardReqDay: policyForm.hardReqDay,
      isDefault: policyForm.isDefault,
    };
    if (policyForm.id) {
      await http.patch(`/api/admin/quota-policies/${policyForm.id}`, payload);
    } else {
      await http.post("/api/admin/quota-policies", payload);
    }
    ElMessage.success("已保存");
    showPolicy.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "保存失败");
  } finally {
    saving.value = false;
  }
}

function openOverride() {
  overrideForm.employeeId = undefined;
  overrideForm.policyId = policies.value.find((p) => p.isDefault)?.id;
  overrideForm.softTpmDay = null;
  overrideForm.hardTpmDay = null;
  overrideForm.rpm = null;
  overrideForm.maxConcurrency = null;
  showOverride.value = true;
}

async function saveOverride() {
  if (!overrideForm.employeeId) {
    ElMessage.warning("请选择员工");
    return;
  }
  saving.value = true;
  try {
    await http.put(`/api/admin/quota-overrides/${overrideForm.employeeId}`, {
      policyId: overrideForm.policyId ?? null,
      softTpmDay: overrideForm.softTpmDay,
      hardTpmDay: overrideForm.hardTpmDay,
      rpm: overrideForm.rpm,
      maxConcurrency: overrideForm.maxConcurrency,
    });
    ElMessage.success("已保存");
    showOverride.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "保存失败");
  } finally {
    saving.value = false;
  }
}

async function removeOverride(employeeId: number) {
  await http.delete(`/api/admin/quota-overrides/${employeeId}`);
  ElMessage.success("已删除");
  await load();
}

onMounted(load);
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
</style>
