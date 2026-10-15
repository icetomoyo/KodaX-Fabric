<template>
  <div class="keys-table-page">
    <section class="page-card">
      <div class="page-head">
        <div class="page-head-text">
          <h2 class="page-title">KEYS表格</h2>
        </div>
        <div class="head-actions">
          <el-input
            v-model="nameSearch"
            class="name-search"
            clearable
            placeholder="搜索姓名"
          />
          <span v-if="queriedAt" class="queried-at">
            查询于 {{ formatDateTime(queriedAt) }}
          </span>
          <el-button :loading="loading" @click="load(true)">刷新</el-button>
        </div>
      </div>

      <el-table
        v-loading="loading"
        :data="pagedRows"
        stripe
        empty-text="暂无 Key"
        :default-sort="{ prop: 'fiveHourUsed', order: 'descending' }"
        @sort-change="onSortChange"
      >
        <el-table-column label="员工" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.employeeName }}</span>
            <el-tag v-if="row.disabled" type="info" size="small" class="disabled-tag">
              停用
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="modeName" label="模式" min-width="140" show-overflow-tooltip />
        <el-table-column label="KEY 尾号" width="110">
          <template #default="{ row }">•••• {{ row.secretSuffix }}</template>
        </el-table-column>
        <el-table-column
          prop="fiveHourUsed"
          label="5h 已用"
          width="100"
          sortable="custom"
          align="right"
        >
          <template #default="{ row }">{{ formatQuotaCell(row.fiveHourUsed) }}</template>
        </el-table-column>
        <el-table-column
          prop="fiveHourRemaining"
          label="5h 剩余"
          width="100"
          sortable="custom"
          align="right"
        >
          <template #default="{ row }">{{ formatQuotaCell(row.fiveHourRemaining) }}</template>
        </el-table-column>
        <el-table-column
          prop="fiveHourRate"
          label="5h 使用率"
          width="110"
          sortable="custom"
          align="right"
        >
          <template #default="{ row }">
            <template v-if="row.fiveHourRate == null">—</template>
            <el-tag
              v-else
              size="small"
              :type="quotaRateTagType(row.fiveHourRate)"
            >
              {{ Math.round(row.fiveHourRate) }}%
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="5h 重置" width="120">
          <template #default="{ row }">{{ formatQuotaResetAt(row.fiveHourResetAt) }}</template>
        </el-table-column>
        <el-table-column
          prop="weeklyUsed"
          label="周已用"
          width="100"
          sortable="custom"
          align="right"
        >
          <template #default="{ row }">{{ formatQuotaCell(row.weeklyUsed) }}</template>
        </el-table-column>
        <el-table-column
          prop="weeklyRate"
          label="周使用率"
          width="110"
          sortable="custom"
          align="right"
        >
          <template #default="{ row }">
            <template v-if="row.weeklyRate == null">—</template>
            <el-tag
              v-else
              size="small"
              :type="quotaRateTagType(row.weeklyRate)"
            >
              {{ Math.round(row.weeklyRate) }}%
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="周重置" width="120">
          <template #default="{ row }">{{ formatQuotaResetAt(row.weeklyResetAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.statusText ?? "—" }}</template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          background
          layout="total, sizes, prev, pager, next"
          :total="total"
          :page-sizes="PAGE_SIZES"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { channelDisplayName } from "@/lib/channel-display";
import { formatDateTime, formatDateTimeInTimeZone } from "@/lib/date-time";
import { requestMessage } from "@/lib/request-error";
import { sliceTablePage } from "@/lib/table-page";

const PAGE_SIZES = [10, 20, 50];

type QuotaWindow = {
  used: number;
  limit: number;
  remaining: number;
  percentage: number;
  resetAt: string | null;
};

type OfficialQuotaState = "ok" | "error" | "unconfigured" | "unsupported";

type OfficialQuotaItem = {
  credentialId: number;
  state: OfficialQuotaState;
  message?: string;
  level?: string;
  fiveHour?: QuotaWindow | null;
  weekly?: QuotaWindow | null;
};

type CredentialRow = {
  id: number;
  label: string;
  secretSuffix: string;
  status: string;
  providerName: string;
  productLineName: string;
  binding: { scopeName: string } | null;
  connectedNames?: string[];
};

type KeysTableRow = {
  credentialId: number;
  employeeName: string;
  label: string;
  modeName: string;
  secretSuffix: string;
  disabled: boolean;
  state: OfficialQuotaState;
  statusText: string | null;
  fiveHourUsed: number | null;
  fiveHourRemaining: number | null;
  fiveHourRate: number | null;
  fiveHourResetAt: string | null;
  weeklyUsed: number | null;
  weeklyRate: number | null;
  weeklyResetAt: string | null;
};

type KeysTableSortProp =
  | "fiveHourUsed"
  | "fiveHourRemaining"
  | "fiveHourRate"
  | "weeklyUsed"
  | "weeklyRate";

type CredentialsListResponse = {
  success: boolean;
  message?: string;
  data?: CredentialRow[];
};

type OfficialQuotaResponse = {
  data?: OfficialQuotaItem[];
  queriedAt?: string | null;
};

const loading = ref(false);
const nameSearch = ref("");
const queriedAt = ref<string | null>(null);
const credentials = ref<CredentialRow[]>([]);
const quotaItems = ref<OfficialQuotaItem[]>([]);
const page = ref(1);
const pageSize = ref(10);
const sort = ref<{ prop: KeysTableSortProp; order: "ascending" | "descending" }>({
  prop: "fiveHourUsed",
  order: "descending",
});

