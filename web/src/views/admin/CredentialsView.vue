<template>
  <div class="keys-board-page">
    <div>
      <div class="keys-board-toolbar">
        <span class="keys-board-toolbar-count">
          {{ boardVisibleRows.length }}{{ boardSearch.trim() ? ` / ${rows.length}` : "" }} 个 Key
        </span>
        <el-input
          v-model="boardSearch"
          class="keys-board-search"
          clearable
          placeholder="搜索姓名"
        />
        <el-button
          v-if="canWrite"
          :loading="batchTesting"
          :disabled="!boardVisibleRows.length"
          @click="batchTestCredentials"
        >
          {{ batchTesting ? `测试中 ${batchTestProgress.done}/${batchTestProgress.total}` : "测试全部" }}
        </el-button>
        <el-button :loading="loading" @click="refreshAll">刷新</el-button>
      </div>
      <div v-loading="loading" class="keys-board-stack">
        <el-empty
          v-if="!loading && !rows.length"
          description="暂无 Key"
          :image-size="96"
        />
        <el-empty
          v-else-if="!loading && !boardVisibleRows.length"
          description="没有匹配的人"
          :image-size="96"
        />
        <div v-else class="keys-lane-grid">
          <div
            v-for="column in allBoardColumns"
            :key="column.lane"
            class="kanban-column"
            :class="{
              droppable: canWrite && column.droppable && draggingId != null,
              'drag-over': isDragOver(0, column.lane),
            }"
            @dragover="onColumnDragOver(0, column, $event)"
            @dragleave="onColumnDragLeave(0, column)"
            @drop.prevent="onColumnDrop(column)"
          >
            <header class="kanban-column-head" :class="`is-${column.lane}`">
              <span class="kanban-column-title">{{ column.title }}</span>
              <span class="kanban-count">{{ column.keys.length }}</span>
            </header>
            <div class="kanban-cards is-rings">
              <button
                v-for="row in column.keys"
                :key="row.id"
                type="button"
                class="key-ring"
                :class="{ dragging: draggingId === row.id, 'is-testing': isTesting(row.id) }"
                :draggable="canWrite"
                :title="keyRingTitle(row)"
                @dragstart="onCardDragStart(row, $event)"
                @dragend="onCardDragEnd"
                @click="openKeyDetails(row)"
              >
                <svg class="key-ring-svg" viewBox="0 0 72 72" aria-hidden="true">
                  <circle class="key-ring-track" cx="36" cy="36" r="30" />
                  <circle class="key-ring-track inner" cx="36" cy="36" r="21" />
                  <circle
                    class="key-ring-progress outer"
                    cx="36"
                    cy="36"
                    r="30"
                    :stroke="quotaRingColor(quotaRingPercent(row.weeklyCredits, row.weeklyCreditLimit), 'weekly')"
                    :stroke-dasharray="quotaRingDash(row.weeklyCredits, row.weeklyCreditLimit, 30)"
                  />
                  <circle
                    class="key-ring-progress inner"
                    cx="36"
                    cy="36"
                    r="21"
                    :stroke="quotaRingColor(quotaRingPercent(row.fiveHourCredits, row.fiveHourCreditLimit), 'five')"
                    :stroke-dasharray="quotaRingDash(row.fiveHourCredits, row.fiveHourCreditLimit, 21)"
                  />
                  <circle cx="36" cy="36" r="12" :fill="channelDotColor(row.productLineId)" />
                </svg>
                <span class="key-ring-pct">
                  <span v-if="isTesting(row.id)" class="latency-spinner" aria-hidden="true" />
                  <template v-else>{{ keyRingCaption(row) }}</template>
                </span>
              </button>
              <div v-if="!column.keys.length" class="kanban-empty">暂无 Key</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <el-drawer
      v-model="showKeyDetails"
      title="Key 详情"
      size="min(680px, 92vw)"
      destroy-on-close
      class="key-detail-drawer"
      @closed="closeKeyDetails"
    >
      <template v-if="detailRow">
        <div class="drawer-head">
          <div>
            <div class="detail-title-row">
              <h3 class="drawer-title">{{ detailRow.label }}</h3>
              <el-tag :type="statusTagType(visibleStatus(detailRow))">
                {{ statusText(visibleStatus(detailRow)) }}
              </el-tag>
            </div>
            <p>
              {{ channelDisplayName(detailRow) }} ·
              <span class="secret-mask inline">•••• {{ detailRow.secretSuffix }}</span>
            </p>
          </div>
          <div v-if="canWrite" class="drawer-actions">
            <el-button
              v-if="detailRow.status === 'active'"
              type="warning"
              plain
              @click="setStatus(detailRow, 'disabled')"
            >
              停用
            </el-button>
            <el-button v-else type="success" plain @click="setStatus(detailRow, 'active')">
              启用
            </el-button>
          </div>
        </div>

        <div class="drawer-sections">
          <section class="detail-section">
            <h4 class="section-heading">基本信息</h4>
            <dl class="info-grid">
              <div class="info-item">
                <dt>最近使用</dt>
                <dd>{{ formatDateTime(detailRow.lastUsedAt) }}</dd>
              </div>
              <div class="info-item">
                <dt>累计成功 / 失败</dt>
                <dd>
                  <span class="ok-text">{{ detailRow.successCount }}</span>
                  /
                  <span class="bad-text">{{ detailRow.errorCount }}</span>
                </dd>
              </div>
              <div class="info-item">
                <dt>冷却至</dt>
                <dd>{{ detailRow.coolUntil ? formatDateTime(detailRow.coolUntil) : "—" }}</dd>
              </div>
            </dl>
          </section>

          <section class="detail-section">
            <div class="section-heading-row">
              <h4 class="section-heading">额度与绑定</h4>
              <el-button
                v-if="canWrite"
                type="primary"
                :loading="quotaSaving"
                @click="saveQuotaLimits"
              >
                保存额度
              </el-button>
            </div>
            <dl class="info-grid">
              <div class="info-item">
                <dt>绑定状态</dt>
                <dd>
                  <span class="binding-badge" :class="bindingTone(detailRow.binding)">
                    {{ bindingLabel(detailRow.binding) }}
                  </span>
                </dd>
              </div>
              <div class="info-item">
                <dt>5 小时用量</dt>
                <dd>{{ formatQuotaPair(detailRow.fiveHourCredits, detailRow.fiveHourCreditLimit) }}</dd>
              </div>
              <div class="info-item">
                <dt>5 小时重置</dt>
                <dd>
                  {{
                    detailRow.nextFiveHourResetAt
                      ? `${formatDateTime(detailRow.nextFiveHourResetAt)} 恢复 100%`
                      : "已恢复，下次调用起算"
                  }}
                </dd>
              </div>
              <div class="info-item">
                <dt>本周用量</dt>
                <dd>{{ formatQuotaPair(detailRow.weeklyCredits, detailRow.weeklyCreditLimit) }}</dd>
              </div>
              <div class="info-item">
                <dt>周额度重置</dt>
                <dd>
                  <template v-if="detailRow.nextWeeklyResetAt">
                    {{ formatDateTime(detailRow.nextWeeklyResetAt) }} 恢复 100%
                    <span v-if="detailRow.weeklyResetEstimated" class="estimate-mark">（估算）</span>
                  </template>
                  <template v-else>—</template>
                </dd>
              </div>
            </dl>
            <div v-if="detailRow.fiveHourCreditLimit != null" class="quota-progress">
              <span>5 小时</span>
              <el-progress
                :percentage="usagePercent(detailRow.fiveHourCredits, detailRow.fiveHourCreditLimit)"
                :status="usageProgressStatus(detailRow.fiveHourCredits, detailRow.fiveHourCreditLimit)"
              />
            </div>
            <div v-if="detailRow.weeklyCreditLimit != null" class="quota-progress">
              <span>本周</span>
              <el-progress
                :percentage="usagePercent(detailRow.weeklyCredits, detailRow.weeklyCreditLimit)"
                :status="usageProgressStatus(detailRow.weeklyCredits, detailRow.weeklyCreditLimit)"
              />
            </div>
            <el-form v-if="canWrite" label-position="top" class="credential-form quota-edit-form">
              <div class="quota-fields">
                <el-form-item label="5 小时积分额度">
                  <el-input
                    v-model="quotaEditForm.fiveHourCreditLimit"
                    placeholder="团队高级版 35000"
                    clearable
                  />
                </el-form-item>
                <el-form-item label="周积分额度">
                  <el-input
                    v-model="quotaEditForm.weeklyCreditLimit"
                    placeholder="团队高级版 155000"
                    clearable
                  />
                </el-form-item>
              </div>
              <p class="form-help">额度按智谱积分计量，可空非负数，允许小数；留空表示不限额。</p>
            </el-form>
          </section>

          <section class="detail-section">
            <div class="section-heading-row">
              <h4 class="section-heading">健康检查</h4>
              <div v-if="canWrite" class="test-controls">
                <el-button
                  type="primary"
                  :loading="isTesting(detailRow.id)"
                  @click="testCredential(detailRow)"
                >
                  测试连接
                </el-button>
              </div>
            </div>
            <div v-if="detailRow.lastError" class="current-error-block">
              <div class="current-error-head">
                <strong>当前异常</strong>
                <span>{{ formatDateTime(detailRow.lastErrorAt) }}</span>
              </div>
              <p class="vendor-error">{{ detailRow.lastError }}</p>
            </div>
            <template v-if="lastTest(detailRow)">
              <dl class="info-grid">
                <div class="info-item">
                  <dt>上次测试结果</dt>
                  <dd>
                    <el-tag :type="lastTest(detailRow)?.ok ? 'success' : 'danger'">
                      {{ lastTest(detailRow)?.ok ? "上次测试正常" : "测试失败" }}
                    </el-tag>
                  </dd>
                </div>
                <div class="info-item">
                  <dt>延迟 / HTTP</dt>
                  <dd>{{ lastTest(detailRow)?.latencyMs ?? "—" }} ms / {{ lastTest(detailRow)?.httpStatus ?? "—" }}</dd>
                </div>
                <div class="info-item">
                  <dt>测试时间</dt>
                  <dd>{{ formatDateTime(lastTest(detailRow)?.testedAt) }}</dd>
                </div>
                <div class="info-item full">
                  <dt>消息</dt>
                  <dd :class="{ 'error-text': !lastTest(detailRow)?.ok }">
                    {{ lastTest(detailRow)?.message || "—" }}
                  </dd>
                </div>
              </dl>
              <div v-if="discoveredModels(detailRow).length" class="models-block">
                <div class="models-heading">已发现 {{ discoveredModels(detailRow).length }} 个模型</div>
                <div class="model-tags">
                  <el-tag v-for="model in discoveredModels(detailRow)" :key="model">
                    {{ model }}
                  </el-tag>
                </div>
              </div>
            </template>
            <p v-else class="empty-hint">尚未做过连通性测试。</p>
          </section>

        </div>
      </template>
    </el-drawer>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";

