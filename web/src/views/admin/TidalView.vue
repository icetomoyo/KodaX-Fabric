<template>
  <div class="tidal-page">
    <div class="page-head">
      <h2 class="page-title">潮汐调度</h2>
      <el-tag :type="statusTag.type" effect="light">{{ statusTag.text }}</el-tag>
      <span class="muted">
        被授权的员工用潮汐KEY，在开放时段内把请求铺到闲置的渠道 Key 上，不挤占席位主人。
      </span>
    </div>

    <el-card shadow="never" v-loading="settingsLoading">
      <template #header>规则</template>
      <el-form label-width="150px" class="rule-form" @submit.prevent>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
        <el-form-item label="开放时段">
          <el-time-select
            v-model="form.windowStart"
            start="00:00"
            end="23:30"
            step="00:30"
            :clearable="false"
            style="width: 130px"
          />
          <span class="range-sep">至</span>
          <el-time-select
            v-model="form.windowEnd"
            start="00:00"
            end="23:30"
            step="00:30"
            :clearable="false"
            style="width: 130px"
          />
          <span class="hint">{{ timezone }}；起止相同表示全天开放</span>
        </el-form-item>
        <el-form-item label="周用量档位（%）">
          <el-input v-model="form.weeklyTiers" style="width: 200px" placeholder="例如 5, 20" />
          <span class="hint">先用周用量低于第一个数的 Key，不够再用下一档</span>
        </el-form-item>
        <el-form-item label="周用量借用线（%）">
          <el-input-number v-model="form.weeklyLine" :min="1" :max="100" controls-position="right" />
          <span class="hint">Key 的周用量到这个比例后，潮汐不再用它</span>
        </el-form-item>
        <el-form-item label="5 小时借用线（%）">
          <el-input-number v-model="form.fiveHourLine" :min="1" :max="100" controls-position="right" />
          <span class="hint">留出余量，主人早上来时 5 小时额度还够用</span>
        </el-form-item>
        <el-form-item label="每把 Key 潮汐并发">
          <el-input-number v-model="form.perKeyConcurrency" :min="1" :max="20" controls-position="right" />
          <span class="hint">越小铺得越薄；总并发靠 Key 的数量撑</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" :disabled="!settingsLoaded" @click="saveSettings">
            保存规则
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" v-loading="overviewLoading">
      <template #header>
        <div class="card-head">
          <span>运行情况</span>
          <el-button link type="primary" @click="loadOverview">刷新</el-button>
        </div>
      </template>
      <div class="stat-row">
        <div class="stat">
          <span class="stat-label">近 24 小时请求</span>
          <strong>{{ formatNumber(overview.last24h.requests) }}</strong>
        </div>
        <div class="stat">
          <span class="stat-label">消耗积分</span>
          <strong>{{ formatNumber(Math.round(overview.last24h.credits)) }}</strong>
        </div>
        <div class="stat">
          <span class="stat-label">失败请求</span>
          <strong>{{ formatNumber(overview.last24h.errors) }}</strong>
        </div>
        <div class="stat">
          <span class="stat-label">用到的渠道 Key</span>
          <strong>{{ formatNumber(overview.last24h.keysUsed) }}</strong>
        </div>
      </div>

      <el-table :data="overview.pools" size="small" empty-text="没有可用的调度池">
        <el-table-column prop="name" label="调度池" min-width="140" />
        <el-table-column label="Key 总数" width="90" prop="preview.total" />
        <el-table-column label="现在可借" min-width="220">
          <template #default="{ row }">
            <el-tag
              v-for="(count, index) in row.preview.usableByTier"
              :key="index"
              class="tier-tag"
              :type="count > 0 ? 'success' : 'info'"
              effect="plain"
              size="small"
            >
              {{ tierLabel(index) }} {{ count }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="不可借" min-width="320">
          <template #default="{ row }">
            <span class="muted">{{ skippedText(row.preview.skipped) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="潮汐在途" width="100" prop="preview.tidalInFlight" />
      </el-table>

      <el-table
        v-if="overview.live.length > 0"
        :data="overview.live"
        size="small"
        class="live-table"
      >
        <el-table-column label="正在跑潮汐请求的 Key" min-width="200">
          <template #default="{ row }">{{ row.label }} · 尾号 {{ row.secretSuffix }}</template>
        </el-table-column>
        <el-table-column prop="productLineName" label="套餐" min-width="140" />
        <el-table-column label="席位主人" min-width="120">
          <template #default="{ row }">{{ row.ownerName || "—" }}</template>
        </el-table-column>
        <el-table-column prop="tidalInFlight" label="潮汐在途" width="100" />
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="card-head">
          <span>授权名单</span>
          <div class="head-actions">
            <el-badge :value="pendingCount" :hidden="pendingCount === 0">
              <el-button @click="openApplications">查看申请</el-button>
            </el-badge>
            <el-button type="primary" @click="openCreate">新增授权</el-button>
          </div>
        </div>
      </template>
      <el-table :data="grants" v-loading="grantsLoading" empty-text="还没有给任何人授权">
        <el-table-column label="员工" min-width="150">
          <template #default="{ row }">
            {{ row.employeeName }}
            <el-tag v-if="row.expired" type="info" effect="plain" size="small">已到期</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="employeePhone" label="手机" width="130" />
        <el-table-column label="企业" min-width="140">
          <template #default="{ row }">{{ row.enterpriseName || "—" }}</template>
        </el-table-column>
        <el-table-column prop="maxConcurrency" label="并发上限" width="90" />
        <el-table-column prop="rpmLimit" label="每分钟请求" width="100" />
        <el-table-column label="到期" width="170">
          <template #default="{ row }">{{ row.expiresAt ? formatTime(row.expiresAt) : "长期有效" }}</template>
        </el-table-column>
        <el-table-column label="潮汐KEY" min-width="150">
          <template #default="{ row }">
            <template v-if="row.key">
              <code>{{ row.key.keyPrefix }}••••</code>
              <span v-if="row.inFlight > 0" class="in-flight">在途 {{ row.inFlight }}</span>
            </template>
            <span v-else class="muted">员工尚未创建</span>
          </template>
        </el-table-column>
        <el-table-column label="最近使用" width="170">
          <template #default="{ row }">
            {{ row.key?.lastUsedAt ? formatTime(row.key.lastUsedAt) : "—" }}
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.note || "—" }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="revoke(row)">撤销</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="editing ? '编辑授权' : '新增授权'"
      width="480px"
    >
      <el-form label-width="110px" @submit.prevent>
        <el-form-item label="员工" required>
          <el-input v-if="editing" :model-value="editing.employeeName" disabled />
          <el-select
            v-else
            v-model="grantForm.employeeId"
            filterable
            remote
            :remote-method="searchEmployees"
            :loading="searching"
            placeholder="输入姓名或手机号搜索"
            style="width: 100%"
          >
            <el-option
              v-for="item in employeeOptions"
              :key="item.id"
              :label="employeeOptionLabel(item)"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="并发上限" required>
          <el-input-number v-model="grantForm.maxConcurrency" :min="1" :max="200" controls-position="right" />
        </el-form-item>
        <el-form-item label="每分钟请求" required>
          <el-input-number v-model="grantForm.rpmLimit" :min="1" :max="100000" controls-position="right" />
        </el-form-item>
        <el-form-item label="到期时间">
          <el-date-picker
            v-model="grantForm.expiresAt"
            type="datetime"
            placeholder="不填表示长期有效"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="grantForm.note" maxlength="200" placeholder="例如 Agent 夜间回归测试" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitGrant">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="applicationsVisible" title="潮汐申请" width="1100px" append-to-body>
      <div class="applications-bar">
        <el-radio-group v-model="applicationFilter" @change="loadApplications">
          <el-radio-button value="pending">待审核</el-radio-button>
          <el-radio-button value="all">全部</el-radio-button>
        </el-radio-group>
        <span class="muted">通过后按员工申请的到期时间生成授权，员工就能在「潮汐KEY」页创建潮汐KEY。</span>
      </div>
      <el-table
        :data="applications"
        v-loading="applicationsLoading"
        :empty-text="applicationFilter === 'pending' ? '没有待审核的申请' : '还没有人申请'"
      >
        <el-table-column label="员工" min-width="120" prop="employeeName" />
        <el-table-column prop="employeePhone" label="手机" width="120" />
        <el-table-column label="企业" min-width="110">
          <template #default="{ row }">{{ row.enterpriseName || "—" }}</template>
        </el-table-column>
        <el-table-column label="申请用到" width="175">
          <template #default="{ row }">
            {{ formatTime(row.requestedExpiresAt) }}
            <el-tag
              v-if="row.status === 'pending' && isPast(row.requestedExpiresAt)"
              type="info"
              effect="plain"
              size="small"
            >
              已过
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="申请说明" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.reason || "—" }}</template>
        </el-table-column>
        <el-table-column label="申请时间" width="175">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tooltip
              :content="`驳回理由：${row.reviewNote}`"
              :disabled="row.status !== 'rejected' || !row.reviewNote"
              placement="top"
            >
              <el-tag :type="applicationStatus(row.status).type" effect="light" size="small">
                {{ applicationStatus(row.status).text }}
              </el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <template v-if="row.status === 'pending'">
              <el-button link type="primary" @click="openApprove(row)">通过</el-button>
              <el-button link type="danger" @click="rejectApplication(row)">驳回</el-button>
            </template>
            <span v-else class="muted">{{ row.reviewedByName || "—" }}</span>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="applicationsVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="approveVisible" title="通过申请" width="460px" append-to-body>
      <el-form v-if="approving" label-width="110px" @submit.prevent>
        <el-form-item label="员工">
          <el-input :model-value="approving.employeeName" disabled />
        </el-form-item>
        <el-form-item label="到期时间">
          <el-input :model-value="formatTime(approving.requestedExpiresAt)" disabled />
        </el-form-item>
        <el-form-item label="并发上限" required>
          <el-input-number v-model="approveForm.maxConcurrency" :min="1" :max="200" controls-position="right" />
        </el-form-item>
        <el-form-item label="每分钟请求" required>
          <el-input-number v-model="approveForm.rpmLimit" :min="1" :max="100000" controls-position="right" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="approveVisible = false">取消</el-button>
        <el-button type="primary" :loading="reviewing" @click="submitApprove">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";