function employeeName(row: CredentialRow): string {
  const connected = (row.connectedNames ?? []).find((name) => name.trim());
  if (connected) return connected;
  if (row.binding?.scopeName) return row.binding.scopeName;
  return row.label;
}

function officialQuotaStatusText(item: OfficialQuotaItem | undefined): string | null {
  if (!item || item.state === "ok") return null;
  if (item.state === "unconfigured") return "未配置组织/项目 ID";
  if (item.state === "unsupported") return "不支持";
  return item.message?.trim() || "查询失败";
}

function formatQuotaCell(value: number | null): string {
  if (value == null) return "—";
  return Math.round(value).toLocaleString("zh-CN");
}

function formatQuotaResetAt(value: string | null): string {
  if (!value) return "—";
  const formatted = formatDateTimeInTimeZone(value, "Asia/Shanghai");
  return formatted.length >= 16 ? formatted.slice(5, 16) : "—";
}

function quotaRateTagType(percent: number): "danger" | "warning" | "info" {
  if (percent >= 70) return "danger";
  if (percent >= 40) return "warning";
  return "info";
}

function isSortProp(value: string): value is KeysTableSortProp {
  return (
    value === "fiveHourUsed"
    || value === "fiveHourRemaining"
    || value === "fiveHourRate"
    || value === "weeklyUsed"
    || value === "weeklyRate"
  );
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

const joinedRows = computed<KeysTableRow[]>(() => {
  const quotaById = new Map(quotaItems.value.map((item) => [item.credentialId, item]));
  return credentials.value.map((row) => {
    const quota = quotaById.get(row.id);
    const ok = quota?.state === "ok";
    return {
      credentialId: row.id,
      employeeName: employeeName(row),
      label: row.label,
      modeName: channelDisplayName(row),
      secretSuffix: row.secretSuffix,
      disabled: row.status === "disabled" || row.status === "auto_disabled",
      state: quota?.state ?? "error",
      statusText: officialQuotaStatusText(quota ?? { credentialId: row.id, state: "error", message: "未查询，请点击刷新" }),
      fiveHourUsed: ok ? quota.fiveHour?.used ?? null : null,
      fiveHourRemaining: ok ? quota.fiveHour?.remaining ?? null : null,
      fiveHourRate: ok ? quota.fiveHour?.percentage ?? null : null,
      fiveHourResetAt: ok ? quota.fiveHour?.resetAt ?? null : null,
      weeklyUsed: ok ? quota.weekly?.used ?? null : null,
      weeklyRate: ok ? quota.weekly?.percentage ?? null : null,
      weeklyResetAt: ok ? quota.weekly?.resetAt ?? null : null,
    };
  });
});

const filteredRows = computed<KeysTableRow[]>(() => {
  const keyword = nameSearch.value.trim().toLowerCase();
  if (!keyword) return joinedRows.value;
  return joinedRows.value.filter((row) => {
    const name = row.employeeName.toLowerCase();
    const label = row.label.toLowerCase();
    return name.includes(keyword) || label.includes(keyword);
  });
});

const sortedRows = computed<KeysTableRow[]>(() => {
  const { prop, order } = sort.value;
  return [...filteredRows.value].sort((a, b) => {
    if (a.state === "ok" && b.state !== "ok") return -1;
    if (a.state !== "ok" && b.state === "ok") return 1;
    const cmp = compareNullableNumber(a[prop], b[prop]);
    return order === "descending" ? -cmp : cmp;
  });
});

const total = computed(() => sortedRows.value.length);
const pagedRows = computed(() => sliceTablePage(sortedRows.value, page.value, pageSize.value));

watch(
  [total, page, pageSize],
  () => {
    const maxPage = Math.max(1, Math.ceil(total.value / pageSize.value));
    if (page.value > maxPage) page.value = maxPage;
  },
  { immediate: true },
);

watch([nameSearch, sort], () => {
  page.value = 1;
});

function onSortChange(payload: { prop: string; order: "ascending" | "descending" | null }) {
  if (!payload.order || !isSortProp(payload.prop)) {
    sort.value = { prop: "fiveHourUsed", order: "descending" };
    return;
  }
  sort.value = { prop: payload.prop, order: payload.order };
}

function fetchQuota(refresh: boolean) {
  return refresh
    ? http.post<OfficialQuotaResponse>("/api/admin/credentials/official-quota/refresh", null, {
        timeout: 180_000,
      })
    : http.get<OfficialQuotaResponse>("/api/admin/credentials/official-quota");
}

async function load(refresh: boolean) {
  loading.value = true;
  try {
    const [credRes, quotaRes] = await Promise.all([
      http.get<CredentialsListResponse>("/api/admin/credentials"),
      fetchQuota(refresh),
    ]);
    if (!credRes.data.success) {
      throw new Error(credRes.data.message || "加载 Key 失败");
    }
    credentials.value = Array.isArray(credRes.data.data) ? credRes.data.data : [];
    quotaItems.value = Array.isArray(quotaRes.data.data) ? quotaRes.data.data : [];
    queriedAt.value = typeof quotaRes.data.queriedAt === "string" ? quotaRes.data.queriedAt : null;
  } catch (error) {
    ElMessage.error(requestMessage(error, "加载失败"));
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load(false);
});
</script>

<style scoped>
.keys-table-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.page-head-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.page-head-text .page-title {
  margin: 0;
}

.head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.name-search {
  width: 220px;
}

.queried-at {
  color: #64748b;
  font-size: 12px;
  font-weight: 400;
}

.disabled-tag {
  margin-left: 6px;
}
</style>