import { useRoute, useRouter } from "vue-router";

import { ElMessage, ElMessageBox } from "element-plus";

import { http } from "@/api/http";

import { channelDisplayName, formatChannelName } from "@/lib/channel-display";

import { formatDateTime } from "@/lib/date-time";

import {
  coolingLaneFromFailureKind,
  coolingLaneFromLastError,
  isShortRateLimitCooling,
} from "@/lib/keys-board-cooling";

import { usagePercent, usageProgressStatus } from "@/lib/tokens";

import { useAuthStore } from "@/stores/auth";

import {
  RELAY_PROTOCOLS,
  relayProtocolLabel,
  relayProtocolOptions,
  type RelayAuthStyle,
  type RelayProtocol,
  type RelayProtocolConfigs,
} from "@/views/relay-protocol";

type ChannelStatus = "active" | "disabled";

type CredentialStatus = ChannelStatus | "auto_disabled" | "cooling";

type BindingScopeType = "employee" | "team" | "enterprise";

type CredentialBinding = {
  scopeType: BindingScopeType;
  scopeId: number;
  scopeName: string;
};

type TestResult = {
  ok: boolean;
  testedAt: string;
  latencyMs: number;
  httpStatus: number | null;
  modelCount: number;
  models: string[];
  message: string;
  protocol?: RelayProtocol;
};

