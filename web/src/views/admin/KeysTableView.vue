<template>
  <div class="keys-table-page">
    <div class="split">
      <aside class="page-card channel-pane">
        <div class="pane-title">渠道</div>
        <el-empty v-if="!loading && !channels.length" description="暂无套餐渠道" :image-size="64" />
        <button
          v-for="channel in channels"
          :key="channel.code"
          type="button"
          class="channel-item"
          :class="{ active: selectedCode === channel.code }"
          @click="selectedCode = channel.code"
        >
          <span class="channel-name">{{ channel.company }}</span>
          <span class="channel-count">{{ keyCount(channel.code) }}</span>
        </button>
      </aside>

      <section class="page-card keys-pane" v-loading="loading">
        <div class="keys-head">
          <div>
            <h3 class="keys-title">{{ currentChannel?.company || "KEYS" }}</h3>
            <p class="muted">{{ channelHint }}</p>
          </div>
          <div class="head-actions">
            <el-input v-model="nameSearch" class="name-search" clearable placeholder="搜索姓名" />
            <span v-if="queriedAt" class="queried-at">官方额度查询于 {{ formatDateTime(queriedAt) }}</span>
            <el-button :loading="refreshing" @click="refresh">刷新</el-button>
          </div>
        </div>

        <el-table
          :data="pagedRows"
          stripe
          empty-text="该渠道暂无 Key"
          :default-sort="{ prop: sort.prop, order: sort.order }"
          @sort-change="onSortChange"
        >
          <el-table-column label="员工" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <span>{{ row.employeeName }}</span>
              <el-tag v-if="row.disabled" type="info" size="small" class="disabled-tag">停用</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="productLineName" label="套餐" min-width="100" show-overflow-tooltip />
          <el-table-column label="KEY 尾号" width="100">
            <template #default="{ row }">•••• {{ row.secretSuffix }}</template>
          </el-table-column>
          <el-table-column
            v-for="window in windows"
            :key="window.kind"
            :prop="`${window.kind}Rate`"
            :label="window.label"
            min-width="150"
            sortable="custom"
          >
            <template #default="{ row }">
              <span v-if="row[`${window.kind}Rate`] == null" class="quota-empty">—</span>
              <span v-else class="quota-cell">
                <el-tag size="small" :type="rateTagType(row[`${window.kind}Rate`])">
                  {{ Math.round(row[`${window.kind}Rate`]) }}%
                </el-tag>
                <small class="quota-reset">{{ formatResetAt(row[`${window.kind}ResetAt`]) }}</small>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="来源" min-width="100" show-overflow-tooltip>
            <template #default="{ row }">{{ row.sourceText }}</template>
          </el-table-column>
          <el-table-column label="状态" min-width="120" show-overflow-tooltip>
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime, formatDateTimeInTimeZone } from "@/lib/date-time";
import {
  windowPercent,
  windowResetAt,
  windowSource,
  type KeyQuotaRow,
  type QuotaWindowKind,
  type QuotaWindowSource,
} from "@/lib/key-quota";
import { requestMessage } from "@/lib/request-error";
import { sliceTablePage } from "@/lib/table-page";

const PAGE_SIZES = [10, 20, 50];

type ChannelType = {
  code: string;
  title: string;
  company: string;
  productType: "api" | "coding_plan";
};

type CredentialRow = KeyQuotaRow & {
  id: number;
  label: string;
  secretSuffix: string;
  providerCode: string;
  productLineName: string;
  holderName?: string | null;
};

type RateProp = "fiveRate" | "weeklyRate" | "monthlyRate";

type KeysTableRow = {
  credentialId: number;
  employeeName: string;
  label: string;
  productLineName: string;
  secretSuffix: string;
  disabled: boolean;
  fiveRate: number | null;
  fiveResetAt: string | null;
  weeklyRate: number | null;
  weeklyResetAt: string | null;
  monthlyRate: number | null;
  monthlyResetAt: string | null;
  sourceText: string;
  statusText: string | null;
};

const WINDOW_LABELS: Record<QuotaWindowKind, string> = { five: "5 小时", weekly: "每周", monthly: "每月" };

/** 火山方舟 Agent Plan 有月额度，智谱只有 5 小时和每周。 */
const MONTHLY_CHANNELS = new Set(["huoshan"]);

/** 能在官方查询额度的渠道；其余只能按本地账本估算。 */
const OFFICIAL_QUOTA_CHANNELS = new Set(["glm"]);