type SkipReason =
  | "unavailable"
  | "cooling"
  | "foreign"
  | "in_use"
  | "weekly_line"
  | "monthly_line"
  | "five_hour_line"
  | "busy";

type TidalSettings = {
  enabled: boolean;
  windowStart: string;
  windowEnd: string;
  weeklyTiers: number[];
  weeklyLine: number;
  fiveHourLine: number;
  perKeyConcurrency: number;
};

type Grant = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeePhone: string;
  enterpriseName: string | null;
  maxConcurrency: number;
  rpmLimit: number;
  expiresAt: string | null;
  expired: boolean;
  note: string | null;
  key: { id: number; keyPrefix: string; lastUsedAt: string | null } | null;
  inFlight: number;
};

type Application = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeePhone: string;
  enterpriseName: string | null;
  requestedExpiresAt: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  reviewedByName: string | null;
  createdAt: string;
};

const APPLICATION_STATUS: Record<
  Application["status"],
  { type: "warning" | "success" | "info"; text: string }
> = {
  pending: { type: "warning", text: "待审核" },
  approved: { type: "success", text: "已通过" },
  rejected: { type: "info", text: "已驳回" },
};

type Overview = {
  pools: Array<{
    poolKey: string;
    name: string;
    preview: {
      total: number;
      usableByTier: number[];
      skipped: Record<SkipReason, number>;
      tidalInFlight: number;
    };
  }>;
  live: Array<{
    credentialId: number;
    label: string;
    secretSuffix: string;
    productLineName: string;
    ownerName: string | null;
    tidalInFlight: number;
  }>;
  last24h: { requests: number; errors: number; totalTokens: number; credits: number; keysUsed: number };
};