type CredentialRow = {
  id: number;
  productLineId: number;
  label: string;
  tag?: string | null;
  secretSuffix: string;
  supportedProtocols: RelayProtocol[];
  weight: number;
  status: CredentialStatus;
  coolUntil: string | null;
  lastUsedAt: string | null;
  successCount: number;
  errorCount: number;
  recentWindowHours?: number;
  recentSuccessCount?: number;
  recentErrorCount?: number;
  lastError: string | null;
  lastErrorAt: string | null;
  providerCode: string;
  providerName: string;
  providerStatus: string;
  productLineCode: string;
  productLineName: string;
  productLineStatus: ChannelStatus;
  productType: "api" | "coding_plan";
  protocolConfigs: RelayProtocolConfigs;
  configVersion: number;
  seatCount?: number;
  productLineTag?: string;
  testModel?: string | null;
  defaultBaseUrl: string;
  baseUrlOverride: string | null;
  fiveHourCreditLimit: number | null;
  weeklyCreditLimit: number | null;
  fiveHourCredits: number;
  weeklyCredits: number;
  /** 结构化失败分类（服务端写入/迁移回填），泳道划分优先读它。 */
  lastFailureKind: string | null;
  lastVendorCode: string | null;
  /** 5h：窗口进行中 → 锚点+5h；已过期/未锚定 → null（下次调用起算）。 */
  nextFiveHourResetAt: string | null;
  /** 周窗口下一次翻转时刻（未学到相位时为 epoch 估算，见 weeklyResetEstimated）。 */
  nextWeeklyResetAt: string | null;
  weeklyResetEstimated?: boolean;
  binding: CredentialBinding | null;
  connectedNames?: string[];
  createdAt?: string;
  updatedAt?: string;
  meta: {
    lastTest?: TestResult;
    discoveredModels?: string[];
    [key: string]: unknown;
  } | null;
};

type ProviderBaseUrl = {
  label: string;
  url: string;
  productLineCode: string;
  productLineName: string;
  protocolConfigs?: RelayProtocolConfigs;
};

type ProviderTemplateCode = "glm" | "deepseek";

type ConfiguredProductLine = {
  id: number;
  code: string;
  name: string;
  status: ChannelStatus;
  baseUrl?: string;
  protocolConfigs?: RelayProtocolConfigs;
  configVersion?: number;
};

type ListedProductLine = {
  id: number;
  code: string;
  name: string;
  status: ChannelStatus;
  productType: CredentialRow["productType"];
  protocolConfigs: RelayProtocolConfigs | null;
  configVersion: number;
  providerCode: string;
  providerName: string;
  providerStatus: string;
  baseUrl: string;
  seatCount: number;
  tag: string;
  testModel?: string | null;
};

type ProviderTemplate = {
  code: ProviderTemplateCode;
  /** 公司名称 */
  name: string;
  /** 模型品牌名 */
  modelName: string;
  shortName: string;
  description?: string;
  baseUrls: ProviderBaseUrl[];
  authStyle?: RelayAuthStyle;
  defaultProtocols: RelayProtocol[];
  defaultLabel: string;
  color: string;
  productLines?: ConfiguredProductLine[];
};

type ChannelGroup = {
  id: number;
  providerCode: string;
  providerName: string;
  providerStatus: string;
  productLineCode: string;
  productLineName: string;
  productLineStatus: ChannelStatus;
  productType: CredentialRow["productType"];
  protocolConfigs: RelayProtocolConfigs;
  configVersion: number;
  baseUrl: string;
  protocols: RelayProtocol[];
  keys: CredentialRow[];
  totalCount: number;
  schedulableCount: number;
  coolingCount: number;
  unschedulableCount: number;
  recentSuccessCount: number;
  recentErrorCount: number;
  seatCount: number;
  tag: string;
  testModel: string | null;
};

type ChannelSummary = {
  id: number;
  code: string;
  name: string;
  productType: "api" | "coding_plan";
  allowAutoRoute: boolean;
  status: ChannelStatus;
  provider: { id: number; code: string; name: string; status: string };
  baseUrl: string;
  protocolConfigs: RelayProtocolConfigs;
  configVersion: number;
  protocols: RelayProtocol[];
  stats: {
    totalCount: number;
    schedulableCount: number;
    coolingCount: number;
    unschedulableCount: number;
    recentWindowHours: number;
    recentSuccessCount: number;
    recentErrorCount: number;
  };
};

type BoardLane = "waiting" | "in_use" | "cooling_5h" | "cooling_weekly" | "rate_limit" | "stopped";