const loading = ref(false);
const refreshing = ref(false);
const channels = ref<ChannelType[]>([]);
const credentials = ref<CredentialRow[]>([]);
const selectedCode = ref<string | null>(null);
const nameSearch = ref("");
const page = ref(1);
const pageSize = ref(10);
const sort = ref<{ prop: RateProp; order: "ascending" | "descending" }>({
  prop: "fiveRate",
  order: "descending",
});

const currentChannel = computed(() =>
  channels.value.find((channel) => channel.code === selectedCode.value) ?? null,
);

const windows = computed(() => {
  const kinds: QuotaWindowKind[] = MONTHLY_CHANNELS.has(selectedCode.value ?? "")
    ? ["five", "weekly", "monthly"]
    : ["five", "weekly"];
  return kinds.map((kind) => ({ kind, label: WINDOW_LABELS[kind] }));
});

const channelHint = computed(() => {
  const code = selectedCode.value ?? "";
  if (OFFICIAL_QUOTA_CHANNELS.has(code)) {
    return "使用率取自官方额度（点「刷新」向官方查询）；上游已回用尽的按 100%；未查询的按本地账本估算。";
  }
  return "没有官方额度查询接口，使用率按本地账本估算；上游已回用尽的按 100%。";
});

const queriedAt = computed(() => {
  if (!OFFICIAL_QUOTA_CHANNELS.has(selectedCode.value ?? "")) return null;
  let latest: string | null = null;
  for (const row of credentials.value) {
    if (row.providerCode !== selectedCode.value || !row.officialQuotaAt) continue;
    if (!latest || row.officialQuotaAt > latest) latest = row.officialQuotaAt;
  }
  return latest;
});

function keyCount(code: string): number {
  return credentials.value.filter((row) => row.providerCode === code).length;
}

function employeeName(row: CredentialRow): string {
  const holder = row.holderName?.trim();
  if (holder) return holder;
  return "无";
}

const SOURCE_TEXT: Record<QuotaWindowSource, string> = {
  upstream_cap: "上游已用尽",
  official: "官方",
  local: "本地估算",
};

function sourceText(row: CredentialRow, kinds: QuotaWindowKind[]): string {
  const sources = new Set<QuotaWindowSource>();
  for (const kind of kinds) {
    const source = windowSource(row, kind);
    if (source) sources.add(source);
  }
  if (!sources.size) return "—";
  return [...sources].map((source) => SOURCE_TEXT[source]).join(" / ");
}

function statusText(row: CredentialRow): string | null {
  if (row.status === "auto_disabled") return "自动停用";
  const quota = row.officialQuota;
  if (OFFICIAL_QUOTA_CHANNELS.has(row.providerCode)) {
    if (quota?.state === "unconfigured") return "未配置组织/项目 ID";
    if (quota?.state === "error") return quota.message?.trim() || "官方查询失败";
    if (!quota) return "未查询官方额度";
  }
  if (row.coolUntil && new Date(row.coolUntil).getTime() > Date.now()) return "冷却中";
  return null;
}

function rateOf(row: CredentialRow, kind: QuotaWindowKind): number | null {
  return windowSource(row, kind) ? windowPercent(row, kind) : null;
}

const channelRows = computed<KeysTableRow[]>(() => {
  const kinds = windows.value.map((window) => window.kind);
  return credentials.value
    .filter((row) => row.providerCode === selectedCode.value)
    .map((row) => ({
      credentialId: row.id,
      employeeName: employeeName(row),
      label: row.label,
      productLineName: row.productLineName,
      secretSuffix: row.secretSuffix,
      disabled: row.status === "disabled" || row.status === "auto_disabled",
      fiveRate: rateOf(row, "five"),
      fiveResetAt: windowResetAt(row, "five"),
      weeklyRate: rateOf(row, "weekly"),
      weeklyResetAt: windowResetAt(row, "weekly"),
      monthlyRate: rateOf(row, "monthly"),
      monthlyResetAt: windowResetAt(row, "monthly"),
      sourceText: sourceText(row, kinds),
      statusText: statusText(row),
    }));
});

const filteredRows = computed(() => {
  const keyword = nameSearch.value.trim().toLowerCase();
  if (!keyword) return channelRows.value;
  return channelRows.value.filter((row) =>
    row.employeeName.toLowerCase().includes(keyword) || row.label.toLowerCase().includes(keyword),
  );
});

