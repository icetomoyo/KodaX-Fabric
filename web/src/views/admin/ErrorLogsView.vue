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
        <el-input
          v-model="filters.requestId"
          clearable
          placeholder="Request ID"
          style="width: 220px"
        />
      </el-form-item>
      <el-form-item v-if="auth.isSuperAdmin">
        <el-select
          v-model="filters.enterpriseId"
          clearable
          filterable
          :loading="enterprisesLoading"
          placeholder="全部企业"
          style="width: 180px"
          @change="onEnterpriseChange"
        >
          <el-option
            v-for="item in enterprises"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item v-if="auth.isSuperAdmin || auth.isOrgAdmin">
        <el-select
          v-model="filters.teamId"
          clearable
          filterable
          :disabled="auth.isSuperAdmin && !filters.enterpriseId"
          :loading="teamsLoading"
          placeholder="全部团队"
          style="width: 180px"
          @change="onTeamChange"
        >
          <el-option
            v-for="item in teams"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-select
          v-model="filters.employeeId"
          clearable
          filterable
          :disabled="auth.isSuperAdmin && !filters.enterpriseId"
          :loading="employeesLoading"
          placeholder="全部员工"
          style="width: 160px"
        >
          <el-option
            v-for="item in visibleEmployees"
            :key="item.id"
            :label="item.name"
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
      <el-table-column label="企业 / 团队" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.enterpriseName || "—" }}
          <template v-if="row.teamName"> · {{ row.teamName }}</template>
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
            <el-descriptions-item label="团队">{{ detail.teamName || "—" }}</el-descriptions-item>
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
import { useAuthStore } from "@/stores/auth";

type LogStatus = "upstream_error" | "client_error" | "cancelled";
type ProductType = "api" | "coding_plan";

interface ErrorLogRow {
  id: number;
  requestId: string;
  employeeId: number;
  employeeName: string | null;
  enterpriseName: string | null;
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

interface NamedOption {
  id: number;
  name: string;
}

const auth = useAuthStore();

const filters = reactive({
  requestId: "",
  enterpriseId: null as number | null,
  teamId: null as number | null,
  employeeId: null as number | null,
});
const enterprises = ref<NamedOption[]>([]);
const enterprisesLoading = ref(false);
const teams = ref<NamedOption[]>([]);
const teamsLoading = ref(false);
const enterpriseEmployees = ref<NamedOption[]>([]);
const teamEmployees = ref<NamedOption[] | null>(null);
const employeesLoading = ref(false);
const items = ref<ErrorLogRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = TABLE_PAGE_SIZE;
const loading = ref(false);
const showDetail = ref(false);
const detailLoading = ref(false);
const detail = ref<ErrorLogDetail | null>(null);

const hasFilters = computed(() => Boolean(
  filters.requestId.trim() || filters.enterpriseId || filters.teamId || filters.employeeId,
));

const visibleEmployees = computed(() => {
  if (teamEmployees.value) return teamEmployees.value;
  const seen = new Set<number>();
  return enterpriseEmployees.value.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
});

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

async function copyRequestId(requestId: string) {
  const copied = await copyText(requestId);
  if (copied) ElMessage.success("Request ID 已复制");
  else ElMessage.error("复制失败");
}

async function onEnterpriseChange() {
  filters.teamId = null;
  filters.employeeId = null;
  teams.value = [];
  enterpriseEmployees.value = [];
  teamEmployees.value = null;
  if (!filters.enterpriseId) return;
  await loadTeamsAndEmployees(filters.enterpriseId);
}

async function onTeamChange() {
  filters.employeeId = null;
  if (!filters.teamId) {
    teamEmployees.value = null;
    return;
  }
  employeesLoading.value = true;
  try {
    const { data } = await http.get(`/api/admin/teams/${filters.teamId}/members`);
    if (data.success) {
      teamEmployees.value = (data.data as Array<{ employeeId: number; name: string }>).map((row) => ({
        id: row.employeeId,
        name: row.name,
      }));
    }
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "员工列表加载失败");
    teamEmployees.value = null;
  } finally {
    employeesLoading.value = false;
  }
}

async function loadTeamsAndEmployees(enterpriseId?: number) {
  teamsLoading.value = true;
  employeesLoading.value = true;
  try {
    const [teamRes, userRes] = await Promise.all([
      http.get("/api/admin/teams", enterpriseId ? { params: { enterpriseId } } : undefined),
      http.get("/api/admin/users", {
        params: { ...(enterpriseId ? { enterpriseId } : {}), limit: 200 },
      }),
    ]);
    if (teamRes.data.success) {
      teams.value = (teamRes.data.data as NamedOption[]).map((row) => ({
        id: row.id,
        name: row.name,
      }));
    }
    if (userRes.data.success) {
      enterpriseEmployees.value = (userRes.data.data as Array<{
        id: number;
        name: string;
        role: string;
      }>)
        .filter((row) => row.role !== "admin")
        .map((row) => ({ id: row.id, name: row.name }));
    }
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "筛选项加载失败");
  } finally {
    teamsLoading.value = false;
    employeesLoading.value = false;
  }
}

async function loadTeamAdminEmployees() {
  employeesLoading.value = true;
  try {
    const { data } = await http.get("/api/admin/teams");
    if (!data.success) return;
    const teamRows = data.data as NamedOption[];
    const members = await Promise.all(
      teamRows.map(async (team) => {
        const res = await http.get(`/api/admin/teams/${team.id}/members`);
        if (!res.data.success) return [];
        return (res.data.data as Array<{ employeeId: number; name: string }>).map((row) => ({
          id: row.employeeId,
          name: row.name,
        }));
      }),
    );
    const seen = new Set<number>();
    enterpriseEmployees.value = members.flat().filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "员工列表加载失败");
  } finally {
    employeesLoading.value = false;
  }
}

async function loadEnterprises() {
  if (!auth.isSuperAdmin) return;
  enterprisesLoading.value = true;
  try {
    const { data } = await http.get("/api/admin/enterprises");
    if (data.success) {
      enterprises.value = data.data.map((row: { id: number; name: string }) => ({
        id: row.id,
        name: row.name,
      }));
    }
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "企业列表加载失败");
  } finally {
    enterprisesLoading.value = false;
  }
}

function listQueryParams() {
  const params: Record<string, string | number> = {
    limit,
    offset: (page.value - 1) * limit,
  };
  const requestId = filters.requestId.trim();
  if (requestId) params.requestId = requestId;
  if (auth.isSuperAdmin && filters.enterpriseId) params.enterpriseId = filters.enterpriseId;
  if ((auth.isSuperAdmin || auth.isOrgAdmin) && filters.teamId) params.teamId = filters.teamId;
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
  filters.requestId = "";
  filters.enterpriseId = null;
  filters.teamId = null;
  filters.employeeId = null;
  teamEmployees.value = null;
  if (auth.isSuperAdmin) {
    teams.value = [];
    enterpriseEmployees.value = [];
  }
  page.value = 1;
  load();
}

onMounted(() => {
  void load();
  void loadEnterprises();
  if (auth.isOrgAdmin) void loadTeamsAndEmployees();
  if (auth.isTeamAdmin) void loadTeamAdminEmployees();
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