type BoardColumn = {
  lane: BoardLane;
  title: string;
  droppable: boolean;
  keys: CredentialRow[];
};

const route = useRoute();

const router = useRouter();

const auth = useAuthStore();

const canWrite = computed(() => auth.isSuperAdmin);

const rows = ref<CredentialRow[]>([]);

const listedProductLines = ref<ListedProductLine[]>([]);

const templates = ref<ProviderTemplate[]>([]);

const loading = ref(false);

const selectedProductLineId = ref<number | null>(null);

const syncingQuery = ref(false);

const boardSearch = ref("");

const draggingId = ref<number | null>(null);

const dragOverLane = ref<{ channelId: number; lane: BoardLane } | null>(null);

const showBulkForm = ref(false);

const showKeyDetails = ref(false);

const detailCredentialId = ref<number | null>(null);

const createFormProtocolConfigs = ref<RelayProtocolConfigs>({});

const createForm = reactive({
  provider: "glm" as "glm" | "deepseek" | "haizhi",
  variant: "domestic" as "domestic" | "international",
  name: "",
  tag: "",
  seatCount: null as number | null,
  supportedProtocols: ["anthropic_messages", "openai_chat", "openai_responses"] as RelayProtocol[],
  status: "active" as ChannelStatus,
  testModel: "",
});

const showChannelDetails = ref(false);

const channelSummaries = ref(new Map<number, ChannelSummary>());

const testingIds = ref<Set<number>>(new Set());

const batchTesting = ref(false);

const batchTestProgress = reactive({ done: 0, total: 0 });

const bulkForm = reactive({
  productLineId: null as number | null,
  providerCode: "glm" as string,
  custom: false,
  baseUrl: "",
  name: "",
  seatCount: null as number | null,
  rawKeys: "",
  tag: "",
  supportedProtocols: ["openai_chat"] as RelayProtocol[],
  status: "active" as ChannelStatus,
  fiveHourCreditLimit: "",
  weeklyCreditLimit: "",
});

const quotaEditForm = reactive({
  fiveHourCreditLimit: "",
  weeklyCreditLimit: "",
});

const quotaSaving = ref(false);

const channels = computed<ChannelGroup[]>(() => {
  const grouped = new Map<number, CredentialRow[]>();
  for (const row of rows.value) {
    const group = grouped.get(row.productLineId);
    if (group) group.push(row);
    else grouped.set(row.productLineId, [row]);
  }

  const fromKeys = [...grouped.entries()].map(([id, keys]) => {
    const first = keys[0];
    const coolingCount = keys.filter((key) => visibleStatus(key) === "cooling").length;
    const channelCanSchedule = first.providerStatus === "active"
      && first.productLineStatus === "active";
    const schedulableCount = channelCanSchedule
      ? keys.filter((key) => visibleStatus(key) === "active" && key.weight > 0).length
      : 0;
    return {
      id,
      providerCode: first.providerCode,
      providerName: first.providerName,
      providerStatus: first.providerStatus,
      productLineCode: first.productLineCode,
      productLineName: first.productLineName || first.productLineCode,
      productLineStatus: first.productLineStatus,
      productType: first.productType,
      protocolConfigs: channelProtocolConfigs(keys),
      configVersion: first.configVersion ?? 1,
      baseUrl: effectiveBaseUrl(first),
      protocols: channelProtocols(keys),
      keys,
      totalCount: keys.length,
      schedulableCount,
      coolingCount,
      unschedulableCount: Math.max(0, keys.length - schedulableCount - coolingCount),
      recentSuccessCount: keys.reduce((sum, key) => sum + (key.recentSuccessCount ?? 0), 0),
      recentErrorCount: keys.reduce((sum, key) => sum + (key.recentErrorCount ?? 0), 0),
      seatCount: Number(first.seatCount) || 0,
      tag: first.productLineTag ?? "",
      testModel: first.testModel ?? null,
    };
  });

  const keyedIds = new Set(fromKeys.map((channel) => channel.id));
  const emptyChannels = listedProductLines.value
    .filter((line) => !keyedIds.has(line.id))
    .map((line) => emptyChannelFromProductLine(line));
  return [...fromKeys, ...emptyChannels];
});

const STATUS_BOARD_COLUMN_DEFS: ReadonlyArray<Pick<BoardColumn, "lane" | "title" | "droppable">> = [
  { lane: "waiting", title: "等候", droppable: true },
  { lane: "in_use", title: "使用", droppable: false },
  { lane: "cooling_5h", title: "5 小时冷却", droppable: false },
  { lane: "cooling_weekly", title: "7 天冷却", droppable: false },
  { lane: "rate_limit", title: "限流", droppable: false },
  { lane: "stopped", title: "停用", droppable: true },
];

function coolingLaneOf(row: CredentialRow): "cooling_5h" | "cooling_weekly" {
  return coolingLaneFromLastError({
    lastError: row.lastError,
    weeklyCreditLimit: row.weeklyCreditLimit,
    weeklyCredits: row.weeklyCredits,
    coolUntil: row.coolUntil,
  });
}

function boardLaneOf(row: CredentialRow): BoardLane {
  const status = visibleStatus(row);
  if (status === "disabled" || status === "auto_disabled") return "stopped";
  if (status === "cooling") {
    // 服务端写入的结构化分类优先；缺失时回退旧文本推断（迁移前/手工数据）。
    const lane = coolingLaneFromFailureKind(row.lastFailureKind);
    if (lane) return lane;
    if (isShortRateLimitCooling(row.lastError)) return "rate_limit";
    return coolingLaneOf(row);
  }
  if (row.binding) return "in_use";
  return "waiting";
}

