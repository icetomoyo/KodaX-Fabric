<template>
  <div class="page-card logs-page">
    <h2 class="page-title">调用日志</h2>

    <el-form :inline="true" size="small" class="filters" @keyup.enter="search">
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
        <div class="metric-filter">
          <span class="metric-filter-label">耗时</span>
          <el-select v-model="filters.latencyOp" style="width: 76px">
            <el-option label="大于" value="gt" />
            <el-option label="小于" value="lt" />
          </el-select>
          <el-input
            v-model="filters.latencyMs"
            clearable
            placeholder="ms"
            style="width: 92px"
          />
        </div>
      </el-form-item>
      <el-form-item>
        <div class="metric-filter">
          <span class="metric-filter-label">Tokens</span>
          <el-select v-model="filters.tokensOp" style="width: 76px">
            <el-option label="大于" value="gt" />
            <el-option label="小于" value="lt" />
          </el-select>
          <el-input
            v-model="filters.tokens"
            clearable
            placeholder="数值"
            style="width: 92px"
          />
        </div>
      </el-form-item>
      <el-form-item>
        <div class="metric-filter">
          <span class="metric-filter-label">TTFT</span>
          <el-select v-model="filters.ttftOp" style="width: 76px">
            <el-option label="大于" value="gt" />
            <el-option label="小于" value="lt" />
          </el-select>
          <el-input
            v-model="filters.ttftMs"
            clearable
            placeholder="ms"
            style="width: 92px"
          />
        </div>
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
      size="small"
      class="logs-table"
      empty-text="暂无日志"
      v-loading="loading"
    >
      <el-table-column label="Request ID" min-width="300">
        <template #default="{ row }">
          <el-button class="request-id-button" link @click="copyRequestId(row.requestId)">
            {{ row.requestId }}
          </el-button>
        </template>
      </el-table-column>
      <el-table-column label="耗时" width="68" align="right" header-align="right">
        <template #default="{ row }">
          <span class="metric-text">{{ formatLatency(row.latencyMs) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="Tokens" width="76" align="right" header-align="right">
        <template #default="{ row }">
          <span class="metric-text">{{ formatNumber(row.totalTokens) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="TTFT" width="64" align="right" header-align="right">
        <template #default="{ row }">
          <span class="metric-text">{{ formatLatency(row.ttftMs) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="缓存命中" width="86" align="right" header-align="right">
        <template #default="{ row }">
          <el-tooltip
            :disabled="row.cacheReadTokens == null"
            :content="cacheHitText(row.cacheReadTokens, row.promptTokens)"
            placement="top"
            :show-after="300"
          >
            <span class="metric-text">{{ formatNumber(row.cacheReadTokens) }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="渠道" width="148">
        <template #default="{ row }">
          <el-tooltip :content="channelTooltip(row)" placement="top" :show-after="400">
            <span class="channel-cell">
              <span class="channel-name">{{ providerText(row.providerCode) }}</span>
              <span v-if="row.productType === 'coding_plan'" class="type-chip">套餐</span>
              <span v-if="row.credentialSuffix" class="key-suffix">{{ row.credentialSuffix }}</span>
            </span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="模型" width="120">
        <template #default="{ row }">
          <el-tooltip :content="modelTooltip(row)" placement="top" :show-after="400">
            <span class="model-text">{{ row.clientModel }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="协议" width="136">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">
            {{ relayProtocolLabel(row.protocol, true) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="112">
        <template #default="{ row }">
          <el-tooltip
            :disabled="!hasErrorDetail(row)"
            :content="errorTooltip(row)"
            placement="top"
            :show-after="300"
          >
            <span class="result-cell">
              <span class="status-pill" :class="`is-${row.status}`">
                <i class="status-dot" />
                {{ statusText(row.status) }}
              </span>
              <span v-if="row.httpStatus" class="http-status">{{ row.httpStatus }}</span>
            </span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="企业 / 团队" min-width="160">
        <template #default="{ row }">
          <span class="employee-text">
            {{ row.enterpriseName || "—" }}
            <template v-if="row.teamName"> · {{ row.teamName }}</template>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="156">
        <template #default="{ row }">
          <span class="time-text">{{ formatDateTime(row.createdAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="60">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row.requestId)">查看</el-button>
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

    <el-drawer v-model="drawer" title="调用详情" size="min(820px, 96vw)">
      <div v-loading="detailLoading" class="log-detail-body">
        <template v-if="detail">
          <div class="detail-heading">
            <div>
              <span class="detail-request-id">{{ detail.meta.requestId }}</span>
              <el-button link type="primary" @click="copyRequestId(detail.meta.requestId)">复制</el-button>
            </div>
            <el-tag v-if="context?.truncated" type="warning">内容已截断</el-tag>
          </div>

          <el-tabs v-model="activeDetailTab" class="context-tabs">
            <el-tab-pane label="用户提示词" name="prompt">
              <div v-loading="contextLoading" class="tab-content">
                <div class="tab-toolbar">
                  <span>按原始顺序展示消息与多模态块</span>
                  <el-button link type="primary" @click="copyStructured(context?.tabs.userPrompt)">复制本页</el-button>
                </div>
                <el-empty
                  v-if="!context?.tabs.userPrompt.messages.length"
                  description="该记录没有可识别的用户提示词"
                  :image-size="70"
                />
                <div v-else class="message-list">
                  <article
                    v-for="(message, index) in context.tabs.userPrompt.messages"
                    :key="index"
                    class="message-card"
                  >
                    <el-tag size="small" effect="plain">{{ messageRole(message) }}</el-tag>
                    <StructuredJson :value="messageContent(message)" empty-text="消息内容为空" />
                  </article>
                </div>
                <el-collapse
                  v-if="context?.tabs.userPrompt.raw != null"
                  v-model="rawPanels"
                  class="raw-collapse"
                >
                  <el-collapse-item title="展开请求原始 JSON" name="request-raw">
                    <StructuredJson
                      v-if="rawPanels.includes('request-raw')"
                      :value="context.tabs.userPrompt.raw"
                    />
                  </el-collapse-item>
                </el-collapse>
              </div>
            </el-tab-pane>

            <el-tab-pane label="返回信息" name="response">
              <div v-loading="contextLoading" class="tab-content">
                <div class="tab-toolbar">
                  <span>保留上游响应的结构化内容</span>
                  <el-button link type="primary" @click="copyStructured(context?.tabs.response)">复制本页</el-button>
                </div>
                <StructuredJson
                  :value="context?.tabs.response.content ?? []"
                  empty-text="该记录没有可识别的返回内容"
                />
                <el-collapse
                  v-if="context?.tabs.response.raw != null"
                  v-model="rawPanels"
                  class="raw-collapse"
                >
                  <el-collapse-item title="展开响应原始 JSON" name="response-raw">
                    <StructuredJson
                      v-if="rawPanels.includes('response-raw')"
                      :value="context.tabs.response.raw"
                    />
                  </el-collapse-item>
                </el-collapse>
              </div>
            </el-tab-pane>

            <el-tab-pane label="Skill / 工具" name="skills">
              <div v-loading="contextLoading" class="tab-content">
                <div class="tab-toolbar">
                  <span>本次调用实际发起的工具请求</span>
                  <el-button link type="primary" @click="copyStructured(context?.tabs.skills)">复制本页</el-button>
                </div>
                <el-empty v-if="!hasSkillContext" description="该记录没有 Skill 或工具信息" :image-size="70" />
                <template v-else>
                  <section v-if="context?.tabs.skills.tools.length" class="context-section">
                    <h4>工具定义</h4>
                    <StructuredJson :value="context.tabs.skills.tools" />
                  </section>
                  <section v-if="context?.tabs.skills.toolCalls.length" class="context-section">
                    <h4>工具调用</h4>
                    <StructuredJson :value="context.tabs.skills.toolCalls" />
                  </section>
                  <section v-if="context?.tabs.skills.skills.length" class="context-section">
                    <h4>Skills</h4>
                    <StructuredJson :value="context.tabs.skills.skills" />
                  </section>
                </template>
              </div>
            </el-tab-pane>

            <el-tab-pane label="元数据" name="metadata">
              <div class="tab-content">
                <el-descriptions :column="1" border size="small" class="detail-descriptions">
                  <el-descriptions-item label="时间">{{ formatDateTime(detail.meta.createdAt) }}</el-descriptions-item>
                  <el-descriptions-item label="企业 / 团队">
                    {{ detail.meta.enterpriseName || "—" }}
                    <template v-if="detail.meta.teamName"> · {{ detail.meta.teamName }}</template>
                  </el-descriptions-item>
                  <el-descriptions-item label="协议">{{ relayProtocolLabel(detail.meta.protocol) }}</el-descriptions-item>
                  <el-descriptions-item label="模型">{{ modelTooltip(detail.meta) }}</el-descriptions-item>
                  <el-descriptions-item label="渠道">
                    {{ providerText(detail.meta.providerCode) }} · {{ productTypeText(detail.meta.productType) }} · Key {{ detail.meta.credentialSuffix || "—" }}
                  </el-descriptions-item>
                  <el-descriptions-item label="状态">
                    <span class="result-cell">
                      <span class="status-pill" :class="`is-${detail.meta.status}`"><i class="status-dot" />{{ statusText(detail.meta.status) }}</span>
                      <span v-if="detail.meta.httpStatus" class="http-status">HTTP {{ detail.meta.httpStatus }}</span>
                    </span>
                  </el-descriptions-item>
                  <el-descriptions-item label="Tokens">
                    {{ formatNumber(detail.meta.promptTokens) }} + {{ formatNumber(detail.meta.completionTokens) }} = {{ formatNumber(detail.meta.totalTokens) }}
                  </el-descriptions-item>
                  <el-descriptions-item label="缓存命中">
                    {{ cacheHitText(cacheReadTokensOf(detail.meta.usageRaw), detail.meta.promptTokens) }}
                  </el-descriptions-item>
                  <el-descriptions-item label="耗时">
                    {{ formatLatency(detail.meta.latencyMs) }} · {{ detail.meta.isStream ? "流式" : "非流式" }} · 重试 {{ detail.meta.retryCount ?? 0 }} 次
                  </el-descriptions-item>
                  <el-descriptions-item label="TTFT">{{ formatLatency(detail.meta.ttftMs) }}</el-descriptions-item>
                  <el-descriptions-item label="生成耗时">{{ formatLatency(detail.meta.generationMs) }}</el-descriptions-item>
                  <el-descriptions-item label="客户端">
                    {{ detail.meta.clientIp || "—" }}
                    <span v-if="detail.meta.userAgent" class="client-ua">{{ detail.meta.userAgent }}</span>
                  </el-descriptions-item>
                  <el-descriptions-item v-if="detail.meta.errorCode || detail.meta.errorMessage" label="错误">
                    {{ detail.meta.errorCode }} {{ detail.meta.errorMessage }}
                  </el-descriptions-item>
                  <el-descriptions-item v-if="detail.meta.retryTrace?.length" label="重试轨迹">
                    <div class="retry-trace">
                      <div v-for="item in detail.meta.retryTrace" :key="item.attempt" class="retry-trace-item">
                        #{{ item.attempt }} {{ providerText(item.providerCode ?? null) }}
                        <span v-if="item.credentialSuffix" class="key-suffix">{{ item.credentialSuffix }}</span>
                        · HTTP {{ item.status ?? "—" }} · {{ item.outcome }} · {{ formatLatency(item.latencyMs) }}
                      </div>
                    </div>
                  </el-descriptions-item>
                  <template v-if="context">
                    <el-descriptions-item label="请求正文大小">{{ formatBytes(context.tabs.metadata.requestBodySize) }}</el-descriptions-item>
                    <el-descriptions-item label="响应正文大小">{{ formatBytes(context.tabs.metadata.responseBodySize) }}</el-descriptions-item>
                  </template>
                </el-descriptions>
              </div>
            </el-tab-pane>
          </el-tabs>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import StructuredJson from "@/components/StructuredJson.vue";
import { copyText } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/date-time";
import { relayProtocolLabel, type RelayProtocol } from "@/views/relay-protocol";

type LogStatus = "success" | "upstream_error" | "client_error" | "cancelled";
type ProductType = "api" | "coding_plan";

interface LogRow {
  id: number;
  requestId: string;
  enterpriseName: string | null;
  teamName: string | null;
  protocol: RelayProtocol;
  clientModel: string;
  upstreamModel: string | null;
  providerCode: string | null;
  productType: ProductType | null;
  credentialSuffix: string | null;
  isStream: boolean;
  status: LogStatus;
  httpStatus: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  ttftMs: number | null;
  generationMs: number | null;
  cacheReadTokens: number | null;
  retryCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface RetryTraceItem {
  attempt: number;
  outcome: string;
  status?: number;
  latencyMs?: number;
  providerCode?: string;
  credentialSuffix?: string;
}

interface LogDetailMeta extends Omit<LogRow, "cacheReadTokens"> {
  upstreamStatus: number | null;
  usageRaw: Record<string, unknown> | null;
  retryTrace: RetryTraceItem[] | null;
  clientIp: string | null;
  userAgent: string | null;
  requestPath: string | null;
}

interface LogDetail {
  meta: LogDetailMeta;
}

interface NamedOption {
  id: number;
  name: string;
}

interface AuditContext {
  requestId: string;
  truncated: boolean;
  tabs: {
    userPrompt: { messages: unknown[]; raw: unknown };
    response: { content: unknown[]; raw: unknown };
    skills: { tools: unknown[]; toolCalls: unknown[]; skills: unknown[] };
    metadata: {
      protocol: RelayProtocol;
      clientModel: string;
      upstreamModel: string | null;
      requestBodySize: number;
      responseBodySize: number;
    };
  };
}

const providerNames: Record<string, string> = {
  glm: "智谱/GLM",
  kimi: "月之暗面/Kimi",
  deepseek: "深度求索/DeepSeek",
  minimax: "MiniMax",
};

const numberFormatter = new Intl.NumberFormat("zh-CN");
type CompareOp = "gt" | "lt";

const filters = reactive({
  enterpriseId: undefined as number | undefined,
  teamId: undefined as number | undefined,
  tokensOp: "gt" as CompareOp,
  tokens: "",
  latencyOp: "gt" as CompareOp,
  latencyMs: "",
  ttftOp: "gt" as CompareOp,
  ttftMs: "",
});
const enterprises = ref<NamedOption[]>([]);
const enterprisesLoading = ref(false);
const teams = ref<NamedOption[]>([]);
const teamsLoading = ref(false);
const items = ref<LogRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 10;
const loading = ref(false);
const drawer = ref(false);
const detail = ref<LogDetail | null>(null);
const context = ref<AuditContext | null>(null);
const detailLoading = ref(false);
const contextLoading = ref(false);
const activeDetailTab = ref("metadata");
const rawPanels = ref<string[]>([]);
let detailSequence = 0;

const hasFilters = computed(() => Boolean(
  filters.enterpriseId
  || filters.teamId
  || filters.tokens.trim()
  || filters.latencyMs.trim()
  || filters.ttftMs.trim(),
));

function parseFilterNumber(raw: string): number | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

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

function providerText(code: string | null): string {
  if (!code) return "—";
  return providerNames[code.toLowerCase()] ?? code;
}

function productTypeText(type: ProductType | null): string {
  if (!type) return "—";
  return type === "coding_plan" ? "Coding Plan" : "API";
}

function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : numberFormatter.format(value);
}

function formatLatency(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value < 1000) return `${value} ms`;
  const seconds = value / 1000;
  return `${Number(seconds.toFixed(seconds < 10 ? 2 : 1))} s`;
}

function asTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cacheReadTokensOf(usageRaw: Record<string, unknown> | null): number | null {
  if (!usageRaw) return null;
  const anthropic = asTokenCount(usageRaw.cache_read_input_tokens);
  if (anthropic != null) return anthropic;
  const details = usageRaw.prompt_tokens_details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    return asTokenCount((details as Record<string, unknown>).cached_tokens);
  }
  return null;
}

function cacheHitText(cacheRead: number | null, promptTokens: number | null): string {
  if (cacheRead == null) return "—";
  // promptTokens already includes cached input, so the ratio stays within 0-100%.
  if (!promptTokens || cacheRead <= 0) return formatNumber(cacheRead);
  const percent = Math.min(100, (cacheRead / promptTokens) * 100);
  return `${formatNumber(cacheRead)} (${percent.toFixed(1)}%)`;
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

function modelTooltip(row: Pick<LogRow, "clientModel" | "upstreamModel">): string {
  if (row.upstreamModel && row.upstreamModel !== row.clientModel) {
    return `${row.clientModel} → ${row.upstreamModel}`;
  }
  return row.clientModel || "—";
}

function channelTooltip(row: LogRow): string {
  const parts = [providerText(row.providerCode), productTypeText(row.productType)];
  if (row.credentialSuffix) parts.push(`Key ····${row.credentialSuffix}`);
  return parts.join(" · ");
}

function hasErrorDetail(row: LogRow): boolean {
  return Boolean(row.errorCode || row.errorMessage);
}

function errorTooltip(row: LogRow): string {
  return [row.errorCode, row.errorMessage].filter(Boolean).join(" · ");
}

async function copyRequestId(requestId: string) {
  const copied = await copyText(requestId);
  if (copied) ElMessage.success("Request ID 已复制");
  else ElMessage.error("复制失败");
}

function messageRole(message: unknown): string {
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const role = (message as Record<string, unknown>).role;
    if (typeof role === "string" && role) return role;
  }
  return "message";
}

function messageContent(message: unknown): unknown {
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const record = message as Record<string, unknown>;
    return record.content ?? record;
  }
  return message;
}

function formatBytes(value: number): string {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function copyStructured(value: unknown) {
  const copied = await copyText(JSON.stringify(value ?? null, null, 2));
  if (copied) ElMessage.success("结构化数据已复制");
  else ElMessage.error("复制失败");
}

const hasSkillContext = computed(() => Boolean(
  context.value && (
    context.value.tabs.skills.tools.length
    || context.value.tabs.skills.toolCalls.length
    || context.value.tabs.skills.skills.length
  ),
));

async function load() {
  const tokens = parseFilterNumber(filters.tokens);
  const latencyMs = parseFilterNumber(filters.latencyMs);
  const ttftMs = parseFilterNumber(filters.ttftMs);
  if (
    (filters.tokens.trim() && tokens == null)
    || (filters.latencyMs.trim() && latencyMs == null)
    || (filters.ttftMs.trim() && ttftMs == null)
  ) {
    ElMessage.warning("Tokens / 耗时 / TTFT 请输入非负整数");
    return;
  }

  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/logs", {
      params: {
        limit,
        offset: (page.value - 1) * limit,
        enterpriseId: filters.enterpriseId,
        teamId: filters.teamId,
        ...(tokens != null ? { tokensOp: filters.tokensOp, tokens } : {}),
        ...(latencyMs != null ? { latencyOp: filters.latencyOp, latencyMs } : {}),
        ...(ttftMs != null ? { ttftOp: filters.ttftOp, ttftMs } : {}),
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
  filters.enterpriseId = undefined;
  filters.teamId = undefined;
  teams.value = [];
  filters.tokensOp = "gt";
  filters.tokens = "";
  filters.latencyOp = "gt";
  filters.latencyMs = "";
  filters.ttftOp = "gt";
  filters.ttftMs = "";
  page.value = 1;
  load();
}

async function openDetail(requestId: string) {
  const sequence = ++detailSequence;
  detail.value = null;
  context.value = null;
  rawPanels.value = [];
  activeDetailTab.value = "prompt";
  drawer.value = true;
  detailLoading.value = true;
  contextLoading.value = true;
  try {
    const metadataPromise = http.get(`/api/admin/logs/${requestId}`);
    const contextPromise = http.get(`/api/admin/logs/${requestId}/context`);
    const [metadataResult, contextResult] = await Promise.allSettled([
      metadataPromise,
      contextPromise,
    ]);
    if (sequence !== detailSequence) return;
    if (metadataResult.status === "rejected") throw metadataResult.reason;
    if (metadataResult.value.data.success) detail.value = metadataResult.value.data.data;
    if (contextResult.status === "fulfilled" && contextResult.value?.data.success) {
      context.value = contextResult.value.data.data;
    } else if (contextResult.status === "rejected") {
      ElMessage.error(contextResult.reason?.response?.data?.message || "结构化上下文加载失败");
    }
  } catch (e: any) {
    if (sequence === detailSequence) {
      ElMessage.error(e.response?.data?.message || "调用详情加载失败");
    }
  } finally {
    if (sequence === detailSequence) {
      detailLoading.value = false;
      contextLoading.value = false;
    }
  }
}

onMounted(() => {
  void load();
  void loadEnterprises();
});
</script>

<style scoped>
.logs-page {
  padding: 16px 20px 14px;
  border: 1px solid #e9edf3;
  overflow-x: auto;
}
.logs-page .page-title {
  margin-bottom: 12px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.metric-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.metric-filter-label {
  color: #667085;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.filters :deep(.el-form-item) {
  flex: none;
  margin-right: 0;
  margin-bottom: 0;
}
.filters :deep(.el-input__wrapper),
.filters :deep(.el-select__wrapper) {
  border-radius: 6px;
}
.logs-table {
  --el-table-border-color: #edf0f5;
  --el-table-header-bg-color: #f8fafc;
  --el-table-row-hover-bg-color: #f3f7fc;
  width: 100%;
  color: #344054;
}
.logs-table :deep(.cell) {
  padding: 0 8px;
  white-space: nowrap;
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
.logs-table :deep(.el-table__row--striped td.el-table__cell) {
  background: #fafbfc;
}
.logs-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}
.time-text,
.metric-text,
.http-status,
.request-id-button,
.detail-request-id {
  font-variant-numeric: tabular-nums;
}
.time-text {
  color: #475467;
}
.employee-text {
  display: block;
  overflow: hidden;
  color: #344054;
  font-weight: 500;
  text-overflow: ellipsis;
}
.model-text {
  display: block;
  overflow: hidden;
  color: #344054;
  text-overflow: ellipsis;
}
.channel-cell,
.result-cell {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
}
.channel-cell {
  gap: 4px;
}
.channel-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.key-suffix {
  flex: none;
  color: #98a2b3;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}
.type-chip {
  flex: none;
  padding: 0 5px;
  border-radius: 4px;
  background: #eef4ff;
  color: #3538cd;
  font-size: 11px;
  line-height: 18px;
}
.result-cell {
  gap: 6px;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.status-pill.is-success {
  background: #ecfdf3;
  color: #027a48;
}
.status-pill.is-upstream_error {
  background: #fef3f2;
  color: #b42318;
}
.status-pill.is-client_error {
  background: #fffaeb;
  color: #b54708;
}
.status-pill.is-cancelled {
  background: #f2f4f7;
  color: #475467;
}
.http-status {
  color: #98a2b3;
  font-size: 11px;
}
.metric-text {
  color: #344054;
}
.request-id-button {
  height: auto;
  padding: 0;
  color: #667085;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}
.request-id-button:hover {
  color: var(--el-color-primary);
}
.pager {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
.detail-request-id {
  margin-right: 8px;
  overflow-wrap: anywhere;
  color: #475467;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
.detail-descriptions :deep(.el-descriptions__label) {
  width: 92px;
  color: #667085;
}
.log-detail-body {
  min-height: 260px;
}
.detail-heading,
.tab-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.detail-heading {
  min-height: 30px;
  margin-bottom: 10px;
}
.context-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}
.tab-content {
  min-height: 260px;
}
.tab-toolbar {
  margin-bottom: 10px;
  color: #667085;
  font-size: 12px;
}
.message-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.message-card {
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 9px;
  background: #f8fafc;
}
.message-card > :deep(.el-tag) {
  margin-bottom: 6px;
}
.raw-collapse {
  margin-top: 14px;
}
.context-section + .context-section {
  margin-top: 16px;
}
.context-section h4 {
  margin: 0 0 6px;
  color: #344054;
  font-size: 13px;
}
.metadata-notice {
  margin-bottom: 12px;
}
.client-ua {
  display: block;
  overflow-wrap: anywhere;
  color: #98a2b3;
  font-size: 11px;
  white-space: normal;
}
.retry-trace {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.retry-trace-item {
  font-variant-numeric: tabular-nums;
  white-space: normal;
}
</style>
