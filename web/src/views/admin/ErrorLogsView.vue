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
        <el-input
          v-model="filters.errorCode"
          clearable
          placeholder="错误码，如 1001"
          style="width: 160px"
        />
      </el-form-item>
      <el-form-item>
        <el-select v-model="filters.status" clearable placeholder="全部状态" style="width: 140px">
          <el-option label="上游错误" value="upstream_error" />
          <el-option label="请求错误" value="client_error" />
          <el-option label="已取消" value="cancelled" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
      </el-form-item>
      <el-form-item v-if="hasFilters">
        <el-button @click="resetFilters">重置</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="items" stripe size="small" empty-text="暂无报错记录">
      <el-table-column label="时间" width="168">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="业务错误码" width="120">
        <template #default="{ row }">
          <code class="error-code">{{ row.errorCode || "—" }}</code>
        </template>
      </el-table-column>
      <el-table-column label="HTTP 状态码" width="110" align="right">
        <template #default="{ row }">{{ row.httpStatus ?? "—" }}</template>
      </el-table-column>
      <el-table-column label="错误信息" min-width="280">
        <template #default="{ row }">
          <div class="meaning">{{ row.errorMessage || "—" }}</div>
        </template>
      </el-table-column>
      <el-table-column label="渠道" width="120">
        <template #default="{ row }">{{ providerText(row.providerCode) }}</template>
      </el-table-column>
      <el-table-column label="模型" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">{{ row.clientModel }}</template>
      </el-table-column>
      <el-table-column label="企业 / 团队" min-width="160">
        <template #default="{ row }">
          {{ row.enterpriseName || "—" }}
          <template v-if="row.teamName"> · {{ row.teamName }}</template>
        </template>
      </el-table-column>
      <el-table-column v-if="!auth.isSuperAdmin" label="员工" width="120" show-overflow-tooltip>
        <template #default="{ row }">{{ row.employeeName || "—" }}</template>
      </el-table-column>
      <el-table-column label="Request ID" min-width="220">
        <template #default="{ row }">
          <el-button class="request-id-button" link @click="copyRequestId(row.requestId)">
            {{ row.requestId }}
          </el-button>
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

interface ErrorLogRow {
  id: number;
  requestId: string;
  enterpriseName: string | null;
  teamName: string | null;
  employeeName?: string | null;
  clientModel: string;
  providerCode: string | null;
  status: LogStatus;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

const auth = useAuthStore();
const providerNames: Record<string, string> = {
  glm: "智谱/GLM",
  kimi: "月之暗面/Kimi",
  deepseek: "深度求索/DeepSeek",
  minimax: "MiniMax",
};

const subtitle = computed(() => {
  if (auth.isOrgAdmin) return "查看本企业调用失败，记录上游返回的业务错误码、HTTP 状态码和错误信息原文。";
  if (auth.isTeamAdmin) return "查看本团队调用失败，记录上游返回的业务错误码、HTTP 状态码和错误信息原文。";
  return "按企业 / 团队 / 渠道查看失败调用，不展示员工。业务错误码、HTTP 状态码、错误信息按上游原文记录。";
});

const filters = reactive({
  enterpriseId: undefined as number | undefined,
  teamId: undefined as number | undefined,
  errorCode: "",
  status: "" as "" | LogStatus,
});
const enterprises = ref<Array<{ id: number; name: string }>>([]);
const enterprisesLoading = ref(false);
const teams = ref<Array<{ id: number; name: string }>>([]);
const teamsLoading = ref(false);
const items = ref<ErrorLogRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 20;
const loading = ref(false);

const hasFilters = computed(() => Boolean(
  filters.enterpriseId || filters.teamId || filters.errorCode.trim() || filters.status,
));

function providerText(code: string | null): string {
  if (!code) return "—";
  return providerNames[code.toLowerCase()] ?? code;
}

async function copyRequestId(requestId: string) {
  const copied = await copyText(requestId);
  if (copied) ElMessage.success("Request ID 已复制");
  else ElMessage.error("复制失败");
}

async function onEnterpriseChange() {
  filters.teamId = undefined;
  teams.value = [];
  if (!filters.enterpriseId) return;
  teamsLoading.value = true;
  try {
    const { data } = await http.get(`/api/admin/enterprises/${filters.enterpriseId}/teams`);
    if (data.success) teams.value = data.data;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "团队列表加载失败");
  } finally {
    teamsLoading.value = false;
  }
}

async function loadTeams() {
  if (auth.isSuperAdmin) return;
  teamsLoading.value = true;
  try {
    const { data } = await http.get("/api/admin/teams");
    if (data.success) {
      teams.value = (data.data as Array<{ id: number; name: string }>).map((row) => ({
        id: row.id,
        name: row.name,
      }));
    }
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "团队列表加载失败");
  } finally {
    teamsLoading.value = false;
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

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/error-logs", {
      params: {
        limit,
        offset: (page.value - 1) * limit,
        errorCode: filters.errorCode.trim() || undefined,
        status: filters.status || undefined,
        enterpriseId: auth.isSuperAdmin ? filters.enterpriseId : undefined,
        teamId: auth.isSuperAdmin || auth.isOrgAdmin ? filters.teamId : undefined,
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

function resetFilters() {
  filters.enterpriseId = undefined;
  filters.teamId = undefined;
  filters.errorCode = "";
  filters.status = "";
  if (auth.isSuperAdmin) teams.value = [];
  page.value = 1;
  load();
}

onMounted(() => {
  void load();
  void loadEnterprises();
  void loadTeams();
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
  gap: 8px;
  margin-bottom: 10px;
}
.filters :deep(.el-form-item) {
  margin-right: 0;
  margin-bottom: 0;
}
.error-code {
  margin-right: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
.meaning {
  color: #344054;
  font-size: 13px;
  line-height: 1.45;
  white-space: normal;
}
.request-id-button {
  height: auto;
  padding: 0;
  color: #667085;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}
</style>