function columnsForKeys(keys: CredentialRow[]): BoardColumn[] {
  return STATUS_BOARD_COLUMN_DEFS.map((column) => ({
    ...column,
    keys: keys.filter((row) => boardLaneOf(row) === column.lane),
  }));
}

const allBoardColumns = computed<BoardColumn[]>(() => columnsForKeys(boardVisibleRows.value));

function credentialMatchesName(row: CredentialRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [
    row.label,
    row.tag,
    row.binding?.scopeName,
    ...(row.connectedNames ?? []),
  ];
  return haystacks.some((value) => String(value ?? "").toLowerCase().includes(needle));
}

const boardVisibleRows = computed(() =>
  rows.value.filter((row) => credentialMatchesName(row, boardSearch.value)),
);

const CHANNEL_DOT_PALETTE = [
  "#6366f1",
  "#06b6d4",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#3b82f6",
  "#14b8a6",
  "#f97316",
  "#84cc16",
] as const;

function channelDotColor(productLineId: number): string {
  const index = Math.abs(productLineId) % CHANNEL_DOT_PALETTE.length;
  return CHANNEL_DOT_PALETTE[index] ?? CHANNEL_DOT_PALETTE[0];
}

function quotaRingPercent(used: number, limit: number | null): number {
  if (limit == null || limit <= 0) return 0;
  return usagePercent(used, limit);
}

function quotaRingColor(percent: number, kind: "five" | "weekly"): string {
  if (percent >= 95) return "#f43f5e";
  if (percent >= 85) return "#f59e0b";
  return kind === "five" ? "#38bdf8" : "#34d399";
}

function quotaRingDash(used: number, limit: number | null, radius: number): string {
  const circumference = 2 * Math.PI * radius;
  const filled = (quotaRingPercent(used, limit) / 100) * circumference;
  return `${filled} ${circumference}`;
}

function keyRingCaption(row: CredentialRow): string {
  if (row.weeklyCreditLimit != null) {
    return `${Math.round(quotaRingPercent(row.weeklyCredits, row.weeklyCreditLimit))}%`;
  }
  if (row.fiveHourCreditLimit != null) {
    return `${Math.round(quotaRingPercent(row.fiveHourCredits, row.fiveHourCreditLimit))}%`;
  }
  return "—";
}

function keyRingTitle(row: CredentialRow): string {
  const five = row.fiveHourCreditLimit == null
    ? "5 小时 不限"
    : `5 小时 ${formatQuotaPair(row.fiveHourCredits, row.fiveHourCreditLimit)}`;
  const week = row.weeklyCreditLimit == null
    ? "7 天 不限"
    : `7 天 ${formatQuotaPair(row.weeklyCredits, row.weeklyCreditLimit)}`;
  const fiveReset = row.nextFiveHourResetAt
    ? `5 小时重置 ${formatDateTime(row.nextFiveHourResetAt)}`
    : "5 小时已恢复，下次调用起算";
  const weekReset = row.nextWeeklyResetAt
    ? `周额度重置 ${formatDateTime(row.nextWeeklyResetAt)}${row.weeklyResetEstimated ? "（估算）" : ""}`
    : "";
  const people = (row.connectedNames ?? []).join("、") || row.binding?.scopeName || "未连接";
  return `${channelDisplayName(row)} · •••• ${row.secretSuffix}\n${people}\n${five}\n${fiveReset}\n${week}${weekReset ? `\n${weekReset}` : ""}`;
}

const detailRow = computed(
  () => rows.value.find((row) => row.id === detailCredentialId.value) ?? null,
);

function parseQueryId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || raw === "") return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function reconcileSelection() {
  const requestedChannelId = parseQueryId(route.query.channelId);
  selectedProductLineId.value =
    requestedChannelId != null && channels.value.some((channel) => channel.id === requestedChannelId)
      ? requestedChannelId
      : null;
}

watch(rows, reconcileSelection, { deep: false });

watch(selectedProductLineId, (id) => {
  if (detailRow.value && id != null && detailRow.value.productLineId !== id) {
    showKeyDetails.value = false;
  }
  showChannelDetails.value = false;
});

watch(() => route.query.channelId, () => {
  if (syncingQuery.value) return;
  reconcileSelection();
});

watch(
  () => [createForm.provider, createForm.variant] as const,
  ([provider], [previousProvider]) => {
    createFormProtocolConfigs.value = defaultCustomProtocolConfigs();
    // 供应商切换后协议默认值与测试模型都应回到该供应商的初始形态。
    if (provider !== previousProvider) {
      createForm.supportedProtocols = defaultProtocolsForProvider(provider);
      createForm.testModel = "";
    }
  },
);

watch(showBulkForm, (visible) => {
  if (!visible) clearBulkSecrets();
});

function onCardDragStart(row: CredentialRow, event: DragEvent) {
  if (!canWrite.value) return;
  draggingId.value = row.id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(row.id));
  }
}

function onCardDragEnd() {
  draggingId.value = null;
  dragOverLane.value = null;
}

function isDragOver(channelId: number, lane: BoardLane): boolean {
  return dragOverLane.value?.channelId === channelId && dragOverLane.value.lane === lane;
}

function onColumnDragOver(channelId: number, column: BoardColumn, event: DragEvent) {
  if (!canWrite.value || draggingId.value == null || !column.droppable) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dragOverLane.value = { channelId, lane: column.lane };
}

function onColumnDragLeave(channelId: number, column: BoardColumn) {
  if (dragOverLane.value?.channelId === channelId && dragOverLane.value.lane === column.lane) {
    dragOverLane.value = null;
  }
}