function compareNullable(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

const sortedRows = computed(() => {
  const { prop, order } = sort.value;
  return [...filteredRows.value].sort((a, b) => {
    // 没有数的行总在最后，不随升降序翻转。
    if (a[prop] == null || b[prop] == null) return compareNullable(a[prop], b[prop]);
    const cmp = compareNullable(a[prop], b[prop]);
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

watch([nameSearch, sort, selectedCode], () => {
  page.value = 1;
});

function isRateProp(value: string): value is RateProp {
  return value === "fiveRate" || value === "weeklyRate" || value === "monthlyRate";
}

function onSortChange(payload: { prop: string; order: "ascending" | "descending" | null }) {
  sort.value = payload.order && isRateProp(payload.prop)
    ? { prop: payload.prop, order: payload.order }
    : { prop: "fiveRate", order: "descending" };
}

function rateTagType(percent: number): "danger" | "warning" | "info" {
  if (percent >= 70) return "danger";
  if (percent >= 40) return "warning";
  return "info";
}

function formatResetAt(value: string | null): string {
  if (!value) return "—";
  const formatted = formatDateTimeInTimeZone(value, "Asia/Shanghai");
  return formatted.length >= 16 ? formatted.slice(5, 16) : "—";
}

async function loadCredentials() {
  const { data } = await http.get<{ success: boolean; message?: string; data?: CredentialRow[] }>(
    "/api/admin/credentials",
  );
  if (!data.success) throw new Error(data.message || "加载 Key 失败");
  credentials.value = Array.isArray(data.data) ? data.data : [];
}

async function load() {
  loading.value = true;
  try {
    const [typesRes] = await Promise.all([
      http.get<{ success: boolean; data?: ChannelType[] }>("/api/admin/channel-types"),
      loadCredentials(),
    ]);
    // 充值渠道（DeepSeek）没有额度窗口，不列出。
    channels.value = (typesRes.data.data ?? []).filter((channel) => channel.productType === "coding_plan");
    if (!channels.value.some((channel) => channel.code === selectedCode.value)) {
      selectedCode.value = channels.value[0]?.code ?? null;
    }
  } catch (error) {
    ElMessage.error(requestMessage(error, "加载失败"));
  } finally {
    loading.value = false;
  }
}

async function refresh() {
  refreshing.value = true;
  try {
    if (OFFICIAL_QUOTA_CHANNELS.has(selectedCode.value ?? "")) {
      // 带 JSON 体：axios 对 null 体会发 x-www-form-urlencoded，Fastify 直接回 415。
      const { data } = await http.post<{ reconciled?: { cooled: number; released: number } }>(
        "/api/admin/credentials/official-quota/refresh",
        {},
        { timeout: 180_000 },
      );
      const { cooled = 0, released = 0 } = data.reconciled ?? {};
      if (cooled || released) {
        const parts = [
          cooled ? `${cooled} 把额度已满，转入冷却` : "",
          released ? `${released} 把额度已恢复，解除冷却` : "",
        ].filter(Boolean);
        ElMessage.success(`已按官方额度校正 Key 状态：${parts.join("；")}`);
      }
    }
    await loadCredentials();
  } catch (error) {
    ElMessage.error(requestMessage(error, "刷新失败"));
  } finally {
    refreshing.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.keys-table-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: calc(100vh - 100px);
}

.split {
  display: flex;
  flex: 1;
  gap: 16px;
  min-height: 480px;
  align-items: stretch;
}

.channel-pane,
.keys-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.channel-pane {
  width: 260px;
  flex-shrink: 0;
  padding: 16px 12px;
}

.keys-pane {
  flex: 1;
  min-width: 0;
}

.pane-title {
  margin: 0 8px 10px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.channel-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.channel-item:hover {
  background: #f3f4f6;
}

.channel-item.active {
  background: #eff6ff;
  color: #1d4ed8;
}

.channel-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.channel-count {
  flex-shrink: 0;
  color: #6b7280;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.channel-item.active .channel-count {
  color: #2563eb;
}

.keys-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.keys-title {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
  font-weight: 600;
}

.muted {
  margin: 4px 0 0;
  color: #94a3b8;
  font-size: 13px;
}

.head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.name-search {
  width: 200px;
}

.queried-at {
  color: #64748b;
  font-size: 12px;
}

.disabled-tag {
  margin-left: 6px;
}

.quota-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}

.quota-reset {
  color: #64748b;
  font-size: 12px;
}

.quota-empty {
  color: #94a3b8;
}

@media (max-width: 900px) {
  .split {
    flex-direction: column;
    min-height: 0;
  }

  .channel-pane {
    width: auto;
  }
}
</style>
