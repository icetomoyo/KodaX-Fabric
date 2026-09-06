<template>
  <el-card class="logs-page" shadow="never">
    <el-form :inline="true" class="filters" @keyup.enter="search">
      <el-form-item>
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
      <el-form-item>
        <el-select
          v-model="filters.teamId"
          clearable
          filterable
          :disabled="!filters.enterpriseId"
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
          :disabled="!filters.enterpriseId"
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
      :data="items"
      stripe
      empty-text="暂无日志"
      v-loading="loading"
    >
      <el-table-column label="Request ID" min-width="220">
        <template #default="{ row }">
          <el-button link type="primary" @click="copyRequestId(row.requestId)">
            {{ row.requestId }}
          </el-button>
        </template>
      </el-table-column>
      <el-table-column label="企业 / 团队" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.enterpriseName || "—" }}
          <template v-if="row.teamName"> · {{ row.teamName }}</template>
        </template>
      </el-table-column>
      <el-table-column label="员工" width="120" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.employeeName || "—" }}
        </template>
      </el-table-column>
      <el-table-column prop="clientModel" label="模型" width="140" show-overflow-tooltip />
      <el-table-column label="Tokens" width="110" align="right" header-align="right">
        <template #default="{ row }">
          <el-tooltip :content="tokenTooltip(row)" placement="top" :show-after="300">
            <span>{{ formatNumber(row.totalTokens) }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="积分" width="100" align="right" header-align="right">
        <template #default="{ row }">
          {{ formatCredits(row.credits) }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status)">
            {{ statusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="180">
        <template #default="{ row }">
          {{ formatDateTime(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" align="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
          <el-button
            link
            type="primary"
            :loading="downloadingId === row.requestId"
            @click="downloadContext(row)"
          >
            下载
          </el-button>
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
      :title="detail?.requestId || '请求详情'"
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
            title="请求/响应正文过大，详情里已省略，请下载 JSON 查看全文"
          />
          <el-alert
            v-else-if="!detail.hasContextFile"
            type="info"
            :closable="false"
            show-icon
            title="该请求没有全文记录（部署前的旧日志没有文件）"
          />

          <el-descriptions :column="2" border>
            <el-descriptions-item label="员工">
              {{ detail.employeeName }} · {{ detail.employeePhone }}
            </el-descriptions-item>
            <el-descriptions-item label="企业 / 团队">
              {{ detail.enterpriseName || "—" }}<template v-if="detail.teamName"> · {{ detail.teamName }}</template>
            </el-descriptions-item>
            <el-descriptions-item label="模型">{{ detail.clientModel }}</el-descriptions-item>
            <el-descriptions-item label="渠道">
              {{ detail.providerCode || "—" }} · {{ productTypeText(detail.productType) }}
            </el-descriptions-item>
            <el-descriptions-item label="状态">{{ statusText(detail.status) }}</el-descriptions-item>
            <el-descriptions-item label="Tokens">{{ tokenTooltip(detail) }}</el-descriptions-item>
            <el-descriptions-item label="积分">{{ formatCredits(detail.credits) }}</el-descriptions-item>
            <el-descriptions-item label="时间">{{ formatDateTime(detail.createdAt) }}</el-descriptions-item>
            <el-descriptions-item v-if="contextRecord" label="耗时">
              {{ contextRecord.latencyMs ?? "—" }} ms
            </el-descriptions-item>
            <el-descriptions-item v-if="contextRecord" label="协议 / 路径">
              {{ contextRecord.protocol }} · {{ contextRecord.path }}{{ contextRecord.stream ? " · 流式" : "" }}
            </el-descriptions-item>
            <el-descriptions-item v-if="contextRecord?.candidate" label="渠道 Key">
              •••• {{ contextRecord.candidate.credentialSuffix }} · {{ contextRecord.candidate.providerCode }}
            </el-descriptions-item>
            <el-descriptions-item v-if="detail.error" label="HTTP">
              {{ detail.error.httpStatus ?? "—" }} / 上游 {{ detail.error.upstreamStatus ?? "—" }}
            </el-descriptions-item>
          </el-descriptions>

          <el-alert
            v-if="detail.error"
            type="error"
            :closable="false"
            :title="detail.error.errorCode || '错误'"
            :description="detail.error.errorMessage || ''"
            show-icon
          />

          <section v-if="contextRecord?.retryTrace?.length">
            <el-divider content-position="left">调度轨迹</el-divider>
            <el-table :data="contextRecord.retryTrace" stripe>
              <el-table-column prop="attempt" label="#" width="50" />
              <el-table-column prop="credentialSuffix" label="Key" width="80" />
              <el-table-column prop="outcome" label="结果" width="100" />
              <el-table-column prop="status" label="HTTP" width="70" />
              <el-table-column prop="latencyMs" label="耗时" width="80" />
              <el-table-column prop="reason" label="原因" min-width="140" show-overflow-tooltip />
            </el-table>
          </section>

          <section v-if="contextRecord?.headers">
            <el-divider content-position="left">请求头</el-divider>
            <StructuredJson :value="contextRecord.headers" empty-text="没有保存请求头" />
          </section>
          <section>
            <el-divider content-position="left">请求体</el-divider>
            <StructuredJson :value="contextRecord?.requestBody" empty-text="没有保存请求体（部署前的旧日志没有全文）" />
          </section>
          <section>
            <el-divider content-position="left">响应</el-divider>
            <StructuredJson
              :value="contextRecord?.responseBody ?? contextRecord?.streamAudit?.assembled"
              empty-text="没有保存响应正文"
            />
          </section>
        </template>
      </div>
      <template #footer>
        <el-button @click="showDetail = false">关闭</el-button>
        <el-button
          type="primary"
          :disabled="!detail?.hasContextFile"
          :loading="Boolean(detail && downloadingId === detail.requestId)"
          @click="detail && downloadContext(detail)"
        >
          下载全文
        </el-button>
      </template>
    </el-drawer>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import StructuredJson from "@/components/StructuredJson.vue";
import { copyText } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/date-time";
import { TABLE_PAGE_SIZE } from "@/lib/table-page";

type LogStatus = "success" | "upstream_error" | "client_error" | "cancelled";
type ProductType = "api" | "coding_plan";

interface LogRow {
  id: number;
  requestId: string;
  employeeId: number;
  employeeName: string;
  enterpriseName: string | null;
  teamName: string | null;
  clientModel: string;
  providerCode: string | null;
  productType: ProductType | null;
  status: LogStatus;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  credits: number;
  createdAt: string;
}

interface LogDetail extends LogRow {
  employeePhone: string;
  error: {
    httpStatus: number | null;
    upstreamStatus: number | null;
    errorCode: string | null;
    errorMessage: string | null;
  } | null;
  hasContextFile: boolean;
  omittedBodies: boolean;
  context: Record<string, unknown> | null;
}

interface NamedOption {
  id: number;
  name: string;
}

const numberFormatter = new Intl.NumberFormat("zh-CN");
const creditFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 4,
  minimumFractionDigits: 0,
});

const filters = reactive({
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
const items = ref<LogRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = TABLE_PAGE_SIZE;
const loading = ref(false);
const downloadingId = ref<string | null>(null);
const showDetail = ref(false);
const detailLoading = ref(false);
const detail = ref<LogDetail | null>(null);

const hasFilters = computed(() => Boolean(
  filters.enterpriseId || filters.teamId || filters.employeeId,
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
      success: "成功",
      upstream_error: "上游错误",
      client_error: "请求错误",
      cancelled: "已取消",
    } as const
  )[status];
}

function statusTagType(status: LogStatus): "success" | "danger" | "warning" | "info" {
  const tags: Record<LogStatus, "success" | "danger" | "warning" | "info"> = {
    success: "success",
    upstream_error: "danger",
    client_error: "warning",
    cancelled: "info",
  };
  return tags[status];
}

function productTypeText(value: ProductType | null | undefined): string {
  if (value === "coding_plan") return "套餐";
  if (value === "api") return "按量";
  return "—";
}

function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : numberFormatter.format(value);
}

function formatCredits(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return creditFormatter.format(value);
}

function tokenTooltip(row: Pick<LogRow, "promptTokens" | "completionTokens" | "totalTokens">): string {
  return `${formatNumber(row.promptTokens)} + ${formatNumber(row.completionTokens)} = ${formatNumber(row.totalTokens)}`;
}

async function onEnterpriseChange() {
  filters.teamId = null;
  filters.employeeId = null;
  teams.value = [];
  enterpriseEmployees.value = [];
  teamEmployees.value = null;
  if (!filters.enterpriseId) return;
  teamsLoading.value = true;
  employeesLoading.value = true;
  try {
    const [teamRes, userRes] = await Promise.all([
      http.get(`/api/admin/enterprises/${filters.enterpriseId}/teams`),
      http.get("/api/admin/users", { params: { enterpriseId: filters.enterpriseId, limit: 200 } }),
    ]);
    if (teamRes.data.success) teams.value = teamRes.data.data;
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

async function copyRequestId(requestId: string) {
  const copied = await copyText(requestId);
  if (copied) ElMessage.success("Request ID 已复制");
  else ElMessage.error("复制失败");
}

async function downloadContext(row: LogRow) {
  if (downloadingId.value) return;
  downloadingId.value = row.requestId;
  try {
    const response = await http.get(`/api/admin/logs/${encodeURIComponent(row.requestId)}/context`, {
      responseType: "blob",
      timeout: 120_000,
    });
    const blob = new Blob([response.data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${row.requestId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (e: any) {
    const status = e.response?.status;
    if (status === 404) {
      ElMessage.warning("该请求没有全文记录（部署前的旧日志没有）");
    } else {
      ElMessage.error(e.response?.data?.message || "下载失败");
    }
  } finally {
    downloadingId.value = null;
  }
}

async function openDetail(row: LogRow) {
  showDetail.value = true;
  detailLoading.value = true;
  detail.value = null;
  try {
    const { data } = await http.get(`/api/admin/logs/${encodeURIComponent(row.requestId)}`, {
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

function listQueryParams() {
  const params: Record<string, number> = {
    limit,
    offset: (page.value - 1) * limit,
  };
  if (filters.enterpriseId) params.enterpriseId = filters.enterpriseId;
  if (filters.teamId) params.teamId = filters.teamId;
  if (filters.employeeId) params.employeeId = filters.employeeId;
  return params;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/logs", {
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

async function loadEnterprises() {
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

function search() {
  page.value = 1;
  load();
}

function resetFilters() {
  filters.enterpriseId = null;
  filters.teamId = null;
  filters.employeeId = null;
  teams.value = [];
  enterpriseEmployees.value = [];
  teamEmployees.value = null;
  page.value = 1;
  load();
}

onMounted(() => {
  void load();
  void loadEnterprises();
});
</script>

<style scoped>
.filters {
  margin-bottom: 12px;
}
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
