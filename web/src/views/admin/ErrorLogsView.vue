<template>
  <div class="page-card logs-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">报错日志</h2>
        <p class="page-subtitle">{{ subtitle }}</p>
      </div>
      <a
        class="doc-link"
        href="https://docs.bigmodel.cn/cn/faq/api-code"
        target="_blank"
        rel="noopener noreferrer"
      >
        智谱错误码说明
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
          <el-alert
            v-if="detail.omittedBodies"
            type="warning"
            :closable="false"
            show-icon
            title="请求/响应正文过大，详情里已省略"
          />
          <el-alert
            v-else-if="!detail.hasContextFile"
            type="info"
            :closable="false"
            show-icon
            title="该请求没有全文记录（部署前的旧日志没有文件）"
          />

          <dl class="detail-grid">
            <div>
              <dt>员工</dt>
              <dd>{{ detail.employeeName }} · {{ detail.employeePhone }}</dd>
            </div>
            <div>
              <dt>企业 / 团队</dt>
              <dd>
                {{ detail.enterpriseName || "—" }}
                <template v-if="detail.teamName"> · {{ detail.teamName }}</template>
              </dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{{ detail.clientModel }}</dd>
            </div>
            <div>
              <dt>渠道</dt>
              <dd>{{ detail.providerCode || "—" }}</dd>
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
              <dd>{{ detail.httpStatus ?? "—" }} / 上游 {{ detail.upstreamStatus ?? "—" }}</dd>
            </div>
            <div>
              <dt>时间</dt>
              <dd>{{ formatDateTime(detail.createdAt) }}</dd>
            </div>
            <div v-if="contextRecord">
              <dt>耗时</dt>
              <dd>{{ contextRecord.latencyMs ?? "—" }} ms</dd>
            </div>
            <div v-if="contextRecord">
              <dt>协议 / 路径</dt>
              <dd>{{ contextRecord.protocol }} · {{ contextRecord.path }}{{ contextRecord.stream ? " · 流式" : "" }}</dd>
            </div>
            <div v-if="contextRecord?.candidate">
              <dt>渠道 Key</dt>
              <dd>•••• {{ contextRecord.candidate.credentialSuffix }} · {{ contextRecord.candidate.providerCode }}</dd>
            </div>
          </dl>

          <section class="detail-section">
            <h3>错误</h3>
            <p class="error-text">{{ detail.errorMessage || "—" }}</p>
          </section>

          <section v-if="contextRecord?.retryTrace?.length" class="detail-section">
            <h3>调度轨迹</h3>
            <el-table :data="contextRecord.retryTrace" size="small" stripe>
              <el-table-column prop="attempt" label="#" width="50" />
              <el-table-column prop="credentialSuffix" label="Key" width="80" />
              <el-table-column prop="outcome" label="结果" width="100" />
              <el-table-column prop="status" label="HTTP" width="70" />
              <el-table-column prop="latencyMs" label="耗时" width="80" />
              <el-table-column prop="reason" label="原因" min-width="140" show-overflow-tooltip />
            </el-table>
          </section>

          <section v-if="contextRecord?.headers" class="detail-section">
            <h3>请求头</h3>
            <StructuredJson :value="contextRecord.headers" empty-text="没有保存请求头" />
          </section>
          <section class="detail-section">
            <h3>请求体</h3>
            <StructuredJson :value="contextRecord?.requestBody" empty-text="没有保存请求体（部署前的旧日志没有全文）" />
          </section>
          <section class="detail-section">
            <h3>响应</h3>
            <StructuredJson
              :value="contextRecord?.responseBody ?? contextRecord?.streamAudit?.assembled"
              empty-text="没有保存响应正文"
            />
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
import StructuredJson from "@/components/StructuredJson.vue";
import { formatDateTime } from "@/lib/date-time";
import { useAuthStore } from "@/stores/auth";

type LogStatus = "upstream_error" | "client_error" | "cancelled";

interface ErrorLogRow {
  id: number;
  requestId: string;
  employeeId: number;
  employeeName: string | null;
  enterpriseName: string | null;
  teamName: string | null;
  clientModel: string;
  providerCode: string | null;
  status: LogStatus;
  httpStatus: number | null;
  upstreamStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface ErrorLogDetail extends ErrorLogRow {
  employeePhone: string;
  hasContextFile: boolean;
  omittedBodies: boolean;
  context: Record<string, unknown> | null;
}

interface NamedOption {
  id: number;
  name: string;
}

const auth = useAuthStore();

const subtitle = computed(() => {
  if (auth.isOrgAdmin) return "按团队 / 员工查看本企业失败调用。";
  if (auth.isTeamAdmin) return "按员工查看本团队失败调用。";
  return "按 Request ID / 企业 / 团队 / 员工查看失败调用。";
});

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
const limit = 20;
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

const contextRecord = computed(() => {
  const value = detail.value?.context;
  if (!value || typeof value !== "object") return null;
  return value as {
    latencyMs?: number;
    protocol?: string;
    path?: string;
    stream?: boolean;
    headers?: Record<string, string>;
    candidate?: { credentialSuffix?: string; providerCode?: string } | null;
    retryTrace?: Array<Record<string, unknown>>;
    requestBody?: unknown;
    responseBody?: unknown;
    streamAudit?: { assembled?: unknown };
  };
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.page-title {
  margin: 0 0 4px;
}
.page-subtitle {
  margin: 0;
  color: #667085;
  font-size: 13px;
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
.detail-body :deep(.el-alert) {
  padding: 8px 12px;
}
</style>
