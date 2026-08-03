<template>
  <div class="page-card">
    <h2 class="page-title">供应商 / 产品线</h2>
    <p class="muted">官方供应商与 API / Coding Plan 产品线。API 默认可公共共享；Coding Plan 默认授权制。</p>

    <el-table :data="providers" row-key="id" default-expand-all>
      <el-table-column type="expand">
        <template #default="{ row }">
          <el-table :data="row.productLines" size="small" style="margin: 0 24px 12px">
            <el-table-column prop="code" label="产品线" width="120" />
            <el-table-column prop="name" label="名称" width="140" />
            <el-table-column prop="productType" label="类型" width="120" />
            <el-table-column prop="shareMode" label="共享模式" width="130" />
            <el-table-column prop="allowAutoRoute" label="自动选路" width="100">
              <template #default="{ row: pl }">{{ pl.allowAutoRoute ? "是" : "否" }}</template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="100" />
            <el-table-column prop="baseUrlOverride" label="Base URL 覆盖" show-overflow-tooltip />
            <el-table-column v-if="auth.isAdmin" label="操作" width="160">
              <template #default="{ row: pl }">
                <el-button link type="primary" @click="editLine(pl)">编辑</el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </el-table-column>
      <el-table-column prop="code" label="Code" width="140" />
      <el-table-column prop="name" label="名称" width="160" />
      <el-table-column prop="defaultBaseUrl" label="默认 Base URL" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column v-if="auth.isAdmin" label="操作" width="120">
        <template #default="{ row }">
          <el-button link type="primary" @click="editProvider(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showProvider" title="编辑供应商" width="520px">
      <el-form label-width="110px">
        <el-form-item label="名称"><el-input v-model="providerForm.name" /></el-form-item>
        <el-form-item label="Base URL"><el-input v-model="providerForm.defaultBaseUrl" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="providerForm.status" style="width: 100%">
            <el-option label="active" value="active" />
            <el-option label="disabled" value="disabled" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showProvider = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveProvider">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showLine" title="编辑产品线" width="520px">
      <el-form label-width="120px">
        <el-form-item label="名称"><el-input v-model="lineForm.name" /></el-form-item>
        <el-form-item label="共享模式">
          <el-select v-model="lineForm.shareMode" style="width: 100%">
            <el-option label="公共池 public_pool" value="public_pool" />
            <el-option label="仅授权 grant_only" value="grant_only" />
            <el-option label="禁用 disabled" value="disabled" />
          </el-select>
        </el-form-item>
        <el-form-item label="自动选路">
          <el-switch v-model="lineForm.allowAutoRoute" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="lineForm.status" style="width: 100%">
            <el-option label="active" value="active" />
            <el-option label="disabled" value="disabled" />
          </el-select>
        </el-form-item>
        <el-form-item label="Base URL 覆盖">
          <el-input v-model="lineForm.baseUrlOverride" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showLine = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveLine">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const providers = ref<Array<Record<string, any>>>([]);
const showProvider = ref(false);
const showLine = ref(false);
const saving = ref(false);
const providerForm = reactive({ id: 0, name: "", defaultBaseUrl: "", status: "active" });
const lineForm = reactive({
  id: 0,
  name: "",
  shareMode: "public_pool",
  allowAutoRoute: true,
  status: "active",
  baseUrlOverride: "" as string | null,
});

async function load() {
  const { data } = await http.get("/api/admin/providers");
  if (data.success) providers.value = data.data;
}

function editProvider(row: any) {
  providerForm.id = row.id;
  providerForm.name = row.name;
  providerForm.defaultBaseUrl = row.defaultBaseUrl;
  providerForm.status = row.status;
  showProvider.value = true;
}

function editLine(pl: any) {
  lineForm.id = pl.id;
  lineForm.name = pl.name;
  lineForm.shareMode = pl.shareMode;
  lineForm.allowAutoRoute = pl.allowAutoRoute;
  lineForm.status = pl.status;
  lineForm.baseUrlOverride = pl.baseUrlOverride ?? "";
  showLine.value = true;
}

async function saveProvider() {
  saving.value = true;
  try {
    await http.patch(`/api/admin/providers/${providerForm.id}`, {
      name: providerForm.name,
      defaultBaseUrl: providerForm.defaultBaseUrl,
      status: providerForm.status,
    });
    ElMessage.success("已保存");
    showProvider.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "保存失败");
  } finally {
    saving.value = false;
  }
}

async function saveLine() {
  saving.value = true;
  try {
    await http.patch(`/api/admin/product-lines/${lineForm.id}`, {
      name: lineForm.name,
      shareMode: lineForm.shareMode,
      allowAutoRoute: lineForm.allowAutoRoute,
      status: lineForm.status,
      baseUrlOverride: lineForm.baseUrlOverride || null,
    });
    ElMessage.success("已保存");
    showLine.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "保存失败");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>
