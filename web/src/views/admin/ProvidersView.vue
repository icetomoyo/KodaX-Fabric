<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">供应商 / 产品线</h2>
      <el-button v-if="auth.isSuperAdmin" type="primary" @click="openCreateProvider">新增供应商</el-button>
    </div>
    <p class="muted">
      不预置演示供应商。请按实际采购录入；产品线区分 API / Coding Plan。
    </p>

    <el-empty v-if="!providers.length" description="暂无供应商，请先新增" />

    <el-table v-else :data="providers" row-key="id" default-expand-all>
      <el-table-column type="expand">
        <template #default="{ row }">
          <el-table :data="row.productLines" size="small" style="margin: 0 24px 12px">
            <el-table-column prop="code" label="产品线" width="120" />
            <el-table-column prop="name" label="名称" width="140" />
            <el-table-column prop="productType" label="类型" width="120" />
            <el-table-column prop="status" label="状态" width="100" />
            <el-table-column label="上游配置" min-width="150">
              <template #default>按协议自动配置</template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default="{ row: pl }">
                <el-button link type="primary" @click="manageChannel(pl.id)">渠道管理</el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </el-table-column>
      <el-table-column prop="code" label="Code" width="140" />
      <el-table-column prop="name" label="名称" width="160" />
      <el-table-column prop="defaultBaseUrl" label="默认 Base URL" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column v-if="auth.isSuperAdmin" label="操作" width="120">
        <template #default="{ row }">
          <el-button link type="primary" @click="editProvider(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showProvider" :title="providerForm.id ? '编辑供应商' : '新增供应商'" width="520px">
      <el-form label-width="110px">
        <el-form-item v-if="!providerForm.id" label="Code" required>
          <el-input v-model="providerForm.code" placeholder="如 zhipu_cn、deepseek" />
        </el-form-item>
        <el-form-item label="名称" required><el-input v-model="providerForm.name" /></el-form-item>
        <el-form-item label="Base URL" required><el-input v-model="providerForm.defaultBaseUrl" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="providerForm.status" style="width: 100%">
            <el-option label="active" value="active" />
            <el-option label="disabled" value="disabled" />
          </el-select>
        </el-form-item>
        <template v-if="!providerForm.id">
          <el-form-item label="默认产品线">
            <el-checkbox v-model="providerForm.withApiLine">创建 api 产品线</el-checkbox>
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="showProvider = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveProvider">保存</el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();
const providers = ref<Array<Record<string, any>>>([]);
const showProvider = ref(false);
const saving = ref(false);
const providerForm = reactive({
  id: 0,
  code: "",
  name: "",
  defaultBaseUrl: "",
  status: "active",
  withApiLine: true,
});

async function load() {
  const { data } = await http.get("/api/admin/providers");
  if (data.success) providers.value = data.data;
}

function openCreateProvider() {
  providerForm.id = 0;
  providerForm.code = "";
  providerForm.name = "";
  providerForm.defaultBaseUrl = "";
  providerForm.status = "active";
  providerForm.withApiLine = true;
  showProvider.value = true;
}

function editProvider(row: any) {
  providerForm.id = row.id;
  providerForm.code = row.code;
  providerForm.name = row.name;
  providerForm.defaultBaseUrl = row.defaultBaseUrl;
  providerForm.status = row.status;
  showProvider.value = true;
}

function manageChannel(productLineId: number) {
  void router.push({ path: "/admin/credentials", query: { channelId: String(productLineId) } });
}

async function saveProvider() {
  saving.value = true;
  try {
    if (providerForm.id) {
      await http.patch(`/api/admin/providers/${providerForm.id}`, {
        name: providerForm.name,
        defaultBaseUrl: providerForm.defaultBaseUrl,
        status: providerForm.status,
      });
    } else {
      if (!providerForm.code.trim() || !providerForm.name.trim() || !providerForm.defaultBaseUrl.trim()) {
        ElMessage.warning("请填写 Code、名称与 Base URL");
        return;
      }
      await http.post("/api/admin/providers", {
        code: providerForm.code.trim(),
        name: providerForm.name.trim(),
        defaultBaseUrl: providerForm.defaultBaseUrl.trim(),
        status: providerForm.status,
        withApiLine: providerForm.withApiLine,
      });
    }
    ElMessage.success("已保存");
    showProvider.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "保存失败");
  } finally {
    saving.value = false;
  }
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