async function onColumnDrop(column: BoardColumn) {
  const id = draggingId.value;
  draggingId.value = null;
  dragOverLane.value = null;
  if (id == null || !canWrite.value || !column.droppable) return;
  const row = rows.value.find((item) => item.id === id);
  if (!row) return;
  if (boardLaneOf(row) === column.lane) return;
  if (column.lane === "stopped") {
    await setStatus(row, "disabled");
    return;
  }
  if (column.lane === "waiting") await setStatus(row, "active");
}

function getErrorMessage(error: unknown, fallback: string): string {
  const responseMessage = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof responseMessage === "string" ? responseMessage : fallback;
}

function isValidHttpBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/** Allow `10.10.20.241:8078/v1` by prefixing http:// when the scheme is omitted. */
function normalizeHttpBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+(?::\d+)?(?:\/\S*)?$/.test(trimmed)) return `http://${trimmed}`;
  return trimmed;
}

function isValidProtocolConfig(
  config: RelayProtocolConfigs[RelayProtocol],
): config is { baseUrl: string; authStyle: RelayAuthStyle } {
  return Boolean(
    config
      && isValidHttpBaseUrl(normalizeHttpBaseUrl(config.baseUrl))
      && (config.authStyle === "bearer" || config.authStyle === "x-api-key"),
  );
}

function effectiveBaseUrl(row: CredentialRow): string {
  return row.baseUrlOverride || row.defaultBaseUrl;
}

function credentialProtocols(row: CredentialRow): RelayProtocol[] {
  return row.supportedProtocols?.length ? row.supportedProtocols : ["openai_chat"];
}

function channelProtocols(keys: CredentialRow[]): RelayProtocol[] {
  const supported = new Set(keys.flatMap((key) => credentialProtocols(key)));
  return RELAY_PROTOCOLS.filter((protocol) => supported.has(protocol));
}

function channelProtocolConfigs(keys: CredentialRow[]): RelayProtocolConfigs {
  const result: RelayProtocolConfigs = {};
  for (const protocol of RELAY_PROTOCOLS) {
    for (const key of keys) {
      const config = key.protocolConfigs?.[protocol];
      if (!isValidProtocolConfig(config)) continue;
      result[protocol] = { ...config };
      break;
    }
  }
  return result;
}

function lastTest(row: CredentialRow): TestResult | undefined {
  return row.meta?.lastTest;
}

function discoveredModels(row: CredentialRow): string[] {
  return row.meta?.discoveredModels ?? lastTest(row)?.models ?? [];
}

function isCoolingActive(row: CredentialRow): boolean {
  if (!row.coolUntil) return false;
  const until = new Date(row.coolUntil).getTime();
  return !Number.isNaN(until) && until > Date.now();
}

function visibleStatus(row: CredentialRow): CredentialStatus {
  if (row.status === "active" && isCoolingActive(row)) return "cooling";
  // Mirror server-side effectiveCredentialStatus: an expired cooling window
  // means the credential is schedulable again.
  if (row.status === "cooling" && !isCoolingActive(row)) return "active";
  return row.status;
}

function bindingLabel(binding: CredentialBinding | null): string {
  if (!binding) return "待绑定";
  const prefix = binding.scopeType === "employee"
    ? "独占"
    : binding.scopeType === "team"
      ? "团队"
      : "企业";
  return binding.scopeName ? `${prefix}·${binding.scopeName}` : prefix;
}

function bindingTone(binding: CredentialBinding | null): BindingScopeType | "pending" {
  return binding?.scopeType ?? "pending";
}

function formatCreditAmount(value: number): string {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("zh-CN");
}

function formatQuotaPair(used: number, limit: number | null): string {
  const usedText = formatCreditAmount(used);
  return limit == null ? `${usedText} / 不限` : `${usedText} / ${formatCreditAmount(limit)} 积分`;
}

type ParsedCreditLimit =
  | { ok: true; fiveHourCreditLimit: number | null; weeklyCreditLimit: number | null }
  | { ok: false };

function parseOptionalCreditLimit(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function parseQuotaFields(fiveHourRaw: string, weeklyRaw: string): ParsedCreditLimit {
  const fiveHourCreditLimit = parseOptionalCreditLimit(fiveHourRaw);
  const weeklyCreditLimit = parseOptionalCreditLimit(weeklyRaw);
  if (fiveHourCreditLimit === undefined || weeklyCreditLimit === undefined) return { ok: false };
  return { ok: true, fiveHourCreditLimit, weeklyCreditLimit };
}

function syncQuotaEditForm(row: CredentialRow) {
  quotaEditForm.fiveHourCreditLimit = row.fiveHourCreditLimit == null ? "" : String(row.fiveHourCreditLimit);
  quotaEditForm.weeklyCreditLimit = row.weeklyCreditLimit == null ? "" : String(row.weeklyCreditLimit);
}

function statusText(status: CredentialStatus): string {
  return {
    active: "启用",
    disabled: "停用",
    auto_disabled: "自动停用",
    cooling: "冷却中",
  }[status];
}

function statusTagType(status: CredentialStatus): "success" | "info" | "danger" | "warning" {
  return {
    active: "success" as const,
    disabled: "info" as const,
    auto_disabled: "danger" as const,
    cooling: "warning" as const,
  }[status];
}

function setTesting(id: number, testing: boolean) {
  const next = new Set(testingIds.value);
  if (testing) next.add(id);
  else next.delete(id);
  testingIds.value = next;
}

function isTesting(id: number): boolean {
  return testingIds.value.has(id);
}

async function loadCredentials() {
  const { data } = await http.get("/api/admin/credentials");
  if (data.success) {
    rows.value = data.data;
    listedProductLines.value = data.productLines ?? [];
    channelSummaries.value = new Map();
  }
}

async function loadMeta() {
  const templateResponse = await http.get("/api/admin/credential-templates");
  if (templateResponse.data.success) {
    // Only Zhipu/GLM is available for new channels; guard against stale backends.
    templates.value = (templateResponse.data.data as ProviderTemplate[]).filter(
      (template) => template.code === "glm",
    );
  }
}

async function refreshAll() {
  loading.value = true;
  try {
    await Promise.all([loadCredentials(), loadMeta()]);
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "加载上游渠道失败"));
  } finally {
    loading.value = false;
  }
}

