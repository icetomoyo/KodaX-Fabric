<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">API Key</h2>
      <el-button type="primary" @click="createKey" :loading="creating">生成新 Key</el-button>
    </div>

    <div v-if="freshKey" class="fresh-key">
      <el-input :model-value="freshKey" readonly>
        <template #append>
          <el-button @click="copyFreshKey">复制</el-button>
        </template>
      </el-input>
      <el-button @click="freshKey = ''">隐藏</el-button>
    </div>

    <el-table :data="keys" stripe>
      <el-table-column prop="name" label="名称" width="140" />
      <el-table-column prop="keyPrefix" label="前缀" width="140" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column label="创建时间" min-width="210">
        <template #default="{ row }">
          {{ formatDateTime(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column label="最近使用" min-width="210">
        <template #default="{ row }">
          {{ formatDateTime(row.lastUsedAt) }}
        </template>
      </el-table-column>
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
import { formatDateTime } from "@/lib/date-time";

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

async function copyFreshKey() {
  try {
    await navigator.clipboard.writeText(freshKey.value);
    ElMessage.success("已复制");
  } catch {
    ElMessage.error("复制失败");
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
.fresh-key {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
</style>
