<template>
  <div class="page-card">
    <div class="page-head">
      <div>
        <h2 class="page-title">工单管理</h2>
        <p class="page-subtitle">查看员工提交的问题工单</p>
      </div>
    </div>

    <el-form inline class="filters" @submit.prevent>
      <el-form-item>
        <el-input
          v-model="q"
          clearable
          maxlength="100"
          placeholder="工单编号 / 标题 / 员工姓名"
          style="width: 300px"
          @clear="search"
          @keyup.enter="search"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="items" stripe empty-text="暂无工单">
      <el-table-column label="工单编号" width="210">
        <template #default="{ row }">
          <code class="ticket-no">{{ row.ticketNo }}</code>
        </template>
      </el-table-column>
      <el-table-column prop="subject" label="标题" min-width="240" show-overflow-tooltip />
      <el-table-column prop="employeeName" label="提交员工" width="130" />
      <el-table-column label="部门" width="160">
        <template #default="{ row }">{{ row.employeeDept || "—" }}</template>
      </el-table-column>
      <el-table-column label="提交时间" width="190">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="90" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row.id)">查看</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        background
        small
        layout="total, prev, pager, next"
        :total="total"
        :page-size="limit"
        @current-change="load"
      />
    </div>

    <el-dialog v-model="detailVisible" title="工单详情" width="680px">
      <div v-loading="detailLoading" class="detail-body">
        <template v-if="selectedTicket">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="工单编号">
              <code class="ticket-no">{{ selectedTicket.ticketNo }}</code>
            </el-descriptions-item>
            <el-descriptions-item label="提交时间">
              {{ formatDateTime(selectedTicket.createdAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="提交员工">
              {{ selectedTicket.employeeName }}
            </el-descriptions-item>
            <el-descriptions-item label="手机号">
              {{ selectedTicket.employeePhone }}
            </el-descriptions-item>
            <el-descriptions-item label="部门">
              {{ selectedTicket.employeeDept || "—" }}
            </el-descriptions-item>
            <el-descriptions-item label="标题">
              {{ selectedTicket.subject }}
            </el-descriptions-item>
          </el-descriptions>
          <div class="content-section">
            <div class="content-label">问题描述</div>
            <div class="ticket-content">{{ selectedTicket.content }}</div>
          </div>
        </template>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";

type AdminTicketListItem = {
  id: number;
  ticketNo: string;
  subject: string;
  employeeId: number;
  employeeName: string;
  employeeDept: string | null;
  createdAt: string;
};

type AdminTicketDetail = AdminTicketListItem & {
  content: string;
  employeePhone: string;
};

const items = ref<AdminTicketListItem[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 10;
const q = ref("");
const loading = ref(false);
const detailVisible = ref(false);
const detailLoading = ref(false);
const selectedTicket = ref<AdminTicketDetail | null>(null);

function errorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })
    .response?.data?.message ?? fallback;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/tickets", {
      params: {
        limit,
        offset: (page.value - 1) * limit,
        q: q.value.trim() || undefined,
      },
    });
    if (data.success) {
      items.value = data.data.items;
      total.value = data.data.total;
    }
  } catch (error) {
    ElMessage.error(errorMessage(error, "工单加载失败"));
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  load();
}

async function openDetail(id: number) {
  selectedTicket.value = null;
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    const { data } = await http.get(`/api/admin/tickets/${id}`);
    if (data.success) selectedTicket.value = data.data;
  } catch (error) {
    detailVisible.value = false;
    ElMessage.error(errorMessage(error, "工单详情加载失败"));
  } finally {
    detailLoading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.page-head {
  margin-bottom: 16px;
}

.page-title {
  margin: 0;
  font-size: 20px;
  color: #0f172a;
}

.page-subtitle {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 13px;
}

.filters {
  margin-bottom: 8px;
}

.ticket-no {
  color: #475569;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.detail-body {
  min-height: 180px;
}

.content-section {
  margin-top: 18px;
}

.content-label {
  margin-bottom: 8px;
  color: #475569;
  font-size: 13px;
  font-weight: 600;
}

.ticket-content {
  min-height: 140px;
  padding: 14px 16px;
  overflow-wrap: anywhere;
  color: #1f2937;
  line-height: 1.7;
  white-space: pre-wrap;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
</style>
