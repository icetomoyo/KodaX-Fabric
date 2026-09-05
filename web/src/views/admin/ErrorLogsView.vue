<template>
  <div class="page-card logs-page">
    <div class="page-head">
      <a
        class="doc-link"
        href="https://docs.bigmodel.cn/cn/faq/api-code"
        target="_blank"
        rel="noopener noreferrer"
      >
        智谱错误码
      </a>
    </div>

    <el-form :inline="true" size="small" class="filters" @keyup.enter="search">
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
      size="small"
      class="logs-table"
      empty-text="暂无报错记录"
    >
      <el-table-column label="企业 / 团队" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="employee-text">
            {{ row.enterpriseName || "—" }}
            <template v-if="row.teamName"> · {{ row.teamName }}</template>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="员工" width="100" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="employee-text">{{ row.employeeName || "—" }}</span>
        </template>
      </el-table-column>
      <el-table-column label="模型" width="140" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="model-text">{{ row.clientModel }}</span>
        </template>
      </el-table-column>
      <el-table-column label="错误信息" min-width="280">
        <template #default="{ row }">
          <div class="meaning">{{ row.errorMessage || "—" }}</div>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="156">
        <template #default="{ row }">
          <span class="time-text">{{ formatDateTime(row.createdAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="72" align="right">
        <template #default="{ row }">
          <el-button class="detail-button" link @click="openDetail(row)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        background
        size="small"
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
          <dl class="detail-grid">
            <div>
              <dt>Request ID</dt>
              <dd>
                <el-button class="request-id-button" link @click="copyRequestId(detail.requestId)">
                  {{ detail.requestId }}
                </el-button>
              </dd>
            </div>
            <div>
              <dt>员工</dt>
              <dd>
                {{ detail.employeeName || "—" }}
                <template v-if="detail.employeePhone"> · {{ detail.employeePhone }}</template>
                <template v-if="detail.employeeDept"> · {{ detail.employeeDept }}</template>
              </dd>
            </div>
            <div>
              <dt>企业</dt>
              <dd>{{ detail.enterpriseName || "—" }}</dd>
            </div>
            <div>
              <dt>团队</dt>
              <dd>{{ detail.teamName || "—" }}</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{{ detail.clientModel }}</dd>
            </div>
            <div>
              <dt>渠道</dt>
              <dd>{{ providerText(detail.providerCode) }} · {{ productTypeText(detail.productType) }}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{{ statusText(detail.status) }}</dd>
            </div>
            <div>
              <dt>错误码</dt>
              <dd>{{ detail.errorCode || "—" }}</dd>
            </div>
            <div>
              <dt>HTTP</dt>
              <dd>{{ detail.httpStatus ?? "—" }}</dd>
            </div>
            <div>
              <dt>上游 HTTP</dt>
              <dd>{{ detail.upstreamStatus ?? "—" }}</dd>
            </div>
            <div>
              <dt>渠道凭证</dt>
              <dd>{{ detail.credentialId ?? "—" }}</dd>
            </div>
            <div>
              <dt>时间</dt>
              <dd>{{ formatDateTime(detail.createdAt) }}</dd>
            </div>
          </dl>

          <section class="detail-section">
            <h3>错误信息</h3>
            <p class="error-text">{{ detail.errorMessage || "—" }}</p>
          </section>
        </template>
      </div>
      <template #footer>
        <el-button @click="showDetail = false">关闭</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { copyText } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/date-time";
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
const limit = 10;
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
.logs-page {
  padding: 16px 20px 14px;
  border: 1px solid #e9edf3;
}
.page-head {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 12px;
}
.doc-link {
  flex: none;
  color: var(--el-color-primary);
  font-size: 13px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.filters :deep(.el-form-item) {
  flex: none;
  margin-right: 0;
  margin-bottom: 0;
}
.logs-table {
  --el-table-border-color: #edf0f5;
  --el-table-header-bg-color: #f8fafc;
  --el-table-row-hover-bg-color: #f3f7fc;
  width: 100%;
  color: #344054;
}
.logs-table :deep(th.el-table__cell) {
  padding: 7px 0;
  color: #667085;
  font-size: 12px;
  font-weight: 600;
}
.logs-table :deep(td.el-table__cell) {
  padding: 6px 0;
}
.employee-text,
.model-text {
  display: block;
  overflow: hidden;
  color: #344054;
  text-overflow: ellipsis;
}
.employee-text {
  font-weight: 500;
}
.time-text {
  color: #475467;
  font-variant-numeric: tabular-nums;
}
.meaning {
  color: #344054;
  font-size: 13px;
  line-height: 1.45;
  white-space: normal;
}
.detail-button {
  height: auto;
  padding: 0;
  font-size: 12px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
  margin: 0;
}
.detail-grid dt {
  color: #667085;
  font-size: 12px;
}
.detail-grid dd {
  margin: 2px 0 0;
  color: #101828;
  font-size: 13px;
  word-break: break-all;
}
.detail-section h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.error-text {
  margin: 0;
  color: #b42318;
  font-size: 13px;
  white-space: pre-wrap;
}
.request-id-button {
  height: auto;
  padding: 0;
  color: #344054;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
</style>
