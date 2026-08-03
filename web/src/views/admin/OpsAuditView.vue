<template>
  <div class="page-card">
    <h2 class="page-title">操作审计</h2>
    <p class="muted">管理员操作留痕：建号、改渠道、查看他人对话正文等。</p>

    <el-form inline>
      <el-form-item label="动作">
        <el-input v-model="action" clearable placeholder="如 log.read_body" style="width: 200px" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="items" stripe v-loading="loading">
      <el-table-column prop="createdAt" label="时间" width="170" />
      <el-table-column prop="actorName" label="操作人" width="100" />
      <el-table-column prop="actorPhone" label="手机" width="120" />
      <el-table-column prop="action" label="动作" width="180" />
      <el-table-column prop="targetType" label="对象类型" width="140" />
      <el-table-column prop="targetId" label="对象ID" width="120" />
      <el-table-column prop="ip" label="IP" width="120" />
      <el-table-column label="详情">
        <template #default="{ row }">
          <el-button link type="primary" @click="showDetail(row)">查看</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-size="limit"
        v-model:current-page="page"
        @current-change="load"
      />
    </div>

    <el-dialog v-model="detailVisible" title="操作详情" width="640px">
      <pre class="code">{{ detailText }}</pre>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { http } from "@/api/http";

const items = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 50;
const loading = ref(false);
const action = ref("");
const detailVisible = ref(false);
const detailText = ref("");

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/ops-audit", {
      params: {
        limit,
        offset: (page.value - 1) * limit,
        action: action.value || undefined,
      },
    });
    if (data.success) {
      items.value = data.data.items;
      total.value = data.data.total;
    }
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  load();
}

function showDetail(row: any) {
  detailText.value = JSON.stringify(row, null, 2);
  detailVisible.value = true;
}

onMounted(load);
</script>

<style scoped>
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
.code {
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px;
  border-radius: 8px;
  overflow: auto;
  max-height: 480px;
  font-size: 12px;
}
</style>
