<template>
  <div class="page-card">
    <h2 class="page-title">调用日志</h2>
    <p class="muted">检索全员（或授权范围内）调用记录。查看正文将写入操作审计。</p>

    <el-form :inline="true" class="filters">
      <el-form-item label="员工ID">
        <el-input v-model="filters.employeeId" clearable style="width: 100px" />
      </el-form-item>
      <el-form-item label="模型">
        <el-input v-model="filters.model" clearable style="width: 140px" />
      </el-form-item>
      <el-form-item label="供应商">
        <el-input v-model="filters.providerCode" clearable style="width: 120px" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable style="width: 140px">
          <el-option label="success" value="success" />
          <el-option label="upstream_error" value="upstream_error" />
          <el-option label="client_error" value="client_error" />
          <el-option label="cancelled" value="cancelled" />
        </el-select>
      </el-form-item>
      <el-form-item label="RequestId">
        <el-input v-model="filters.requestId" clearable style="width: 180px" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="items" stripe v-loading="loading">
      <el-table-column prop="createdAt" label="时间" width="170" />
      <el-table-column prop="employeeName" label="员工" width="90" />
      <el-table-column prop="employeePhone" label="手机" width="120" />
      <el-table-column prop="clientModel" label="模型" width="120" />
      <el-table-column prop="providerCode" label="供应商" width="100" />
      <el-table-column prop="productType" label="类型" width="100" />
      <el-table-column prop="status" label="状态" width="120" />
      <el-table-column prop="totalTokens" label="Tokens" width="90" />
      <el-table-column prop="latencyMs" label="耗时" width="80" />
      <el-table-column prop="credentialSuffix" label="Key末四位" width="90" />
      <el-table-column prop="requestId" label="Request ID" show-overflow-tooltip />
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row.requestId)">详情</el-button>
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

    <el-drawer v-model="drawer" title="调用详情" size="50%">
      <template v-if="detail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="Request ID">{{ detail.meta.requestId }}</el-descriptions-item>
          <el-descriptions-item label="员工">
            {{ detail.meta.employeeName }} / {{ detail.meta.employeePhone }}
          </el-descriptions-item>
          <el-descriptions-item label="模型">
            {{ detail.meta.clientModel }} → {{ detail.meta.upstreamModel }}
          </el-descriptions-item>
          <el-descriptions-item label="供应商">{{ detail.meta.providerCode }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ detail.meta.status }}</el-descriptions-item>
          <el-descriptions-item label="Tokens">
            {{ detail.meta.promptTokens }} + {{ detail.meta.completionTokens }} =
            {{ detail.meta.totalTokens }}
          </el-descriptions-item>
          <el-descriptions-item label="错误">
            {{ detail.meta.errorCode }} {{ detail.meta.errorMessage }}
          </el-descriptions-item>
        </el-descriptions>

        <div style="margin-top: 16px">
          <el-button
            v-if="detail.canReadBody && !detail.body"
            type="primary"
            @click="loadBody"
            :loading="loadingBody"
          >
            加载全文（会记入操作审计）
          </el-button>
        </div>

        <template v-if="detail.body">
          <h4>Request Body</h4>
          <pre class="code">{{ pretty(detail.body.requestBody) }}</pre>
          <h4>Response Body</h4>
          <pre class="code">{{ pretty(detail.body.responseBody) }}</pre>
        </template>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";

const filters = reactive({
  employeeId: "",
  model: "",
  providerCode: "",
  status: "",
  requestId: "",
});
const items = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 50;
const loading = ref(false);
const drawer = ref(false);
const detail = ref<any>(null);
const currentRequestId = ref("");
const loadingBody = ref(false);

function pretty(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/logs", {
      params: {
        limit,
        offset: (page.value - 1) * limit,
        employeeId: filters.employeeId || undefined,
        model: filters.model || undefined,
        providerCode: filters.providerCode || undefined,
        status: filters.status || undefined,
        requestId: filters.requestId || undefined,
      },
    });
    if (data.success) {
      items.value = data.data.items;
      total.value = data.data.total;
    }
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "加载失败");
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  load();
}

async function openDetail(requestId: string) {
  currentRequestId.value = requestId;
  const { data } = await http.get(`/api/admin/logs/${requestId}`, {
    params: { includeBody: "false" },
  });
  if (data.success) {
    detail.value = data.data;
    drawer.value = true;
  }
}

async function loadBody() {
  loadingBody.value = true;
  try {
    const { data } = await http.get(`/api/admin/logs/${currentRequestId.value}`, {
      params: { includeBody: "true" },
    });
    if (data.success) detail.value = data.data;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "无权或加载失败");
  } finally {
    loadingBody.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.filters {
  margin-bottom: 8px;
}
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
  max-height: 320px;
  font-size: 12px;
}
</style>
