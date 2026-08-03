<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">模型路由</h2>
      <el-button type="primary" @click="openCreate">新增路由</el-button>
    </div>
    <p class="muted">将员工请求的 client model 映射到具体产品线与上游模型名。</p>

    <el-table :data="rows" stripe>
      <el-table-column prop="clientModel" label="对外模型" width="160" />
      <el-table-column prop="providerName" label="供应商" width="120" />
      <el-table-column prop="productLineCode" label="产品线" width="100" />
      <el-table-column prop="productType" label="类型" width="110" />
      <el-table-column prop="upstreamModel" label="上游模型" width="160" />
      <el-table-column prop="priority" label="优先级" width="80" />
      <el-table-column prop="weight" label="权重" width="70" />
      <el-table-column prop="enabled" label="启用" width="80">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
            {{ row.enabled ? "是" : "否" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="show" :title="form.id ? '编辑路由' : '新增路由'" width="560px">
      <el-form label-width="110px">
        <el-form-item label="对外模型" required>
          <el-input v-model="form.clientModel" placeholder="如 glm-4-flash" />
        </el-form-item>
        <el-form-item label="产品线" required>
          <el-select v-model="form.productLineId" style="width: 100%">
            <el-option
              v-for="pl in productLines"
              :key="pl.id"
              :label="`${pl.providerName} / ${pl.code}`"
              :value="pl.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="上游模型" required>
          <el-input v-model="form.upstreamModel" placeholder="实际上游 model 名" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="form.priority" />
        </el-form-item>
        <el-form-item label="权重">
          <el-input-number v-model="form.weight" :min="0" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="show = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";

const rows = ref<any[]>([]);
const productLines = ref<any[]>([]);
const show = ref(false);
const saving = ref(false);
const form = reactive({
  id: 0,
  clientModel: "",
  productLineId: undefined as number | undefined,
  upstreamModel: "",
  priority: 0,
  weight: 100,
  enabled: true,
});

async function load() {
  const { data } = await http.get("/api/admin/model-routes");
  if (data.success) rows.value = data.data;
}

async function loadPl() {
  const { data } = await http.get("/api/admin/product-lines");
  if (data.success) productLines.value = data.data;
}

function openCreate() {
  form.id = 0;
  form.clientModel = "";
  form.productLineId = productLines.value[0]?.id;
  form.upstreamModel = "";
  form.priority = 0;
  form.weight = 100;
  form.enabled = true;
  show.value = true;
}

function openEdit(row: any) {
  form.id = row.id;
  form.clientModel = row.clientModel;
  form.productLineId = row.productLineId;
  form.upstreamModel = row.upstreamModel;
  form.priority = row.priority;
  form.weight = row.weight;
  form.enabled = row.enabled;
  show.value = true;
}

async function save() {
  if (!form.productLineId) return;
  saving.value = true;
  try {
    const payload = {
      clientModel: form.clientModel,
      productLineId: form.productLineId,
      upstreamModel: form.upstreamModel,
      priority: form.priority,
      weight: form.weight,
      enabled: form.enabled,
    };
    if (form.id) {
      await http.patch(`/api/admin/model-routes/${form.id}`, payload);
    } else {
      await http.post("/api/admin/model-routes", payload);
    }
    ElMessage.success("已保存");
    show.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "保存失败");
  } finally {
    saving.value = false;
  }
}

async function remove(id: number) {
  await ElMessageBox.confirm("确认删除该路由？", "提示");
  await http.delete(`/api/admin/model-routes/${id}`);
  ElMessage.success("已删除");
  await load();
}

onMounted(async () => {
  await loadPl();
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
