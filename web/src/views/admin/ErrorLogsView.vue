<template>
  <el-card class="logs-page" shadow="never">
    <div class="page-head">
      <el-link
        href="https://docs.bigmodel.cn/cn/faq/api-code"
        target="_blank"
        rel="noopener noreferrer"
        type="primary"
      >
        智谱错误码
      </el-link>
    </div>

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

    <el-table
      v-loading="loading"
      :data="items"
      stripe
      empty-text="暂无报错记录"
    >
      <el-table-column label="企业 / 部门" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          {{ orgScopeLabel(row) }}
        </template>
      </el-table-column>
      <el-table-column label="员工" width="100" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.employeeName || "—" }}
        </template>
      </el-table-column>
      <el-table-column prop="clientModel" label="模型" width="140" show-overflow-tooltip />
      <el-table-column label="错误信息" min-width="280" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.errorMessage || "—" }}
        </template>
      </el-table-column>
      <el-table-column label="时间" width="180">
        <template #default="{ row }">
          {{ formatDateTime(row.createdAt) }}
        </template>
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
      :title="detail?.requestId || '报错详情'"
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
            <el-descriptions-item label="员工">
              {{ detail.employeeName || "—" }}
              <template v-if="detail.employeePhone"> · {{ detail.employeePhone }}</template>
              <template v-if="detail.employeeDept"> · {{ detail.employeeDept }}</template>
            </el-descriptions-item>
            <el-descriptions-item label="企业">{{ detail.enterpriseName || "—" }}</el-descriptions-item>
            <el-descriptions-item label="部门">{{ departmentLabel(detail) }}</el-descriptions-item>
            <el-descriptions-item label="模型">{{ detail.clientModel }}</el-descriptions-item>
            <el-descriptions-item label="渠道">
              {{ providerText(detail.providerCode) }} · {{ productTypeText(detail.productType) }}
            </el-descriptions-item>
            <el-descriptions-item label="状态">{{ statusText(detail.status) }}</el-descriptions-item>
            <el-descriptions-item label="错误码">{{ detail.errorCode || "—" }}</el-descriptions-item>
            <el-descriptions-item label="HTTP">{{ detail.httpStatus ?? "—" }}</el-descriptions-item>
            <el-descriptions-item label="上游 HTTP">{{ detail.upstreamStatus ?? "—" }}</el-descriptions-item>
            <el-descriptions-item label="渠道凭证">{{ detail.credentialId ?? "—" }}</el-descriptions-item>
            <el-descriptions-item label="时间">{{ formatDateTime(detail.createdAt) }}</el-descriptions-item>
          </el-descriptions>
          <el-alert
            type="error"
            :closable="false"
            title="错误信息"
            :description="detail.errorMessage || '—'"
            show-icon
          />
        </template>
      </div>
      <template #footer>
        <el-button @click="showDetail = false">关闭</el-button>
      </template>
    </el-drawer>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { copyText } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/date-time";
import { TABLE_PAGE_SIZE } from "@/lib/table-page";

type LogStatus = "upstream_error" | "client_error" | "cancelled";
type ProductType = "api" | "coding_plan";

interface ErrorLogRow {
  id: number;
  requestId: string;
  employeeId: number;
  employeeName: string | null;
  enterpriseName: string | null;
  departmentName?: string | null;
  teamName: string | null;
  clientModel: string;
  providerCode: string | null;
  productType?: ProductType | null;
  status: LogStatus;
  httpStatus: number | null;
  upstreamStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface ErrorLogDetail extends ErrorLogRow {
  employeePhone: string;
  employeeDept: string | null;
  credentialId: number | null;
}

type EmployeeOption = {
  id: number;
  name: string;
  phone: string;
};

const filters = reactive({
  employeeId: null as number | null,
});
const employees = ref<EmployeeOption[]>([]);
const selectedEmployee = ref<EmployeeOption | null>(null);
const employeesLoading = ref(false);
const items = ref<ErrorLogRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = TABLE_PAGE_SIZE;
const loading = ref(false);
const showDetail = ref(false);
const detailLoading = ref(false);
const detail = ref<ErrorLogDetail | null>(null);

const hasFilters = computed(() => Boolean(filters.employeeId));

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

function statusText(status: LogStatus): string {
  return (
    {
      upstream_error: "上游错误",
      client_error: "请求错误",
      cancelled: "已取消",
    } as const
  )[status];
}

function productTypeText(value: ProductType | null | undefined): string {
  if (value === "coding_plan") return "套餐";
  if (value === "api") return "按量";
  return "—";
}

function providerText(code: string | null | undefined): string {
  if (!code) return "—";
  const names: Record<string, string> = {
    glm: "智谱/GLM",
    kimi: "月之暗面/Kimi",
    deepseek: "深度求索/DeepSeek",
    minimax: "MiniMax",
  };
  return names[code.toLowerCase()] ?? code;
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

function listQueryParams() {
  const params: Record<string, string | number> = {
    limit,
    offset: (page.value - 1) * limit,
  };
  if (filters.employeeId) params.employeeId = filters.employeeId;
  return params;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/error-logs", {
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

async function openDetail(row: ErrorLogRow) {
  showDetail.value = true;
  detailLoading.value = true;
  detail.value = null;
  try {
    const { data } = await http.get(`/api/admin/error-logs/${encodeURIComponent(row.requestId)}`, {
      timeout: 60_000,
    });
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

onMounted(() => {
  void load();
  void searchEmployees("");
});
</script>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 12px;
}
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
</style>