function defaultCustomProtocolConfigs(): RelayProtocolConfigs {
  return {
    anthropic_messages: { baseUrl: "", authStyle: "x-api-key" },
    openai_chat: { baseUrl: "", authStyle: "bearer" },
    openai_responses: { baseUrl: "", authStyle: "bearer" },
  };
}

/** 各供应商新建渠道时的协议默认值：glm 官方线路三种全开，其余先只开 openai_chat。 */
function defaultProtocolsForProvider(provider: "glm" | "deepseek" | "haizhi"): RelayProtocol[] {
  return provider === "glm"
    ? ["anthropic_messages", "openai_chat", "openai_responses"]
    : ["openai_chat"];
}

function emptyChannelFromProductLine(line: ListedProductLine): ChannelGroup {
  const configs = line.protocolConfigs ?? {};
  const protocols = RELAY_PROTOCOLS.filter((protocol) => isValidProtocolConfig(configs[protocol]));
  return {
    id: line.id,
    providerCode: line.providerCode,
    providerName: line.providerName,
    providerStatus: line.providerStatus,
    productLineCode: line.code,
    productLineName: line.name || line.code,
    productLineStatus: line.status,
    productType: line.productType,
    protocolConfigs: configs,
    configVersion: line.configVersion ?? 1,
    baseUrl: line.baseUrl,
    protocols,
    keys: [],
    totalCount: 0,
    schedulableCount: 0,
    coolingCount: 0,
    unschedulableCount: 0,
    recentSuccessCount: 0,
    recentErrorCount: 0,
    seatCount: line.seatCount ?? 0,
    tag: line.tag ?? "",
    testModel: line.testModel ?? null,
  };
}

function clearBulkSecrets() {
  bulkForm.rawKeys = "";
}

function preferredProtocol(row: CredentialRow): RelayProtocol {
  const supported = credentialProtocols(row);
  if (supported.includes("openai_chat")) return "openai_chat";
  const previous = lastTest(row)?.protocol;
  if (previous && supported.includes(previous)) return previous;
  return supported[0] ?? "openai_chat";
}

async function requestCredentialTest(row: CredentialRow, protocol?: RelayProtocol): Promise<TestResult> {
  const resolved = protocol && credentialProtocols(row).includes(protocol)
    ? protocol
    : preferredProtocol(row);
  const { data } = await http.post(`/api/admin/credentials/${row.id}/test`, { protocol: resolved });
  return data.data as TestResult;
}

async function testCredential(row: CredentialRow, protocol?: RelayProtocol) {
  if (!canWrite.value || isTesting(row.id)) return;
  setTesting(row.id, true);
  try {
    const result = await requestCredentialTest(row, protocol);
    result.ok ? ElMessage.success(result.message) : ElMessage.warning(result.message);
    await loadCredentials();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "测试失败"));
  } finally {
    setTesting(row.id, false);
  }
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

async function batchTestCredentials() {
  const targets = [...boardVisibleRows.value];
  if (!canWrite.value || !targets.length || batchTesting.value) return;
  batchTesting.value = true;
  batchTestProgress.done = 0;
  batchTestProgress.total = targets.length;
  let successCount = 0;
  let failedCount = 0;

  try {
    await runWithConcurrency(targets, 3, async (row) => {
      setTesting(row.id, true);
      try {
        const result = await requestCredentialTest(row);
        if (result.ok) successCount += 1;
        else failedCount += 1;
      } catch {
        failedCount += 1;
      } finally {
        setTesting(row.id, false);
        batchTestProgress.done += 1;
      }
    });
    await loadCredentials();
    if (failedCount) {
      ElMessage.warning(`批量测试完成：${successCount} 个正常，${failedCount} 个失败`);
    } else {
      ElMessage.success(`批量测试完成：${successCount} 个 Key 均正常`);
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "刷新批量测试结果失败"));
  } finally {
    batchTesting.value = false;
  }
}

async function setStatus(row: CredentialRow, status: "active" | "disabled") {
  if (!canWrite.value) return;
  try {
    await http.patch(`/api/admin/credentials/${row.id}`, { status });
    ElMessage.success(status === "active" ? "Key 已启用" : "Key 已停用");
    await loadCredentials();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "状态更新失败"));
  }
}

async function saveQuotaLimits() {
  const row = detailRow.value;
  if (!canWrite.value || !row) return;
  const quotas = parseQuotaFields(quotaEditForm.fiveHourCreditLimit, quotaEditForm.weeklyCreditLimit);
  if (!quotas.ok) {
    ElMessage.warning("额度须为非负数，允许小数，留空表示不限");
    return;
  }
  quotaSaving.value = true;
  try {
    await http.patch(`/api/admin/credentials/${row.id}`, {
      fiveHourCreditLimit: quotas.fiveHourCreditLimit,
      weeklyCreditLimit: quotas.weeklyCreditLimit,
    });
    ElMessage.success("额度已更新");
    await loadCredentials();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "额度更新失败"));
  } finally {
    quotaSaving.value = false;
  }
}

function openKeyDetails(row: CredentialRow) {
  detailCredentialId.value = row.id;
  syncQuotaEditForm(row);
  showKeyDetails.value = true;
}

