<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">API Key</h2>
      <el-button type="primary" @click="createKey" :loading="creating">生成新 Key</el-button>
    </div>
    <p class="muted">Key 明文仅在创建时展示一次，请妥善保存。网关调用使用此 Key，不是登录密码。</p>

    <el-alert
      v-if="freshKey"
      type="success"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
      title="请立即复制保存"
      :description="freshKey"
    />

    <el-table :data="keys" stripe>
      <el-table-column prop="name" label="名称" width="140" />
      <el-table-column prop="keyPrefix" label="前缀" width="140" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column prop="createdAt" label="创建时间" />
      <el-table-column prop="lastUsedAt" label="最近使用" />
      <el-table-column label="操作" width="120">
        <template #default="{ row }">
          <el-button
            v-if="row.status === 'active'"
            link
            type="danger"
            @click="revoke(row.id)"
          >
            吊销
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";

type KeyRow = {
  id: number;
  name: string;
  keyPrefix: string;
  status: string;
  createdAt: string;
  lastUsedAt?: string | null;
};

const keys = ref<KeyRow[]>([]);
const creating = ref(false);
const freshKey = ref("");

async function load() {
  const { data } = await http.get("/api/me/api-keys");
  if (data.success) keys.value = data.data;
}

async function createKey() {
  creating.value = true;
  try {
    const { data } = await http.post("/api/me/api-keys", { name: "default" });
    if (!data.success) throw new Error(data.message);
    freshKey.value = data.data.key;
    ElMessage.success("已生成");
    await load();
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || "生成失败");
  } finally {
    creating.value = false;
  }
}

async function revoke(id: number) {
  await ElMessageBox.confirm("吊销后不可恢复，确认？", "提示");
  await http.post(`/api/me/api-keys/${id}/revoke`);
  ElMessage.success("已吊销");
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
