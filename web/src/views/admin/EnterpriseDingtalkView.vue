<template>
  <div class="dingtalk-page">
    <section class="page-card tree-card">
      <div class="toolbar">
        <el-input
          v-model="query"
          class="tree-search"
          clearable
          placeholder="搜索部门"
          :prefix-icon="Search"
        />
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </div>

      <el-alert
        v-if="notConfigured"
        class="hint"
        type="warning"
        :closable="false"
        show-icon
        title="未配置钉钉接入凭证"
        description="在仓库根目录 .env 填写 DINGTALK_APP_KEY / DINGTALK_APP_SECRET 后重启 API。"
      />
      <el-alert
        v-else-if="errorMessage"
        class="hint"
        type="error"
        :closable="false"
        show-icon
        :title="errorMessage"
      />

      <div v-loading="loading" class="tree-body">
        <el-empty
          v-if="!loading && !notConfigured && !errorMessage && !tree.length"
          description="暂无钉钉部门"
          :image-size="64"
        />
        <el-tree
          v-else-if="tree.length"
          ref="treeRef"
          class="org-tree"
          :data="tree"
          node-key="deptId"
          default-expand-all
          :expand-on-click-node="false"
          :filter-node-method="filterNode"
        >
          <template #default="{ data }">
            <div class="tree-row">
              <el-icon class="tree-icon">
                <OfficeBuilding v-if="data.parentId === 0" />
                <Folder v-else />
              </el-icon>
              <span class="tree-label">{{ data.name }}</span>
              <span class="tree-id">{{ data.deptId }}</span>
            </div>
          </template>
        </el-tree>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { Folder, OfficeBuilding, Refresh, Search } from "@element-plus/icons-vue";
import type { ElTree } from "element-plus";
import { http } from "@/api/http";

type DingtalkDept = {
  deptId: number;
  name: string;
  parentId: number;
  children?: DingtalkDept[];
};

const loading = ref(false);
const query = ref("");
const tree = ref<DingtalkDept[]>([]);
const treeRef = ref<InstanceType<typeof ElTree>>();
const notConfigured = ref(false);
const errorMessage = ref("");

watch(query, (value) => {
  treeRef.value?.filter(value);
});

function filterNode(value: string, data: DingtalkDept) {
  if (!value) return true;
  return data.name.includes(value) || String(data.deptId).includes(value);
}

function getErrorMessage(error: unknown, fallback: string): string {
  const requestError = error as { response?: { data?: { message?: string; code?: string } }; message?: string };
  return requestError.response?.data?.message || requestError.message || fallback;
}

async function load() {
  loading.value = true;
  notConfigured.value = false;
  errorMessage.value = "";
  try {
    const { data } = await http.get("/api/admin/enterprise-dingtalk/departments");
    tree.value = data.success && data.data ? [data.data] : [];
  } catch (error) {
    tree.value = [];
    const requestError = error as { response?: { data?: { code?: string } } };
    if (requestError.response?.data?.code === "DINGTALK_NOT_CONFIGURED") {
      notConfigured.value = true;
    } else {
      errorMessage.value = getErrorMessage(error, "钉钉部门树加载失败");
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.dingtalk-page {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 100px);
}

.tree-card {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.tree-search {
  max-width: 280px;
}

.hint {
  margin-bottom: 12px;
}

.tree-body {
  flex: 1;
  min-height: 240px;
}

.org-tree {
  background: transparent;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tree-icon {
  color: var(--el-text-color-secondary);
}

.tree-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-id {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