function closeKeyDetails() {
  detailCredentialId.value = null;
}

onMounted(refreshAll);
</script>

<style scoped>
.keys-board-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: #f1f5f9;
}
.keys-board-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}
.keys-board-toolbar-count {
  margin-right: auto;
  color: #64748b;
  font-size: 12px;
}
.keys-board-search {
  width: 200px;
}
.keys-board-stack {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}
.keys-lane-grid {
  display: grid;
  flex: 1;
  align-items: stretch;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
  min-width: 0;
  min-height: 0;
  padding: 8px;
  background: #fff;
}
.keys-lane-grid > .kanban-column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: auto;
  overflow: hidden;
}
.keys-lane-grid .kanban-column-head {
  flex-shrink: 0;
}
.keys-lane-grid .kanban-cards.is-rings {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-content: start;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  padding: 10px 8px 16px;
  overflow-x: hidden;
  overflow-y: auto;
}
.keys-lane-grid .kanban-empty {
  grid-column: 1 / -1;
}
.keys-lane-grid .key-ring {
  width: auto;
  min-width: 0;
  max-width: 100%;
}
.keys-lane-grid .key-ring-svg {
  width: 100%;
  max-width: 56px;
  height: auto;
  aspect-ratio: 1;
}
.key-ring {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 72px;
  margin: 0;
  padding: 8px 4px 6px;
  border: 0;
  border-radius: 18px;
  background: #111827;
  color: #e2e8f0;
  cursor: pointer;
  appearance: none;
}
.key-ring.dragging,
.key-ring.is-testing {
  opacity: 0.55;
}
.key-ring-svg {
  display: block;
  width: 56px;
  height: 56px;
}
.key-ring-track {
  fill: none;
  stroke: #1e293b;
  stroke-width: 7;
}
.key-ring-track.inner {
  stroke-width: 5.5;
}
.key-ring-progress {
  fill: none;
  stroke-width: 7;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 36px 36px;
}
.key-ring-progress.inner {
  stroke-width: 5.5;
}
.key-ring-pct {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 12px;
  color: #cbd5e1;
  font-size: 11px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.detail-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.kanban-column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  border: 1px dashed transparent;
  border-radius: 10px;
  background: #f8fafc;
  overflow: hidden;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.kanban-column.droppable {
  border-color: #cbd5e1;
}
.kanban-column.drag-over {
  border-color: #3b82f6;
  background: #eff6ff;
}
.kanban-column-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #eef2f7;
  font-size: 12px;
  font-weight: 650;
}
.estimate-mark { color: #94a3b8; font-size: 12px; }
.kanban-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #475467;
  font-size: 11px;
}
.kanban-cards {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 10px 10px 24px;
  overflow-x: hidden;
  overflow-y: auto;
}
.kanban-empty {
  margin: auto;
  color: #cbd5e1;
  font-size: 12px;
}
.latency-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid #bfdbfe;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: latency-spin 0.7s linear infinite;
}
@keyframes latency-spin {to { transform: rotate(360deg); }
}
.binding-badge {
  align-self: flex-start;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  line-height: 1.4;
  white-space: nowrap;
}
.binding-badge.pending {
  background: #fffbeb;
  color: #a16207;
}
.binding-badge.employee {
  background: #fee2e2;
  color: #b91c1c;
}
.binding-badge.team {
  background: #cffafe;
  color: #0e7490;
}
.binding-badge.enterprise {
  background: #e0e7ff;
  color: #4338ca;
}
.quota-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.quota-edit-form {
  margin-top: 12px;
}
.quota-progress {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  color: #64748b;
  font-size: 12px;
}
.secret-mask {
  flex: 0 0 auto;
  color: #94a3b8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  letter-spacing: 0.03em;
}
.secret-mask.inline {
  color: #64748b;
}
.model-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.credential-form {
  margin-top: 4px;
}
@media (max-width: 560px) {
}
.form-help {
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}
.drawer-head {
  padding-bottom: 16px;
  border-bottom: 1px solid #e5e7eb;
}
.drawer-head p {
  margin: 5px 0 0;
  color: #64748b;
  font-size: 12px;
}
.drawer-sections {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 16px;
}
.detail-section {
  padding: 14px 16px;
  border: 1px solid #eef2f7;
  border-radius: 10px;
  background: #f8fafc;
}
.section-heading {
  margin: 0 0 12px;
  color: #334155;
  font-size: 13px;
  font-weight: 650;
}
.section-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.section-heading-row .section-heading {
  margin: 0;
}
.test-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.info-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  margin: 0;
}
.info-item {
  min-width: 0;
}
.info-item.full {
  grid-column: 1 / -1;
}
.info-item dt {
  margin-bottom: 4px;
  color: #94a3b8;
  font-size: 12px;
}
.info-item dd {
  margin: 0;
  color: #0f172a;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}
.models-block {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
}
.current-error-block {
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid #fecaca;
  border-radius: 8px;
  background: #fef2f2;
}
.current-error-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.current-error-head strong {
  color: #b91c1c;
  font-size: 12px;
}
.current-error-head span {
  color: #ef4444;
  font-size: 11px;
}
.current-error-block p {
  margin: 6px 0 0;
  color: #991b1b;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.models-heading {
  margin-bottom: 10px;
  color: #334155;
  font-size: 12px;
  font-weight: 600;
}
.model-tags {
  max-height: 180px;
  overflow: auto;
}
.empty-hint {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.55;
}
.error-text {
  color: #b91c1c !important;
}
@media (max-width: 1200px) {
}
@media (max-width: 900px) {
}
@media (max-width: 720px) {.keys-lane-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}
</style>
