<template>
  <el-card shadow="never" class="hits-page">
    <el-form :inline="true" class="filters" @keyup.enter="search">
      <el-form-item>
        <el-select
          v-model="filters.employeeId"
          clearable
          filterable
          remote
          :remote-method="searchEmployees"
          :loading="employeesLoading"
          placeholder="按人搜索"
          style="width: 220px"
          @change="onEmployeeChange"
        >
          <el-option
            v-for="item in employees"
            :key="item.id"
            :label="employeeOptionLabel(item)"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
      </el-form-item>
      <el-form-item v-if="hasFilters">
        <el-button @click="resetFilters">重置</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="items" stripe :empty-text="emptyText">
      <el-table-column label="员工" width="120" show-overflow-tooltip>
        <template #default="{ row }">{{ row.employeeName || "—" }}</template>
      </el-table-column>
      <el-table-column label="命中词" width="140" show-overflow-tooltip>
        <template #default="{ row }">{{ row.matchedWord }}</template>
      </el-table-column>
      <el-table-column prop="clientModel" label="模型" min-width="120" show-overflow-tooltip />
      <el-table-column label="协议" width="140">
        <template #default="{ row }">{{ protocolLabel(row.protocol) }}</template>
      </el-table-column>
      <el-table-column label="摘要" min-width="240" show-overflow-tooltip>
        <template #default="{ row }">{{ row.excerpt || "—" }}</template>
      </el-table-column>
      <el-table-column label="时间" width="180">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="72" align="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
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

    <el-drawer
      v-model="showDetail"
      :title="detail?.requestId || detailTitle"
      size="min(720px, 96vw)"
      destroy-on-close
    >
      <div v-loading="detailLoading" class="detail-body">
        <template v-if="detail">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="Request ID">
              <el-button link type="primary" @click="copyRequestId(detail.requestId)">
                {{ detail.requestId }}
              </el-button>
            </el-descriptions-item>
            <el-descriptions-item label="命中词">{{ detail.matchedWord }}</el-descriptions-item>
            <el-descriptions-item label="员工">
              {{ detail.employeeName || "—" }}
              <template v-if="detail.employeePhone"> · {{ detail.employeePhone }}</template>
            </el-descriptions-item>
            <el-descriptions-item label="企业 / 部门">
              {{ orgScopeLabel(detail) }}
            </el-descriptions-item>
            <el-descriptions-item label="模型">{{ detail.clientModel }}</el-descriptions-item>
            <el-descriptions-item label="协议">{{ protocolLabel(detail.protocol) }}</el-descriptions-item>
            <el-descriptions-item label="路径" :span="2">{{ detail.path || "—" }}</el-descriptions-item>
            <el-descriptions-item label="IP">{{ detail.ip || "—" }}</el-descriptions-item>
            <el-descriptions-item label="时间">{{ formatDateTime(detail.createdAt) }}</el-descriptions-item>
            <el-descriptions-item label="User-Agent" :span="2">
              {{ detail.userAgent || "—" }}
            </el-descriptions-item>
          </el-descriptions>
          <el-alert
            type="warning"
            :closable="false"
            title="命中摘要"
            :description="detail.excerpt || '—'"
            show-icon
          />
          <div class="preview-block">
            <div class="preview-label">请求预览</div>
            <pre class="preview">{{ formatPreview(detail.requestPreview) }}</pre>
          </div>
        </template>
      </div>
      <template #footer>
        <el-button @click="showDetail = false">关闭</el-button>
      </template>
    </el-drawer>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { copyText } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/date-time";
import { TABLE_PAGE_SIZE } from "@/lib/table-page";

type Protocol = "openai_chat" | "anthropic_messages" | "openai_responses";

interface HitRow {
  id: number;
  requestId: string;
  employeeId: number;
  employeeName: string | null;
  employeePhone: string | null;
  enterpriseName: string | null;
  departmentName?: string | null;
  teamName: string | null;
  clientModel: string;
  protocol: Protocol;
  matchedWord: string;
  excerpt: string | null;
  createdAt: string;
}

interface HitDetail extends HitRow {
  employeeDept: string | null;
  path: string;
  requestPreview: unknown;
  userAgent: string | null;
  ip: string | null;
}

type EmployeeOption = {
  id: number;
  name: string;
  phone: string;
};

const route = useRoute();
const hitAction = computed<"detect" | "intercept">(() =>
  route.meta.sensitiveHitAction === "intercept" ? "intercept" : "detect",
);
const emptyText = computed(() =>
  hitAction.value === "intercept" ? "暂无拦截记录" : "暂无检测记录",
);
const detailTitle = computed(() =>
  hitAction.value === "intercept" ? "拦截记录详情" : "检测记录详情",
);

