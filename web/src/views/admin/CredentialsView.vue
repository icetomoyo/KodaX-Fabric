<template>
  <div class="credentials-page">
    <section class="page-card credentials-shell">
      <div class="page-head">
        <div>
          <h2 class="page-title">上游渠道</h2>
          <p class="page-subtitle">按渠道集中管理多个 API Key，并独立观察每个 Key 的状态与健康度</p>
        </div>
        <div class="head-actions">
          <el-button :loading="loading" @click="refreshAll">刷新</el-button>
          <el-button v-if="canWrite" type="primary" @click="openCreateChannel">
            新增渠道
          </el-button>
        </div>
      </div>

      <div v-loading="loading" class="split-layout">
        <aside class="channel-list-pane">
          <div class="pane-label">
            <span>渠道列表</span>
            <span class="pane-count">{{ channels.length }}</span>
          </div>

          <el-empty
            v-if="!loading && !channels.length"
            description="暂无上游渠道"
            :image-size="72"
          >
            <el-button v-if="canWrite" type="primary" @click="openCreateChannel">
              新增渠道
            </el-button>
          </el-empty>

          <div v-else class="channel-list">
            <button
              v-for="channel in channels"
              :key="channel.id"
              type="button"
              class="channel-card"
              :class="{ selected: selectedProductLineId === channel.id }"
              @click="selectChannel(channel.id)"
            >
              <div class="channel-card-top">
                <span class="provider-logo sm" :style="providerLogoStyle(channel.providerCode)">
                  {{ providerShortName(channel.providerCode) }}
                </span>
                <div class="channel-card-copy">
                  <strong class="channel-card-title">{{ channel.productLineName }}</strong>
                  <span class="channel-card-meta">{{ channel.providerName }}</span>
                </div>
                <el-tag :type="channelAvailabilityType(channel)" size="small" effect="light">
                  {{ channel.schedulableCount }}/{{ channel.totalCount }} 可调度
                </el-tag>
              </div>
              <div class="channel-card-bottom">
                <span class="channel-code">{{ channel.productLineCode }}</span>
                <span>{{ channel.totalCount }} 个 Key</span>
              </div>
            </button>
          </div>
        </aside>

        <main class="channel-detail-pane">
          <template v-if="selectedChannel">
            <div class="detail-header">
              <div class="detail-identity">
                <span class="provider-logo" :style="providerLogoStyle(selectedChannel.providerCode)">
                  {{ providerShortName(selectedChannel.providerCode) }}
                </span>
                <div class="detail-copy">
                  <div class="detail-title-row">
                    <h3 class="detail-title">{{ selectedChannel.productLineName }}</h3>
                    <el-tag effect="plain" size="small">{{ selectedChannel.providerName }}</el-tag>
                  </div>
                  <div class="detail-subtitle mono wrap">{{ selectedChannel.baseUrl }}</div>
                  <div class="channel-protocols">
                    <span>渠道协议</span>
                    <el-tag
                      v-for="protocol in selectedChannel.protocols"
                      :key="protocol"
                      size="small"
                      effect="plain"
                    >
                      {{ relayProtocolLabel(protocol, true) }}
                    </el-tag>
                  </div>
                </div>
              </div>
              <div class="detail-actions">
                <el-tag v-if="!canWrite" type="info" effect="plain" size="small">只读查看</el-tag>
                <el-button v-else type="primary" @click="openAddKeys(selectedChannel)">
                  添加 Key
                </el-button>
              </div>
            </div>

            <div class="channel-overview">
              <div class="overview-card">
                <span>Key 总数</span>
                <strong>{{ selectedChannel.totalCount }}</strong>
              </div>
              <div class="overview-card success">
                <span>可调度</span>
                <strong>{{ selectedChannel.schedulableCount }}</strong>
              </div>
              <div class="overview-card warning">
                <span>冷却中</span>
                <strong>{{ selectedChannel.coolingCount }}</strong>
              </div>
              <div class="overview-card danger">
                <span>不可调度</span>
                <strong>{{ selectedChannel.unschedulableCount }}</strong>
              </div>
              <div class="overview-card wide">
                <span>近 24h 调用</span>
                <strong>
                  {{ selectedChannel.recentSuccessCount + selectedChannel.recentErrorCount }}
                  <small>成功 {{ selectedChannel.recentSuccessCount }} / 失败 {{ selectedChannel.recentErrorCount }}</small>
                </strong>
              </div>
            </div>

            <section class="key-pool-section">
              <div class="key-pool-head">
                <div>
                  <h4>Key 列表</h4>
                  <p>协议由渠道统一管理；每个 Key 独立参与调度、冷却和健康检查</p>
                </div>
                <div v-if="canWrite" class="batch-actions">
                  <span class="selection-hint">已选 {{ selectedKeyRows.length }} 项</span>
                  <el-button
                    size="small"
                    :disabled="!selectedKeyRows.length || batchMutating"
                    @click="batchSetStatus('active')"
                  >
                    批量启用
                  </el-button>
                  <el-button
                    size="small"
                    :disabled="!selectedKeyRows.length || batchMutating"
                    @click="batchSetStatus('disabled')"
                  >
                    批量停用
                  </el-button>
                  <el-button
                    size="small"
                    type="primary"
                    plain
                    :loading="batchTesting"
                    :disabled="!selectedKeyRows.length || batchMutating"
                    @click="batchTestCredentials"
                  >
                    {{ batchTesting ? `测试中 ${batchTestProgress.done}/${batchTestProgress.total}` : "批量测试" }}
                  </el-button>
                  <el-button
                    size="small"
                    type="danger"
                    plain
                    :loading="batchDeleting"
                    :disabled="!selectedKeyRows.length || batchMutating"
                    @click="batchDeleteCredentials"
                  >
                    批量删除
                  </el-button>
                </div>
              </div>

              <el-table
                ref="keyTableRef"
                :data="selectedChannel.keys"
                row-key="id"
                size="small"
                class="key-table"
                empty-text="该渠道还没有 Key"
                @selection-change="handleSelectionChange"
              >
                <el-table-column v-if="canWrite" type="selection" width="42" />
                <el-table-column label="Key" min-width="190" fixed="left">
                  <template #default="{ row }">
                    <button type="button" class="key-name-button" @click="openKeyDetails(row)">
                      <strong>{{ row.label }}</strong>
                      <span class="secret-mask">•••• {{ row.secretSuffix }}</span>
                    </button>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="96">
                  <template #default="{ row }">
                    <el-tag :type="statusTagType(visibleStatus(row))" size="small" effect="light">
                      {{ statusText(visibleStatus(row)) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="近 24h" width="108">
                  <template #default="{ row }">
                    <div class="request-counts">
                      <span class="ok">{{ row.recentSuccessCount ?? 0 }}</span>
                      <span class="slash">/</span>
                      <span class="bad">{{ row.recentErrorCount ?? 0 }}</span>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="健康" min-width="112">
                  <template #default="{ row }">
                    <span
                      class="health-chip"
                      :class="healthChipClass(row)"
                      :title="healthDetail(row)"
                    >
                      {{ healthSummary(row) }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="最近使用" min-width="154">
                  <template #default="{ row }">
                    <span class="time-text">{{ formatDateTime(row.lastUsedAt) }}</span>
                  </template>
                </el-table-column>
                <el-table-column v-if="canWrite" label="操作" width="190" fixed="right">
                  <template #default="{ row }">
                    <div class="row-actions">
                      <el-button
                        link
                        type="primary"
                        :loading="isTesting(row.id)"
                        @click="testCredential(row)"
                      >
                        测试
                      </el-button>
                      <el-button
                        v-if="row.status === 'active'"
                        link
                        type="warning"
                        @click="setStatus(row, 'disabled')"
                      >
                        停用
                      </el-button>
                      <el-button v-else link type="success" @click="setStatus(row, 'active')">
                        启用
                      </el-button>
                      <el-button
                        link
                        type="danger"
                        :loading="isDeleting(row.id)"
                        @click="removeCredential(row)"
                      >
                        删除
                      </el-button>
                    </div>
                  </template>
                </el-table-column>
              </el-table>
            </section>
          </template>

          <el-empty
            v-else-if="!loading"
            class="detail-empty"
            :description="channels.length ? '请从左侧选择一个渠道' : '暂无上游渠道'"
            :image-size="96"
          >
            <el-button v-if="!channels.length && canWrite" type="primary" @click="openCreateChannel">
              新增渠道
            </el-button>
          </el-empty>
        </main>
      </div>
    </section>

    <el-dialog
      v-model="showBulkForm"
      :title="bulkForm.productLineId ? '批量添加 Key' : '新增渠道并导入 Key'"
      width="780px"
      destroy-on-close
      class="credential-dialog"
      @closed="clearBulkSecrets"
    >
      <template v-if="!bulkForm.productLineId">
        <div class="section-label">供应商</div>
        <div class="provider-grid">
          <button
            v-for="template in templates"
            :key="template.code"
            type="button"
            class="provider-card"
            :class="{ selected: bulkForm.providerCode === template.code }"
            @click="selectBulkTemplate(template)"
          >
            <span class="provider-logo" :style="{ background: template.color }">
              {{ template.shortName }}
            </span>
            <span class="provider-card-copy">
              <strong>{{ template.name }}</strong>
              <small>{{ template.description }}</small>
            </span>
          </button>
        </div>

        <el-form label-position="top" class="credential-form">
          <el-form-item label="渠道 / API 地址" required>
            <el-select v-model="bulkForm.baseUrl" style="width: 100%" placeholder="选择官方 API 地址">
              <el-option
                v-for="option in bulkBaseUrlOptions"
                :key="option.url"
                :label="`${option.productLineName} · ${option.label} · ${option.url}`"
                :value="option.url"
              />
            </el-select>
            <div class="form-help">同一供应商的不同区域或产品线会分别形成独立渠道。</div>
          </el-form-item>
        </el-form>
      </template>

      <div v-else-if="importTargetChannel" class="editing-context">
        <span class="provider-logo sm" :style="providerLogoStyle(importTargetChannel.providerCode)">
          {{ providerShortName(importTargetChannel.providerCode) }}
        </span>
        <div>
          <strong>{{ importTargetChannel.providerName }} · {{ importTargetChannel.productLineName }}</strong>
          <div class="cell-secondary mono wrap">{{ importTargetChannel.baseUrl }}</div>
        </div>
      </div>

      <el-alert
        v-if="importTargetChannel?.shareMode === 'grant_only'"
        class="grant-import-alert"
        type="warning"
        :closable="false"
        show-icon
        title="员工授权按 Key 独立管理；新导入的 Key 不会继承同渠道其他 Key 的授权。"
      />

      <el-divider />

      <el-form label-position="top" class="credential-form">
        <el-form-item label="API Key" required>
          <el-input
            v-model="bulkForm.rawKeys"
            type="textarea"
            :rows="10"
            resize="vertical"
            placeholder="每行一个 Key&#10;也支持：名称,Key&#10;或：名称&lt;Tab&gt;Key"
          />
          <div class="form-help bulk-help">
            <span>支持一次导入 1–200 个 Key；单列会自动生成名称。</span>
            <strong v-if="bulkParseResult.keys.length">
              已识别 {{ bulkParseResult.keys.length }} 个
            </strong>
          </div>
          <div v-if="bulkParseResult.errors.length" class="parse-errors">
            <div v-for="error in bulkParseResult.errors.slice(0, 4)" :key="error">{{ error }}</div>
            <div v-if="bulkParseResult.errors.length > 4">
              另有 {{ bulkParseResult.errors.length - 4 }} 项格式错误
            </div>
          </div>
        </el-form-item>

        <div v-if="bulkParseResult.keys.length" class="key-preview">
          <div class="key-preview-head">导入预览</div>
          <div
            v-for="key in bulkParseResult.keys.slice(0, 5)"
            :key="key.lineNo"
            class="key-preview-row"
          >
            <span>{{ key.label }}</span>
            <span class="secret-mask">•••• {{ key.secret.slice(-4) }}</span>
          </div>
          <div v-if="bulkParseResult.keys.length > 5" class="key-preview-more">
            其余 {{ bulkParseResult.keys.length - 5 }} 个 Key 将一并导入
          </div>
        </div>

        <el-form-item
          v-if="!bulkForm.productLineId"
          label="渠道协议"
          required
          class="protocol-form-item"
        >
          <el-select
            v-model="bulkForm.supportedProtocols"
            multiple
            collapse-tags
            collapse-tags-tooltip
            class="protocol-multi-select"
            placeholder="至少选择一种协议"
          >
            <el-option
              v-for="option in relayProtocolOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
          <div class="form-help">协议属于渠道，本次导入的所有 Key 将统一使用这些协议。</div>
        </el-form-item>

        <el-form-item v-else label="渠道协议" class="protocol-form-item">
          <div class="channel-protocol-summary">
            <el-tag
              v-for="protocol in bulkForm.supportedProtocols"
              :key="protocol"
              size="small"
              effect="plain"
            >
              {{ relayProtocolLabel(protocol, true) }}
            </el-tag>
          </div>
          <div class="form-help">新 Key 自动继承当前渠道协议，无需单独配置。</div>
        </el-form-item>

      </el-form>

      <template #footer>
        <el-button @click="showBulkForm = false">取消</el-button>
        <el-button
          type="primary"
          :loading="bulkSaving"
          :disabled="!bulkParseResult.keys.length || Boolean(bulkParseResult.errors.length)"
          @click="saveBulkKeys"
        >
          导入 {{ bulkParseResult.keys.length || "" }} 个 Key
        </el-button>
      </template>
    </el-dialog>

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
              <el-tag :type="statusTagType(visibleStatus(detailRow))" size="small">
                {{ statusText(visibleStatus(detailRow)) }}
              </el-tag>
            </div>
            <p>
              {{ detailRow.providerName }} · {{ detailRow.productLineName }} ·
              <span class="secret-mask inline">•••• {{ detailRow.secretSuffix }}</span>
            </p>
          </div>
          <div v-if="canWrite" class="drawer-actions">
            <el-button
              v-if="detailRow.status === 'active'"
              size="small"
              type="warning"
              plain
              @click="setStatus(detailRow, 'disabled')"
            >
              停用
            </el-button>
            <el-button v-else size="small" type="success" plain @click="setStatus(detailRow, 'active')">
              启用
            </el-button>
          </div>
        </div>

        <div class="drawer-sections">
          <section class="detail-section">
            <h4 class="section-heading">基本信息</h4>
            <dl class="info-grid">
              <div class="info-item full">
                <dt>API 地址</dt>
                <dd class="mono wrap">{{ effectiveBaseUrl(detailRow) }}</dd>
              </div>
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
              <h4 class="section-heading">健康检查</h4>
              <div v-if="canWrite" class="test-controls">
                <el-button
                  type="primary"
                  size="small"
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
              <p>{{ detailRow.lastError }}</p>
            </div>
            <template v-if="lastTest(detailRow)">
              <dl class="info-grid">
                <div class="info-item">
                  <dt>上次测试结果</dt>
                  <dd>
                    <el-tag :type="lastTest(detailRow)?.ok ? 'success' : 'danger'" size="small">
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
                  <el-tag v-for="model in discoveredModels(detailRow)" :key="model" size="small">
                    {{ model }}
                  </el-tag>
                </div>
              </div>
            </template>
            <p v-else class="empty-hint">尚未做过连通性测试。</p>
          </section>

          <section v-if="canManageGrants(detailRow)" class="detail-section">
            <h4 class="section-heading">员工授权</h4>
            <p class="empty-hint">该 Key 需显式授权员工后才可使用。</p>
            <el-form v-if="canWrite" inline class="grant-form" @submit.prevent>
              <el-form-item label="员工">
                <el-select
                  v-model="grantEmployeeId"
                  filterable
                  clearable
                  style="width: 260px"
                  placeholder="选择员工"
                >
                  <el-option
                    v-for="user in users"
                    :key="user.id"
                    :label="`${user.name} (${user.phone})`"
                    :value="user.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :loading="grantLoading" @click="addGrant">添加授权</el-button>
              </el-form-item>
            </el-form>
            <el-table v-loading="grantsLoading" :data="grants" size="small" empty-text="暂无授权员工">
              <el-table-column prop="employeeName" label="姓名" />
              <el-table-column prop="employeePhone" label="手机" />
              <el-table-column label="授权时间" min-width="170">
                <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
              </el-table-column>
              <el-table-column v-if="canWrite" label="操作" width="72">
                <template #default="{ row }">
                  <el-button link type="danger" @click="removeGrant(row.id)">移除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </section>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";
import { useAuthStore } from "@/stores/auth";
import {
  relayProtocolLabel,
  relayProtocolOptions,
  type RelayProtocol,
} from "@/views/relay-protocol";

type CredentialStatus = "active" | "disabled" | "auto_disabled" | "cooling";

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
  productLineStatus: string;
  productType: "api" | "coding_plan";
  shareMode: "public_pool" | "grant_only" | "disabled";
  defaultBaseUrl: string;
  baseUrlOverride: string | null;
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
};

type ProviderTemplateCode = "glm" | "kimi" | "deepseek" | "minimax";

type ProviderTemplate = {
  code: ProviderTemplateCode;
  name: string;
  shortName: string;
  description?: string;
  baseUrls: ProviderBaseUrl[];
  defaultProtocols: RelayProtocol[];
  defaultLabel: string;
  color: string;
};

type ChannelGroup = {
  id: number;
  providerCode: string;
  providerName: string;
  providerStatus: string;
  productLineCode: string;
  productLineName: string;
  productLineStatus: string;
  productType: CredentialRow["productType"];
  shareMode: CredentialRow["shareMode"];
  baseUrl: string;
  protocols: RelayProtocol[];
  keys: CredentialRow[];
  totalCount: number;
  schedulableCount: number;
  coolingCount: number;
  unschedulableCount: number;
  recentSuccessCount: number;
  recentErrorCount: number;
};

type ParsedKey = {
  lineNo: number;
  label: string;
  secret: string;
  hasCustomLabel: boolean;
};

type UserOption = { id: number; name: string; phone: string };
type GrantRow = { id: number; employeeName: string; employeePhone: string; createdAt: string };
type KeyTableRef = {
  clearSelection: () => void;
  toggleRowSelection: (row: CredentialRow, selected?: boolean) => void;
};

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const canWrite = computed(() => auth.isAdmin);

const rows = ref<CredentialRow[]>([]);
const templates = ref<ProviderTemplate[]>([]);
const users = ref<UserOption[]>([]);
const grants = ref<GrantRow[]>([]);
const loading = ref(false);
const selectedProductLineId = ref<number | null>(null);
const syncingQuery = ref(false);
const keyTableRef = ref<KeyTableRef | null>(null);
const selectedKeyRows = ref<CredentialRow[]>([]);

const showBulkForm = ref(false);
const bulkSaving = ref(false);

const showKeyDetails = ref(false);
const detailCredentialId = ref<number | null>(null);
const grantsLoading = ref(false);
const grantLoading = ref(false);
const grantEmployeeId = ref<number>();

const testingIds = ref<Set<number>>(new Set());
const deletingIds = ref<Set<number>>(new Set());
const batchTesting = ref(false);
const batchDeleting = ref(false);
const batchUpdating = ref(false);
const batchTestProgress = reactive({ done: 0, total: 0 });
const batchMutating = computed(() => batchTesting.value || batchDeleting.value || batchUpdating.value);

const bulkForm = reactive({
  productLineId: null as number | null,
  providerCode: "glm" as ProviderTemplateCode,
  baseUrl: "",
  rawKeys: "",
  supportedProtocols: ["openai_chat"] as RelayProtocol[],
});

const channels = computed<ChannelGroup[]>(() => {
  const grouped = new Map<number, CredentialRow[]>();
  for (const row of rows.value) {
    const group = grouped.get(row.productLineId);
    if (group) group.push(row);
    else grouped.set(row.productLineId, [row]);
  }

  return [...grouped.entries()].map(([id, keys]) => {
    const first = keys[0];
    const coolingCount = keys.filter((key) => visibleStatus(key) === "cooling").length;
    const channelCanSchedule = first.providerStatus === "active"
      && first.productLineStatus === "active"
      && first.shareMode !== "disabled";
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
      shareMode: first.shareMode,
      baseUrl: effectiveBaseUrl(first),
      protocols: credentialProtocols(first),
      keys,
      totalCount: keys.length,
      schedulableCount,
      coolingCount,
      unschedulableCount: Math.max(0, keys.length - schedulableCount - coolingCount),
      recentSuccessCount: keys.reduce((sum, key) => sum + (key.recentSuccessCount ?? 0), 0),
      recentErrorCount: keys.reduce((sum, key) => sum + (key.recentErrorCount ?? 0), 0),
    };
  });
});

const selectedChannel = computed(
  () => channels.value.find((channel) => channel.id === selectedProductLineId.value) ?? null,
);

const detailRow = computed(
  () => rows.value.find((row) => row.id === detailCredentialId.value) ?? null,
);

const selectedBulkTemplate = computed(
  () => templates.value.find((template) => template.code === bulkForm.providerCode),
);

const bulkBaseUrlOptions = computed(() => selectedBulkTemplate.value?.baseUrls ?? []);

const importTargetChannel = computed(
  () => channels.value.find((channel) => channel.id === bulkForm.productLineId) ?? null,
);

const importChannelLabel = computed(() => {
  if (importTargetChannel.value) return importTargetChannel.value.productLineName;
  const option = bulkBaseUrlOptions.value.find((item) => item.url === bulkForm.baseUrl);
  return option?.productLineName || selectedBulkTemplate.value?.defaultLabel || "API Key";
});

const bulkParseResult = computed(() => parseBulkKeys(
  bulkForm.rawKeys,
  importChannelLabel.value,
  importTargetChannel.value?.totalCount ?? 0,
));

function parseQueryId(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || raw === "") return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function reconcileSelection() {
  if (!channels.value.length) {
    selectedProductLineId.value = null;
    syncSelectedToQuery(null);
    return;
  }

  const legacyCredentialId = parseQueryId(route.query.id);
  const legacyCredential = legacyCredentialId == null
    ? null
    : rows.value.find((row) => row.id === legacyCredentialId) ?? null;
  if (legacyCredential) {
    selectedProductLineId.value = legacyCredential.productLineId;
    if (detailCredentialId.value !== legacyCredential.id || !showKeyDetails.value) {
      openKeyDetails(legacyCredential);
    }
    syncSelectedToQuery(legacyCredential.productLineId);
    return;
  }

  const requestedChannelId = parseQueryId(route.query.channelId);
  if (requestedChannelId != null && channels.value.some((channel) => channel.id === requestedChannelId)) {
    selectedProductLineId.value = requestedChannelId;
    if (legacyCredentialId != null) syncSelectedToQuery(requestedChannelId);
    return;
  }

  const nextId = channels.value.some((channel) => channel.id === selectedProductLineId.value)
    ? selectedProductLineId.value
    : channels.value[0].id;
  selectedProductLineId.value = nextId;
  syncSelectedToQuery(nextId);
}

function syncSelectedToQuery(id: number | null) {
  if (syncingQuery.value) return;
  const current = parseQueryId(route.query.channelId);
  const hasLegacyId = route.query.id != null;
  if (current === id && !hasLegacyId) return;
  syncingQuery.value = true;
  const query = { ...route.query };
  delete query.id;
  if (id == null) delete query.channelId;
  else query.channelId = String(id);
  router
    .replace({ query })
    .catch(() => undefined)
    .finally(() => {
      syncingQuery.value = false;
    });
}

watch(rows, reconcileSelection, { deep: false });

watch(selectedProductLineId, (id) => {
  syncSelectedToQuery(id);
  clearSelectedKeys();
  if (detailRow.value && detailRow.value.productLineId !== id) {
    showKeyDetails.value = false;
  }
});

watch(
  [() => route.query.channelId, () => route.query.id],
  () => {
    if (syncingQuery.value) return;
    reconcileSelection();
  },
);

watch(showBulkForm, (visible) => {
  if (!visible) clearBulkSecrets();
});

function selectChannel(id: number) {
  selectedProductLineId.value = id;
}

function clearSelectedKeys() {
  selectedKeyRows.value = [];
  keyTableRef.value?.clearSelection();
}

function handleSelectionChange(selection: CredentialRow[]) {
  selectedKeyRows.value = selection;
}

async function selectKeysByIds(ids: number[]) {
  if (!ids.length) return;
  const idSet = new Set(ids);
  const createdRows = selectedChannel.value?.keys.filter((row) => idSet.has(row.id)) ?? [];
  if (!createdRows.length) return;
  await nextTick();
  keyTableRef.value?.clearSelection();
  for (const row of createdRows) {
    keyTableRef.value?.toggleRowSelection(row, true);
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  const responseMessage = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof responseMessage === "string" ? responseMessage : fallback;
}

function effectiveBaseUrl(row: CredentialRow): string {
  return row.baseUrlOverride || row.defaultBaseUrl;
}

function credentialProtocols(row: CredentialRow): RelayProtocol[] {
  return row.supportedProtocols?.length ? row.supportedProtocols : ["openai_chat"];
}

function lastTest(row: CredentialRow): TestResult | undefined {
  return row.meta?.lastTest;
}

function discoveredModels(row: CredentialRow): string[] {
  return row.meta?.discoveredModels ?? lastTest(row)?.models ?? [];
}

function canManageGrants(row: CredentialRow): boolean {
  return row.shareMode === "grant_only";
}

function isCoolingActive(row: CredentialRow): boolean {
  if (!row.coolUntil) return false;
  const until = new Date(row.coolUntil).getTime();
  return !Number.isNaN(until) && until > Date.now();
}

function visibleStatus(row: CredentialRow): CredentialStatus {
  if (row.status === "active" && isCoolingActive(row)) return "cooling";
  return row.status;
}

function providerColor(code: string): string {
  return templates.value.find((item) => item.code === code)?.color ?? "#64748b";
}

function providerShortName(code: string): string {
  return templates.value.find((item) => item.code === code)?.shortName
    ?? code.slice(0, 4).toUpperCase();
}

function providerLogoStyle(code: string): Record<string, string> {
  return { background: providerColor(code) };
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

function channelAvailabilityType(channel: ChannelGroup): "success" | "warning" | "danger" | "info" {
  if (!channel.totalCount || !channel.schedulableCount) return "danger";
  if (channel.schedulableCount < channel.totalCount) return "warning";
  return "success";
}

function healthSummary(row: CredentialRow): string {
  const currentStatus = visibleStatus(row);
  if (currentStatus === "cooling") return "冷却中";
  if (currentStatus === "auto_disabled") return "自动停用";
  if (row.lastError) return "最近异常";
  const test = lastTest(row);
  if (!test) return "未测试";
  if (test.ok) return test.latencyMs != null ? `${test.latencyMs} ms` : "正常";
  return "测试失败";
}

function healthDetail(row: CredentialRow): string {
  const currentStatus = visibleStatus(row);
  if (currentStatus === "cooling") {
    return row.lastError || (row.coolUntil ? `冷却至 ${formatDateTime(row.coolUntil)}` : "Key 正在冷却");
  }
  if (currentStatus === "auto_disabled") return row.lastError || "Key 已因连续错误自动停用";
  if (row.lastError) return row.lastError;
  return lastTest(row)?.message || "尚未测试";
}

function healthChipClass(row: CredentialRow): string {
  const currentStatus = visibleStatus(row);
  if (currentStatus === "cooling") return "warning";
  if (currentStatus === "auto_disabled" || row.lastError) return "bad";
  const test = lastTest(row);
  if (!test) return "muted";
  return test.ok ? "ok" : "bad";
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

function setDeleting(id: number, deleting: boolean) {
  const next = new Set(deletingIds.value);
  if (deleting) next.add(id);
  else next.delete(id);
  deletingIds.value = next;
}

function isDeleting(id: number): boolean {
  return deletingIds.value.has(id);
}

async function loadCredentials() {
  const { data } = await http.get("/api/admin/credentials");
  if (data.success) {
    rows.value = data.data;
    clearSelectedKeys();
  }
}

async function loadMeta() {
  const templateResponse = await http.get("/api/admin/credential-templates");
  if (templateResponse.data.success) templates.value = templateResponse.data.data;

  if (canWrite.value) {
    try {
      const userResponse = await http.get("/api/admin/users", { params: { limit: 200 } });
      if (userResponse.data.success) users.value = userResponse.data.data;
    } catch {
      users.value = [];
    }
  } else {
    users.value = [];
  }
}

async function refreshAll() {
  loading.value = true;
  try {
    await Promise.all([loadCredentials(), loadMeta()]);
    if (showKeyDetails.value && detailRow.value && canManageGrants(detailRow.value)) {
      await loadGrants(detailRow.value.id);
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "加载上游渠道失败"));
  } finally {
    loading.value = false;
  }
}

function resetBulkForm() {
  const first = templates.value[0];
  bulkForm.productLineId = null;
  bulkForm.providerCode = first?.code ?? "glm";
  bulkForm.baseUrl = first?.baseUrls[0]?.url ?? "";
  bulkForm.rawKeys = "";
  bulkForm.supportedProtocols = [...(first?.defaultProtocols ?? ["openai_chat"])];
}

function openCreateChannel() {
  resetBulkForm();
  showBulkForm.value = true;
}

function openAddKeys(channel: ChannelGroup) {
  resetBulkForm();
  bulkForm.productLineId = channel.id;
  bulkForm.providerCode = channel.providerCode as ProviderTemplateCode;
  bulkForm.baseUrl = channel.baseUrl;
  bulkForm.supportedProtocols = [...channel.protocols];
  showBulkForm.value = true;
}

function selectBulkTemplate(template: ProviderTemplate) {
  bulkForm.providerCode = template.code;
  bulkForm.baseUrl = template.baseUrls[0]?.url ?? "";
  bulkForm.supportedProtocols = [...template.defaultProtocols];
}

function clearBulkSecrets() {
  bulkForm.rawKeys = "";
}

function parseBulkKeys(
  raw: string,
  labelBase: string,
  existingCount: number,
): { keys: ParsedKey[]; errors: string[] } {
  const keys: ParsedKey[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const nonEmptyLines = raw
    .split(/\r?\n/)
    .map((line, index) => ({ value: line.trim(), lineNo: index + 1 }))
    .filter((line) => line.value.length > 0);

  for (const line of nonEmptyLines) {
    const tabIndex = line.value.indexOf("\t");
    const commaIndex = line.value.indexOf(",");
    const separatorIndex = tabIndex >= 0 ? tabIndex : commaIndex;
    let label = "";
    let secret = line.value;

    if (separatorIndex >= 0) {
      label = line.value.slice(0, separatorIndex).trim();
      secret = line.value.slice(separatorIndex + 1).trim();
      if (!label) errors.push(`第 ${line.lineNo} 行：名称不能为空`);
    }

    if (secret.length < 8) {
      errors.push(`第 ${line.lineNo} 行：Key 至少需要 8 个字符`);
      continue;
    }
    if (secret.length > 4096) {
      errors.push(`第 ${line.lineNo} 行：Key 不能超过 4096 个字符`);
      continue;
    }
    if (seen.has(secret)) {
      errors.push(`第 ${line.lineNo} 行：与第 ${seen.get(secret)} 行的 Key 重复`);
      continue;
    }

    seen.set(secret, line.lineNo);
    const generatedLabel = `${labelBase} Key ${String(existingCount + keys.length + 1).padStart(2, "0")}`;
    const hasCustomLabel = Boolean(label);
    const finalLabel = label || generatedLabel;
    if (finalLabel.length > 200) {
      errors.push(`第 ${line.lineNo} 行：名称不能超过 200 个字符`);
      continue;
    }
    keys.push({ lineNo: line.lineNo, label: finalLabel, secret, hasCustomLabel });
  }

  if (keys.length > 200) errors.push("单次最多导入 200 个 Key");
  return { keys, errors };
}

async function saveBulkKeys() {
  const parsed = bulkParseResult.value;
  if (!parsed.keys.length) {
    ElMessage.warning("请粘贴至少一个 API Key");
    return;
  }
  if (parsed.errors.length) {
    ElMessage.warning("请先修正 Key 格式错误");
    return;
  }
  if (!bulkForm.supportedProtocols.length) {
    ElMessage.warning("请至少选择一种支持协议");
    return;
  }
  if (!bulkForm.productLineId && !bulkForm.baseUrl) {
    ElMessage.warning("请选择渠道 API 地址");
    return;
  }

  bulkSaving.value = true;
  try {
    const payload = {
      ...(bulkForm.productLineId
        ? { productLineId: bulkForm.productLineId }
        : { providerCode: bulkForm.providerCode, baseUrl: bulkForm.baseUrl }),
      keys: parsed.keys.map(({ label, secret, hasCustomLabel }) => (
        hasCustomLabel ? { label, secret } : { secret }
      )),
      defaults: {
        supportedProtocols: [...bulkForm.supportedProtocols],
      },
    };
    const { data } = await http.post("/api/admin/credentials/bulk-create", payload);
    const createdIds = Array.isArray(data.data?.credentials)
      ? data.data.credentials
        .map((credential: { id?: unknown }) => Number(credential.id))
        .filter((id: number) => Number.isInteger(id) && id > 0)
      : [];
    const targetId = Number(
      data.data?.productLineId
      ?? data.data?.productLine?.id
      ?? bulkForm.productLineId,
    );
    const createdCount = Number(data.data?.createdCount ?? data.data?.credentials?.length ?? parsed.keys.length);
    clearBulkSecrets();
    showBulkForm.value = false;
    await loadCredentials();
    if (Number.isInteger(targetId) && channels.value.some((channel) => channel.id === targetId)) {
      selectedProductLineId.value = targetId;
    } else if (!bulkForm.productLineId) {
      const createdChannel = channels.value.find(
        (channel) => channel.providerCode === bulkForm.providerCode && channel.baseUrl === bulkForm.baseUrl,
      );
      if (createdChannel) selectedProductLineId.value = createdChannel.id;
    }
    await nextTick();
    await selectKeysByIds(createdIds);
    ElMessage.success({
      message: `已导入 ${createdCount} 个 Key，并自动选中。请点击“批量测试”；测试成功并发现模型后才会参与自动路由。`,
      duration: 7000,
      showClose: true,
    });
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "批量导入失败"));
  } finally {
    bulkSaving.value = false;
  }
}

function preferredProtocol(row: CredentialRow): RelayProtocol {
  const supported = credentialProtocols(row);
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
  if (!canWrite.value || !selectedKeyRows.value.length || batchMutating.value) return;
  const targets = [...selectedKeyRows.value];
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

async function batchSetStatus(status: "active" | "disabled") {
  if (!canWrite.value || !selectedKeyRows.value.length || batchMutating.value) return;
  const ids = selectedKeyRows.value.map((row) => row.id);
  if (ids.length > 200) {
    ElMessage.warning("单次最多批量更新 200 个 Key");
    return;
  }
  batchUpdating.value = true;
  try {
    await http.patch("/api/admin/credentials/bulk-status", { ids, status });
    ElMessage.success(`已${status === "active" ? "启用" : "停用"} ${ids.length} 个 Key`);
    await loadCredentials();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "批量更新状态失败"));
  } finally {
    batchUpdating.value = false;
  }
}

async function removeCredential(row: CredentialRow) {
  try {
    await ElMessageBox.confirm(
      `确认删除 Key「${row.label}」（末四位 ${row.secretSuffix}）？删除后不可恢复，历史调用日志仍会保留。`,
      "删除 API Key",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      },
    );
  } catch {
    return;
  }

  setDeleting(row.id, true);
  try {
    await http.delete(`/api/admin/credentials/${row.id}`);
    ElMessage.success("Key 已删除");
    if (detailCredentialId.value === row.id) showKeyDetails.value = false;
    await loadCredentials();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "删除失败"));
  } finally {
    setDeleting(row.id, false);
  }
}