const SKIP_LABELS: Array<[SkipReason, string]> = [
  ["in_use", "有人在用"],
  ["weekly_line", "周用量越线"],
  ["monthly_line", "月用量越线"],
  ["five_hour_line", "5 小时越线"],
  ["busy", "并发已满"],
  ["cooling", "冷却中"],
  ["unavailable", "停用"],
];

const settingsLoading = ref(false);
const settingsLoaded = ref(false);
const saving = ref(false);
const timezone = ref("");
const windowOpen = ref(false);
const savedEnabled = ref(false);
const form = reactive({
  enabled: false,
  windowStart: "22:00",
  windowEnd: "07:00",
  weeklyTiers: "5, 20",
  weeklyLine: 50,
  fiveHourLine: 60,
  perKeyConcurrency: 2,
});
/** 已保存的档位分界（比例），用来给「现在可借」的各档起名。 */
const savedTiers = ref<number[]>([0.05, 0.2]);

const overviewLoading = ref(false);
const overview = ref<Overview>({
  pools: [],
  live: [],
  last24h: { requests: 0, errors: 0, totalTokens: 0, credits: 0, keysUsed: 0 },
});

const grantsLoading = ref(false);
const grants = ref<Grant[]>([]);
const dialogVisible = ref(false);
const editing = ref<Grant | null>(null);
const submitting = ref(false);
const searching = ref(false);
type EmployeeOption = { id: number; name: string; phone: string; departmentName?: string | null };
const employeeOptions = ref<EmployeeOption[]>([]);
const grantForm = reactive({
  employeeId: null as number | null,
  maxConcurrency: 20,
  rpmLimit: 600,
  expiresAt: null as Date | null,
  note: "",
});