const filters = reactive({
  employeeId: null as number | null,
});
const employees = ref<EmployeeOption[]>([]);
const selectedEmployee = ref<EmployeeOption | null>(null);
const employeesLoading = ref(false);
const items = ref<HitRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = TABLE_PAGE_SIZE;
const loading = ref(false);
const showDetail = ref(false);
const detailLoading = ref(false);
const detail = ref<HitDetail | null>(null);

const hasFilters = computed(() => Boolean(filters.employeeId));

function protocolLabel(protocol: string | null | undefined): string {
  if (protocol === "openai_chat") return "OpenAI Chat";
  if (protocol === "openai_responses") return "OpenAI Responses";
  if (protocol === "anthropic_messages") return "Anthropic Messages";
  return protocol || "—";
}

function departmentLabel(row: { departmentName?: string | null; teamName: string | null }): string {
  if (row.departmentName && row.departmentName !== "默认部门") return row.departmentName;
  if (row.teamName && row.teamName !== "默认团队") return row.teamName;
  return "—";
}

function orgScopeLabel(row: {
  enterpriseName: string | null;
  departmentName?: string | null;
  teamName: string | null;
}): string {
  const unit = departmentLabel(row);
  if (row.enterpriseName && unit !== "—") return `${row.enterpriseName} · ${unit}`;
  return row.enterpriseName || (unit === "—" ? "—" : unit);
}

function employeeOptionLabel(item: EmployeeOption): string {
  return item.phone ? `${item.name} · ${item.phone}` : item.name;
}

function rememberSelectedEmployee(id: number | null) {
  if (id == null) {
    selectedEmployee.value = null;
    return;
  }
  selectedEmployee.value = employees.value.find((row) => row.id === id) ?? selectedEmployee.value;
}

async function searchEmployees(query: string) {
  employeesLoading.value = true;
  try {
    const { data } = await http.get("/api/admin/users", {
      params: { q: query.trim() || undefined, limit: 30, status: "active" },
    });
    if (!data.success) throw new Error(data.message || "搜索员工失败");
    const rows: EmployeeOption[] = Array.isArray(data.data)
      ? data.data.map((row: EmployeeOption) => ({
          id: row.id,
          name: row.name,
          phone: row.phone,
        }))
      : [];
    const current = selectedEmployee.value;
    employees.value =
      current && !rows.some((row) => row.id === current.id) ? [current, ...rows] : rows;
  } catch (e: any) {
    employees.value = selectedEmployee.value ? [selectedEmployee.value] : [];
    ElMessage.error(e.response?.data?.message || "搜索员工失败");
  } finally {
    employeesLoading.value = false;
  }
}

function onEmployeeChange(id: number | null) {
  rememberSelectedEmployee(id);
  search();
}

async function copyRequestId(requestId: string) {
  const copied = await copyText(requestId);
  if (copied) ElMessage.success("Request ID 已复制");
  else ElMessage.error("复制失败");
}

function formatPreview(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function listQueryParams() {
  const params: Record<string, string | number> = {
    limit,
    offset: (page.value - 1) * limit,
    action: hitAction.value,
  };
  if (filters.employeeId) params.employeeId = filters.employeeId;
  return params;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/sensitive-word-hits", {
      params: listQueryParams(),
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

async function openDetail(row: HitRow) {
  showDetail.value = true;
  detailLoading.value = true;
  detail.value = null;
  try {
    const { data } = await http.get(
      `/api/admin/sensitive-word-hits/${encodeURIComponent(row.requestId)}`,
    );
    if (data.success) detail.value = data.data;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "详情加载失败");
    showDetail.value = false;
  } finally {
    detailLoading.value = false;
  }
}

function search() {
  page.value = 1;
  load();
}

function resetFilters() {
  filters.employeeId = null;
  selectedEmployee.value = null;
  page.value = 1;
  load();
}

watch(
  hitAction,
  () => {
    page.value = 1;
    void load();
  },
  { immediate: true },
);

onMounted(() => {
  void searchEmployees("");
});
</script>

<style scoped>
.filters {
  margin-bottom: 12px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.preview-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.preview-label {
  color: var(--el-text-color-secondary);
}
.preview {
  margin: 0;
  max-height: 360px;
  overflow: auto;
  padding: 12px;
  background: #0f172a;
  color: #e5e7eb;
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
