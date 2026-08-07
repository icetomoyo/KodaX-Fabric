<template>
  <div class="tickets-page">
    <section class="page-card">
      <div class="page-head">
        <div>
          <h2 class="page-title">我的工单</h2>
          <p class="page-subtitle">提交使用问题，并查看自己的历史工单</p>
        </div>
        <el-button type="primary" @click="openCreate">提交工单</el-button>
      </div>

      <el-table v-loading="loading" :data="items" stripe empty-text="暂无工单">
        <el-table-column label="工单编号" width="210">
          <template #default="{ row }">
            <code class="ticket-no">{{ row.ticketNo }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="subject" label="标题" min-width="260" show-overflow-tooltip />
        <el-table-column label="提交时间" width="190">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row.id)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="total > limit" class="pager">
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
    </section>

    <el-dialog v-model="createVisible" title="提交工单" width="560px" destroy-on-close>
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="标题" required>
          <el-input
            v-model="form.subject"
            maxlength="100"
            show-word-limit
            placeholder="请简要说明遇到的问题"
            :disabled="submitting"
          />
        </el-form-item>
        <el-form-item label="问题描述" required>
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="8"
            maxlength="5000"
            show-word-limit
            resize="vertical"
            placeholder="请描述问题现象、发生时间和相关操作"
            :disabled="submitting"
          />
        </el-form-item>
        <p class="form-tip">工单提交后不能修改或删除，请确认内容准确。</p>
      </el-form>
      <template #footer>
        <el-button :disabled="submitting" @click="createVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="submitTicket"
        >
          提交
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="工单详情" width="640px">
      <div v-loading="detailLoading" class="detail-body">
        <template v-if="selectedTicket">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="工单编号">
              <code class="ticket-no">{{ selectedTicket.ticketNo }}</code>
            </el-descriptions-item>
            <el-descriptions-item label="提交时间">
              {{ formatDateTime(selectedTicket.createdAt) }}
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
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";

type TicketListItem = {
  id: number;
  ticketNo: string;
  subject: string;
  createdAt: string;
};

type TicketDetail = TicketListItem & {
  content: string;
};

const items = ref<TicketListItem[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 10;
const loading = ref(false);
const createVisible = ref(false);
const submitting = ref(false);
const detailVisible = ref(false);
const detailLoading = ref(false);
const selectedTicket = ref<TicketDetail | null>(null);
const form = reactive({ subject: "", content: "" });

const canSubmit = computed(() => {
  const subject = form.subject.trim();
  const content = form.content.trim();
  return subject.length >= 1 && subject.length <= 100
    && content.length >= 1 && content.length <= 5000;
});

function errorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })
    .response?.data?.message ?? fallback;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/me/tickets", {
      params: { limit, offset: (page.value - 1) * limit },
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

function openCreate() {
  form.subject = "";
  form.content = "";
  createVisible.value = true;
}

async function submitTicket() {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    const { data } = await http.post("/api/me/tickets", {
      subject: form.subject.trim(),
      content: form.content.trim(),
    });
    createVisible.value = false;
    page.value = 1;
    ElMessage.success(`工单 ${data.data.ticketNo} 已提交`);
    await load();
  } catch (error) {
    ElMessage.error(errorMessage(error, "工单提交失败"));
  } finally {
    submitting.value = false;
  }
}

async function openDetail(id: number) {
  selectedTicket.value = null;
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    const { data } = await http.get(`/api/me/tickets/${id}`);
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
.tickets-page {
  min-width: 0;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
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

.form-tip {
  margin: 0;
  color: #64748b;
  font-size: 12px;
}

.detail-body {
  min-height: 160px;
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
  min-height: 120px;
  padding: 14px 16px;
  overflow-wrap: anywhere;
  color: #1f2937;
  line-height: 1.7;
  white-space: pre-wrap;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

@media (max-width: 640px) {
  .page-head {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