const applicationsVisible = ref(false);
const applicationsLoading = ref(false);
const applicationFilter = ref<"pending" | "all">("pending");
const applications = ref<Application[]>([]);
const pendingCount = ref(0);
const approveVisible = ref(false);
const approving = ref<Application | null>(null);
const reviewing = ref(false);
const approveForm = reactive({ maxConcurrency: 20, rpmLimit: 600 });

const statusTag = computed<{ type: "success" | "warning" | "info"; text: string }>(() => {
  if (!savedEnabled.value) return { type: "info", text: "未开启" };
  return windowOpen.value
    ? { type: "success", text: "开放中" }
    : { type: "warning", text: "未到开放时段" };
});

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof message === "string" ? message : fallback;
}

function percent(ratio: number): number {
  return Math.round(ratio * 1000) / 10;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function tierLabel(index: number): string {
  const tiers = savedTiers.value;
  if (index < tiers.length) return `周用量 <${percent(tiers[index])}%`;
  return `周用量 ≥${percent(tiers[tiers.length - 1])}%`;
}

function skippedText(skipped: Record<SkipReason, number>): string {
  const parts = SKIP_LABELS.filter(([reason]) => skipped[reason] > 0).map(
    ([reason, label]) => `${label} ${skipped[reason]}`,
  );
  return parts.length > 0 ? parts.join(" · ") : "无";
}

function applySettings(data: { settings: TidalSettings; timezone: string; windowOpen: boolean }) {
  const { settings } = data;
  form.enabled = settings.enabled;
  form.windowStart = settings.windowStart;
  form.windowEnd = settings.windowEnd;
  form.weeklyTiers = settings.weeklyTiers.map(percent).join(", ");
  form.weeklyLine = percent(settings.weeklyLine);
  form.fiveHourLine = percent(settings.fiveHourLine);
  form.perKeyConcurrency = settings.perKeyConcurrency;
  savedTiers.value = settings.weeklyTiers;
  savedEnabled.value = settings.enabled;
  timezone.value = data.timezone;
  windowOpen.value = data.windowOpen;
}

async function loadSettings() {
  settingsLoading.value = true;
  try {
    const { data } = await http.get("/api/admin/tidal/settings");
    applySettings(data.data);
    settingsLoaded.value = true;
  } catch (error) {
    ElMessage.error(errorMessage(error, "加载潮汐调度规则失败"));
  } finally {
    settingsLoading.value = false;
  }
}

async function saveSettings() {
  const tiers = form.weeklyTiers
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map((item) => Number(item) / 100);
  if (tiers.length === 0 || tiers.some((tier) => !Number.isFinite(tier) || tier <= 0 || tier >= 1)) {
    ElMessage.error("周用量档位请填 1 到 99 之间的数字，用逗号分隔");
    return;
  }
  saving.value = true;
  try {
    const { data } = await http.put("/api/admin/tidal/settings", {
      enabled: form.enabled,
      windowStart: form.windowStart,
      windowEnd: form.windowEnd,
      weeklyTiers: tiers,
      weeklyLine: form.weeklyLine / 100,
      fiveHourLine: form.fiveHourLine / 100,
      perKeyConcurrency: form.perKeyConcurrency,
    });
    applySettings(data.data);
    ElMessage.success("规则已保存");
    void loadOverview();
  } catch (error) {
    ElMessage.error(errorMessage(error, "保存失败"));
  } finally {
    saving.value = false;
  }
}

async function loadOverview() {
  overviewLoading.value = true;
  try {
    const { data } = await http.get("/api/admin/tidal/overview");
    overview.value = data.data;
  } catch (error) {
    ElMessage.error(errorMessage(error, "加载运行情况失败"));
  } finally {
    overviewLoading.value = false;
  }
}

async function loadGrants() {
  grantsLoading.value = true;
  try {
    const { data } = await http.get("/api/admin/tidal/grants");
    grants.value = data.data;
  } catch (error) {
    ElMessage.error(errorMessage(error, "加载授权名单失败"));
  } finally {
    grantsLoading.value = false;
  }
}

function applicationStatus(status: Application["status"]) {
  return APPLICATION_STATUS[status];
}

function isPast(value: string): boolean {
  return new Date(value).getTime() <= Date.now();
}

async function loadApplications() {
  applicationsLoading.value = true;
  try {
    const { data } = await http.get("/api/admin/tidal/applications", {
      params: { status: applicationFilter.value },
    });
    applications.value = data.data;
    pendingCount.value = data.pendingCount;
  } catch (error) {
    ElMessage.error(errorMessage(error, "加载申请失败"));
  } finally {
    applicationsLoading.value = false;
  }
}

function openApplications() {
  applicationFilter.value = "pending";
  applicationsVisible.value = true;
  void loadApplications();
}

function openApprove(row: Application) {
  approving.value = row;
  Object.assign(approveForm, { maxConcurrency: 20, rpmLimit: 600 });
  approveVisible.value = true;
}

async function submitApprove() {
  if (!approving.value) return;
  reviewing.value = true;
  try {
    await http.post(`/api/admin/tidal/applications/${approving.value.id}/approve`, {
      maxConcurrency: approveForm.maxConcurrency,
      rpmLimit: approveForm.rpmLimit,
    });
    ElMessage.success("已通过，员工可在「潮汐KEY」页创建潮汐KEY");
    approveVisible.value = false;
    await Promise.all([loadApplications(), loadGrants()]);
  } catch (error) {
    ElMessage.error(errorMessage(error, "操作失败"));
    await loadApplications();
  } finally {
    reviewing.value = false;
  }
}

async function rejectApplication(row: Application) {
  let reviewNote = "";
  try {
    const result = await ElMessageBox.prompt(
      `驳回「${row.employeeName}」的潮汐申请？理由会显示给员工，可以不填。`,
      "驳回申请",
      {
        confirmButtonText: "驳回",
        cancelButtonText: "取消",
        inputPlaceholder: "驳回理由",
        inputValidator: (value) => (value ?? "").length <= 200 || "理由最多 200 个字",
      },
    );
    reviewNote = (result.value ?? "").trim();
  } catch {
    return;
  }
  try {
    await http.post(`/api/admin/tidal/applications/${row.id}/reject`, {
      reviewNote: reviewNote || null,
    });
    ElMessage.success("已驳回");
  } catch (error) {
    ElMessage.error(errorMessage(error, "操作失败"));
  }
  await loadApplications();
}

/** 带上部门，重名的人能分得开。 */
function employeeOptionLabel(item: EmployeeOption): string {
  const base = `${item.name}（${item.phone}）`;
  return item.departmentName ? `${base} · ${item.departmentName}` : base;
}

async function searchEmployees(query: string) {
  const q = query.trim();
  if (!q) {
    employeeOptions.value = [];
    return;
  }
  searching.value = true;
  try {
    const { data } = await http.get("/api/admin/users", {
      params: { q, status: "active", limit: 20 },
    });
    // 这个接口的员工数组直接放在 data 里（分页总数在同级的 total）。
    employeeOptions.value = Array.isArray(data.data) ? data.data : [];
  } catch {
    employeeOptions.value = [];
  } finally {
    searching.value = false;
  }
}

function openCreate() {
  editing.value = null;
  employeeOptions.value = [];
  Object.assign(grantForm, {
    employeeId: null,
    maxConcurrency: 20,
    rpmLimit: 600,
    expiresAt: null,
    note: "",
  });
  dialogVisible.value = true;
}

function openEdit(row: Grant) {
  editing.value = row;
  Object.assign(grantForm, {
    employeeId: row.employeeId,
    maxConcurrency: row.maxConcurrency,
    rpmLimit: row.rpmLimit,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    note: row.note ?? "",
  });
  dialogVisible.value = true;
}

async function submitGrant() {
  if (grantForm.employeeId == null) {
    ElMessage.error("请选择员工");
    return;
  }
  const payload = {
    maxConcurrency: grantForm.maxConcurrency,
    rpmLimit: grantForm.rpmLimit,
    expiresAt: grantForm.expiresAt ? grantForm.expiresAt.toISOString() : null,
    note: grantForm.note.trim() || null,
  };
  submitting.value = true;
  try {
    if (editing.value) {
      await http.patch(`/api/admin/tidal/grants/${editing.value.id}`, payload);
      ElMessage.success("授权已更新");
    } else {
      await http.post("/api/admin/tidal/grants", { employeeId: grantForm.employeeId, ...payload });
      ElMessage.success("已授权，员工可在「潮汐KEY」页创建潮汐KEY");
    }
    dialogVisible.value = false;
    await loadGrants();
  } catch (error) {
    ElMessage.error(errorMessage(error, "保存失败"));
  } finally {
    submitting.value = false;
  }
}

async function revoke(row: Grant) {
  try {
    await ElMessageBox.confirm(
      `确认撤销「${row.employeeName}」的潮汐授权？TA 的潮汐KEY 会立即失效并被删除，正在跑的测试会中断。`,
      "撤销授权",
      { type: "warning", confirmButtonText: "撤销", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  try {
    await http.delete(`/api/admin/tidal/grants/${row.id}`);
    ElMessage.success("已撤销");
    await loadGrants();
  } catch (error) {
    ElMessage.error(errorMessage(error, "撤销失败"));
  }
}

onMounted(() => {
  void loadSettings();
  void loadOverview();
  void loadGrants();
  void loadApplications();
});
</script>

<style scoped>
.tidal-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.rule-form {
  max-width: 860px;
}

.range-sep {
  margin: 0 8px;
  color: var(--el-text-color-regular);
}

.hint {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.applications-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.stat-row {
  display: flex;
  gap: 40px;
  margin-bottom: 16px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat strong {
  font-size: 20px;
}

.stat-label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.tier-tag + .tier-tag {
  margin-left: 6px;
}

.live-table {
  margin-top: 16px;
}

.in-flight {
  margin-left: 8px;
  color: var(--el-color-success);
  font-size: 12px;
}
</style>