async function batchDeleteCredentials() {
  if (!canWrite.value || !selectedKeyRows.value.length || batchMutating.value) return;
  const targets = [...selectedKeyRows.value];
  const channel = selectedChannel.value;
  if (!channel) return;
  if (targets.length > 200) {
    ElMessage.warning("单次最多批量删除 200 个 Key");
    return;
  }
  const channelConfirmName = `${channel.providerName} · ${channel.productLineName}`;
  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${targets.length} 个 Key？对应的员工授权也会一并删除。删除后不可恢复，历史调用日志仍会保留。`,
      "批量删除 API Key",
      {
        type: "warning",
        confirmButtonText: "批量删除",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      },
    );
    await ElMessageBox.prompt(
      `请输入渠道名称「${channelConfirmName}」完成二次确认。`,
      "确认批量删除",
      {
        type: "warning",
        inputPlaceholder: channelConfirmName,
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
        inputValidator: (value) => value.trim() === channelConfirmName || "渠道名称不匹配",
      },
    );
  } catch {
    return;
  }

  batchDeleting.value = true;
  try {
    const ids = targets.map((row) => row.id);
    await http.post("/api/admin/credentials/bulk-delete", { ids });
    ElMessage.success(`已删除 ${ids.length} 个 Key`);
    if (detailCredentialId.value && ids.includes(detailCredentialId.value)) {
      showKeyDetails.value = false;
    }
    await loadCredentials();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "批量删除失败"));
  } finally {
    batchDeleting.value = false;
  }
}

function openKeyDetails(row: CredentialRow) {
  detailCredentialId.value = row.id;
  showKeyDetails.value = true;
  grantEmployeeId.value = undefined;
  if (canManageGrants(row)) void loadGrants(row.id);
  else grants.value = [];
}

function closeKeyDetails() {
  detailCredentialId.value = null;
  grants.value = [];
  grantEmployeeId.value = undefined;
}

async function loadGrants(credentialId: number) {
  grantsLoading.value = true;
  try {
    const { data } = await http.get(`/api/admin/credentials/${credentialId}/grants`);
    if (data.success && detailCredentialId.value === credentialId) grants.value = data.data;
  } catch (error) {
    if (detailCredentialId.value === credentialId) {
      grants.value = [];
      ElMessage.error(getErrorMessage(error, "加载授权失败"));
    }
  } finally {
    grantsLoading.value = false;
  }
}

async function addGrant() {
  const credentialId = detailCredentialId.value;
  if (!canWrite.value || !credentialId) return;
  if (!grantEmployeeId.value) {
    ElMessage.warning("请选择员工");
    return;
  }
  grantLoading.value = true;
  try {
    await http.post(`/api/admin/credentials/${credentialId}/grants`, {
      employeeId: grantEmployeeId.value,
    });
    ElMessage.success("已授权");
    grantEmployeeId.value = undefined;
    await loadGrants(credentialId);
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "授权失败"));
  } finally {
    grantLoading.value = false;
  }
}

async function removeGrant(grantId: number) {
  const credentialId = detailCredentialId.value;
  if (!canWrite.value || !credentialId) return;
  try {
    await http.delete(`/api/admin/credentials/${credentialId}/grants/${grantId}`);
    ElMessage.success("已移除授权");
    await loadGrants(credentialId);
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "移除授权失败"));
  }
}

onMounted(refreshAll);
</script>

<style scoped>
.credentials-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.credentials-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.page-head {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
}

.page-title {
  margin: 0;
  font-size: 22px;
}

.page-subtitle {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 13px;
}

.head-actions,
.detail-actions,
.drawer-actions,
.row-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.split-layout {
  display: grid;
  grid-template-columns: minmax(260px, 310px) minmax(0, 1fr);
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.channel-list-pane,
.channel-detail-pane {
  min-width: 0;
  min-height: 0;
  height: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.channel-list-pane {
  display: flex;
  flex-direction: column;
  padding: 12px;
  overflow: hidden;
  background: #f8fafc;
}

.pane-label {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  padding: 0 4px;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.pane-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #e2e8f0;
}

.channel-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding-right: 2px;
  overflow-x: hidden;
  overflow-y: auto;
}

.channel-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.channel-card:hover {
  border-color: #93c5fd;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
}

.channel-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
}

.channel-card-top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.channel-card-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.channel-card-title {
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-card-meta {
  color: #94a3b8;
  font-size: 12px;
}

.channel-card-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #94a3b8;
  font-size: 12px;
}

.channel-code {
  max-width: 150px;
  overflow: hidden;
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-detail-pane {
  display: flex;
  flex-direction: column;
  padding: 18px 20px;
  background: #fff;
  overflow-x: hidden;
  overflow-y: auto;
}

.detail-header,
.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.detail-header {
  margin-bottom: 14px;
}

.detail-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.detail-copy {
  min-width: 0;
}

.detail-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.detail-title,
.drawer-title {
  margin: 0;
  color: #0f172a;
  font-size: 20px;
  font-weight: 650;
}

.detail-subtitle {
  margin-top: 5px;
  color: #64748b;
  font-size: 12px;
}

.channel-protocols {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
}

.channel-protocols > span {
  margin-right: 2px;
  color: #94a3b8;
  font-size: 12px;
}

.provider-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  border-radius: 12px;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.provider-logo.sm {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  font-size: 11px;
}

.channel-overview {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.overview-card {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 6px;
  min-height: 30px;
  padding: 5px 9px;
  border: 1px solid #e5e7eb;
  border-radius: 7px;
  background: #f8fafc;
}

.overview-card span {
  color: #94a3b8;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}

.overview-card strong {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  color: #0f172a;
  font-size: 14px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.overview-card strong small {
  padding-left: 6px;
  border-left: 1px solid #dbe3ed;
  color: #64748b;
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.overview-card.success {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.overview-card.warning {
  border-color: #fde68a;
  background: #fffbeb;
}

.overview-card.danger {
  border-color: #fecaca;
  background: #fef2f2;
}

.overview-card.success strong { color: #15803d; }
.overview-card.warning strong { color: #d97706; }
.overview-card.danger strong { color: #b91c1c; }

.key-pool-section {
  min-width: 0;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
}

.key-pool-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-bottom: 1px solid #e5e7eb;
  background: #f8fafc;
}

.key-pool-head h4 {
  margin: 0;
  color: #334155;
  font-size: 14px;
}

.key-pool-head p {
  margin: 4px 0 0;
  color: #94a3b8;
  font-size: 12px;
}

.batch-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
}

.selection-hint {
  margin-right: 2px;
  color: #64748b;
  font-size: 12px;
}

.key-table {
  width: 100%;
}

.key-name-button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.key-name-button strong {
  max-width: 100%;
  overflow: hidden;
  color: #2563eb;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.secret-mask {
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

.request-counts {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.request-counts .ok,
.ok-text { color: #15803d; }
.request-counts .bad,
.bad-text { color: #b91c1c; }
.request-counts .slash { margin: 0 5px; color: #cbd5e1; }

.health-chip {
  color: #64748b;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.health-chip.ok { color: #15803d; }
.health-chip.bad { color: #b91c1c; }
.health-chip.warning { color: #d97706; }
.health-chip.muted { color: #94a3b8; }

.time-text {
  color: #64748b;
  font-size: 12px;
}

.row-actions {
  flex-wrap: nowrap;
  gap: 0;
}

.row-actions :deep(.el-button + .el-button) {
  margin-left: 9px;
}

.detail-empty {
  margin: auto;
}

.section-label {
  margin-bottom: 10px;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 18px;
}

.provider-card {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 70px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 11px;
  background: #fff;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.provider-card:hover {
  border-color: #93c5fd;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.07);
}

.provider-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
}

.provider-card-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 3px;
}

.provider-card-copy strong {
  color: #0f172a;
  font-size: 14px;
}

.provider-card-copy small {
  color: #94a3b8;
  font-size: 11px;
  line-height: 1.35;
}

.editing-context {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 9px;
  background: #f8fafc;
}

.grant-import-alert {
  margin-top: 12px;
}

.cell-secondary {
  margin-top: 3px;
  color: #94a3b8;
  font-size: 12px;
}

.credential-form {
  margin-top: 4px;
}

.protocol-form-item :deep(.el-form-item__content) {
  display: block;
}

.protocol-multi-select {
  width: 100%;
}

.channel-protocol-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.form-help {
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.bulk-help {
  display: flex;
  justify-content: space-between;
  width: 100%;
  gap: 10px;
}

.bulk-help strong {
  flex: 0 0 auto;
  color: #2563eb;
}

.parse-errors {
  width: 100%;
  margin-top: 7px;
  padding: 8px 10px;
  border-radius: 7px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 12px;
  line-height: 1.55;
}

.key-preview {
  margin: -2px 0 16px;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f8fafc;
}

.key-preview-head {
  margin-bottom: 6px;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.key-preview-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
  color: #334155;
  font-size: 12px;
}

.key-preview-more {
  margin-top: 5px;
  color: #94a3b8;
  font-size: 12px;
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

.grant-form {
  margin-bottom: 10px;
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

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.wrap {
  white-space: normal;
  word-break: break-all;
}

@media (max-width: 1200px) {
  .key-pool-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .batch-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 900px) {
  .split-layout {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 35%) minmax(0, 1fr);
  }

  .detail-header,
  .drawer-head {
    flex-direction: column;
  }
}

@media (max-width: 720px) {
  .page-head {
    display: flex;
    flex-direction: column;
  }

  .head-actions {
    width: 100%;
  }

  .provider-grid,
  .info-grid {
    grid-template-columns: 1fr;
  }

}
</style>
