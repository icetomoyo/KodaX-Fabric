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
                  <strong class="channel-card-title">{{ channelDisplayName(channel) }}</strong>
                </div>
                <el-tag :type="channelStatusType(channel)" size="small" effect="light">
                  {{ channelStatusText(channel) }}
                </el-tag>
              </div>
              <div class="channel-card-bottom">
                <span>{{ channel.totalCount }} 个 Key</span>
              </div>
            </button>
          </div>
        </aside>

        <main class="channel-detail-pane">
          <template v-if="selectedChannel">
            <div class="detail-header">
              <div class="detail-copy">
                <h3 class="detail-title">{{ channelDisplayName(selectedChannel) }}</h3>
              </div>
              <div class="detail-actions">
                <el-tag v-if="!canWrite" type="info" effect="plain" size="small">只读查看</el-tag>
                <template v-if="canWrite">
                  <el-button @click="openEditChannel(selectedChannel)">编辑渠道</el-button>
                  <el-button type="primary" @click="openAddKeys(selectedChannel)">
                    添加 Key
                  </el-button>
                </template>
                <el-button @click="openChannelDetails(selectedChannel)">渠道详情</el-button>
              </div>
            </div>

            <section class="key-pool-section">
              <div class="key-pool-head">
                <div>
                  <h4>Key 列表（{{ selectedChannel.totalCount }}）</h4>
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
                :data="pagedKeys"
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
              <div v-if="selectedChannel.totalCount > KEY_PAGE_SIZE" class="pager">
                <el-pagination
                  background
                  size="small"
                  layout="total, prev, pager, next"
                  :total="selectedChannel.totalCount"
                  :page-size="KEY_PAGE_SIZE"
                  v-model:current-page="keyPage"
                />
              </div>
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
      v-model="showChannelEdit"
      title="编辑上游渠道"
      width="min(620px, 92vw)"
      destroy-on-close
      class="credential-dialog"
    >
      <div v-if="channelEditTarget" class="editing-context channel-edit-context">
        <span class="provider-logo sm" :style="providerLogoStyle(channelEditTarget.providerCode)">
          {{ providerShortName(channelEditTarget.providerCode) }}
        </span>
        <div>
          <strong>{{ channelDisplayName(channelEditTarget) }}</strong>
          <div class="cell-secondary">供应商与渠道变体不可在编辑时更换</div>
        </div>
      </div>

      <el-form label-position="top" class="credential-form" @submit.prevent>
        <ChannelConfigFields
          v-model:name="channelEditForm.name"
          v-model:supported-protocols="channelEditForm.supportedProtocols"
          v-model:status="channelEditForm.status"
          :protocol-configs="channelEditProtocolConfigs"
          :protocols-touched="channelEditProtocolsTouched"
          :routing-config-drift="channelEditRoutingConfigDrift"
          :routing-upgrade-requested="channelEditRoutingUpgradeRequested"
          :disabled="channelEditSaving"
          show-change-risk
          @protocols-change="channelEditProtocolsTouched = true"
          @request-routing-upgrade="channelEditRoutingUpgradeRequested = true"
        />
      </el-form>

      <template #footer>
        <el-button :disabled="channelEditSaving" @click="showChannelEdit = false">取消</el-button>
        <el-button
          type="primary"
          :loading="channelEditSaving"
          :disabled="channelEditSaving"
          @click="saveChannelEdit"
        >
          保存
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showBulkForm"
      :title="bulkForm.productLineId ? '批量添加 Key' : '新增渠道并导入 Key'"
      width="min(780px, 94vw)"
      destroy-on-close
      class="credential-dialog"
      @closed="clearBulkSecrets"
    >
      <template v-if="!bulkForm.productLineId">
        <div class="section-label">选择渠道（公司名称/模型名称）</div>
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
              <strong>{{ templateDisplayName(template) }}</strong>
              <small>{{ template.name }} · {{ template.modelName }}</small>
            </span>
          </button>
        </div>

        <el-form label-position="top" class="credential-form" @submit.prevent>
          <el-form-item label="渠道变体" required>
            <el-select
              v-model="bulkForm.baseUrl"
              style="width: 100%"
              placeholder="选择渠道变体"
              @change="selectBulkVariant"
            >
              <el-option
                v-for="option in bulkBaseUrlOptions"
                :key="option.url"
                :label="baseUrlOptionLabel(option)"
                :value="option.url"
              />
            </el-select>
            <div class="form-help">
              选择渠道身份后，再由协议自动确定只读的上游 URL 与鉴权方式。
            </div>
          </el-form-item>

          <div v-if="selectedConfiguredProductLine" class="configured-variant-notice">
            <el-alert
              title="该渠道变体已经存在，不能重复新建；可改为向现有渠道添加 Key。"
              type="info"
              :closable="false"
              show-icon
            />
            <el-button type="primary" plain @click="useConfiguredVariant">
              向现有渠道添加 Key
            </el-button>
          </div>

          <ChannelConfigFields
            v-model:name="bulkForm.name"
            v-model:supported-protocols="bulkForm.supportedProtocols"
            v-model:status="bulkForm.status"
            :protocol-configs="bulkProtocolConfigs"
            :disabled="bulkSaving || Boolean(selectedConfiguredProductLine)"
          />
        </el-form>
      </template>

      <div v-else-if="importTargetChannel" class="editing-context">
        <span class="provider-logo sm" :style="providerLogoStyle(importTargetChannel.providerCode)">
          {{ providerShortName(importTargetChannel.providerCode) }}
        </span>
        <div>
          <strong>{{ channelDisplayName(importTargetChannel) }}</strong>
          <ProtocolRouteSummary
            class="cell-secondary"
            :protocols="importTargetChannel.protocols"
            :protocol-configs="importTargetChannel.protocolConfigs"
            :fallback-base-url="importTargetChannel.baseUrl"
          />
        </div>
      </div>

      <div v-else-if="selectedConfiguredProductLine" class="editing-context">
        <span class="provider-logo sm" :style="providerLogoStyle(bulkForm.providerCode)">
          {{ providerShortName(bulkForm.providerCode) }}
        </span>
        <div>
          <strong>{{ selectedConfiguredProductLine.name }}</strong>
          <div class="cell-secondary">向现有渠道添加 Key，渠道配置保持不变</div>
        </div>
      </div>

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

        <el-form-item v-if="bulkForm.productLineId" label="渠道协议" class="protocol-form-item">
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
      v-model="showChannelDetails"
      title="渠道详情"
      size="min(680px, 94vw)"
      destroy-on-close
      class="channel-detail-drawer"
    >
      <div v-loading="channelSummaryLoading" class="channel-summary-body">
        <template v-if="selectedChannelSummary">
          <div class="drawer-head channel-summary-head">
            <div class="detail-identity">
              <span
                class="provider-logo"
                :style="providerLogoStyle(selectedChannelSummary.provider.code)"
              >
                {{ providerShortName(selectedChannelSummary.provider.code) }}
              </span>
              <div>
                <h3 class="drawer-title">
                  {{ formatChannelName(selectedChannelSummary.provider.name, selectedChannelSummary.name) }}
                </h3>
                <p>{{ selectedChannelSummary.provider.name }} · ProductLine {{ selectedChannelSummary.code }}</p>
              </div>
            </div>
            <el-tag
              :type="selectedChannelSummary.status === 'active' && selectedChannelSummary.provider.status === 'active' ? 'success' : 'danger'"
            >
              {{ selectedChannelSummary.status === "active" && selectedChannelSummary.provider.status === "active" ? "启用" : "停用" }}
            </el-tag>
          </div>

          <section class="detail-section">
            <h4 class="section-heading">渠道配置</h4>
            <dl class="info-grid">
              <div class="info-item"><dt>供应商</dt><dd>{{ selectedChannelSummary.provider.name }}</dd></div>
              <div class="info-item"><dt>ProductLine</dt><dd>{{ selectedChannelSummary.code }}</dd></div>
              <div class="info-item"><dt>接入类型</dt><dd>{{ selectedChannelSummary.productType === "coding_plan" ? "Coding Plan" : "API" }}</dd></div>
              <div class="info-item"><dt>共享模式</dt><dd>{{ selectedChannelSummary.shareMode }}</dd></div>
              <div class="info-item full"><dt>Base URL</dt><dd class="url-value">{{ selectedChannelSummary.baseUrl }}</dd></div>
              <div class="info-item full">
                <dt>协议路由</dt>
                <dd>
                  <ProtocolRouteSummary
                    :protocols="selectedChannelSummary.protocols"
                    :protocol-configs="selectedChannelSummary.protocolConfigs"
                    :fallback-base-url="selectedChannelSummary.baseUrl"
                  />
                </dd>
              </div>
            </dl>
          </section>

          <section class="detail-section">
            <h4 class="section-heading">渠道统计</h4>
            <div class="channel-overview drawer-overview">
              <div class="overview-card"><span>Key 总数</span><strong>{{ selectedChannelSummary.stats.totalCount }}</strong></div>
              <div class="overview-card success"><span>可调度</span><strong>{{ selectedChannelSummary.stats.schedulableCount }}</strong></div>
              <div class="overview-card warning"><span>冷却中</span><strong>{{ selectedChannelSummary.stats.coolingCount }}</strong></div>
              <div class="overview-card danger"><span>不可调度</span><strong>{{ selectedChannelSummary.stats.unschedulableCount }}</strong></div>
              <div class="overview-card wide">
                <span>滚动 24h</span>
                <strong>
                  {{ selectedChannelSummary.stats.recentSuccessCount + selectedChannelSummary.stats.recentErrorCount }}
                  <small>成功 {{ selectedChannelSummary.stats.recentSuccessCount }} / 失败 {{ selectedChannelSummary.stats.recentErrorCount }}</small>
                </strong>
              </div>
            </div>
          </section>
        </template>
        <el-empty v-else-if="!channelSummaryLoading" description="渠道详情加载失败" />
      </div>
    </el-drawer>

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
              {{ channelDisplayName(detailRow) }} ·
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
                <dt>协议路由</dt>
                <dd>
                  <ProtocolRouteSummary
                    :protocols="credentialProtocols(detailRow)"
                    :protocol-configs="detailRow.protocolConfigs"
                    :fallback-base-url="effectiveBaseUrl(detailRow)"
                  />
                </dd>
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
import ChannelConfigFields from "@/views/admin/ChannelConfigFields.vue";
import ProtocolRouteSummary from "@/views/admin/ProtocolRouteSummary.vue";
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
  productLineStatus: ChannelStatus;
  productType: "api" | "coding_plan";
  protocolConfigs: RelayProtocolConfigs;
  configVersion: number;
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
  protocolConfigs?: RelayProtocolConfigs;
};

type ProviderTemplateCode = "glm" | "kimi" | "deepseek" | "minimax";

type ConfiguredProductLine = {
  id: number;
  code: string;
  name: string;
  status: ChannelStatus;
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
};

type ChannelSummary = {
  id: number;
  code: string;
  name: string;
  productType: "api" | "coding_plan";
  shareMode: string;
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

type ChannelEditSnapshot = {
  name: string;
  supportedProtocols: RelayProtocol[];
  status: ChannelStatus;
};

type ParsedKey = {
  lineNo: number;
  label: string;
  secret: string;
  hasCustomLabel: boolean;
};

type KeyTableRef = {
  clearSelection: () => void;
  toggleRowSelection: (row: CredentialRow, selected?: boolean) => void;
};

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const canWrite = computed(() => auth.isAdmin);

const KEY_PAGE_SIZE = 5;
const rows = ref<CredentialRow[]>([]);
const templates = ref<ProviderTemplate[]>([]);
const loading = ref(false);
const selectedProductLineId = ref<number | null>(null);
const syncingQuery = ref(false);
const keyTableRef = ref<KeyTableRef | null>(null);
const selectedKeyRows = ref<CredentialRow[]>([]);
const keyPage = ref(1);

const showBulkForm = ref(false);
const bulkSaving = ref(false);

const showChannelEdit = ref(false);
const channelEditSaving = ref(false);
const channelEditProtocolConfigs = ref<RelayProtocolConfigs>({});
const channelEditProtocolsTouched = ref(false);
const channelEditRoutingConfigDrift = ref(false);
const channelEditRoutingUpgradeRequested = ref(false);
const channelEditOriginal = ref<ChannelEditSnapshot | null>(null);

const showKeyDetails = ref(false);
const detailCredentialId = ref<number | null>(null);
const showChannelDetails = ref(false);
const channelSummaryLoading = ref(false);
const channelSummaries = ref(new Map<number, ChannelSummary>());

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
  name: "",
  rawKeys: "",
  supportedProtocols: ["openai_chat"] as RelayProtocol[],
  status: "active" as ChannelStatus,
});

const channelEditForm = reactive({
  id: 0,
  configVersion: 0,
  name: "",
  supportedProtocols: [] as RelayProtocol[],
  status: "active" as ChannelStatus,
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
    };
  });
});

const selectedChannel = computed(
  () => channels.value.find((channel) => channel.id === selectedProductLineId.value) ?? null,
);

const pagedKeys = computed(() => {
  const keys = selectedChannel.value?.keys ?? [];
  const start = (keyPage.value - 1) * KEY_PAGE_SIZE;
  return keys.slice(start, start + KEY_PAGE_SIZE);
});

const selectedChannelSummary = computed(
  () => selectedProductLineId.value == null
    ? null
    : channelSummaries.value.get(selectedProductLineId.value) ?? null,
);

const channelEditTarget = computed(
  () => channels.value.find((channel) => channel.id === channelEditForm.id) ?? null,
);

const detailRow = computed(
  () => rows.value.find((row) => row.id === detailCredentialId.value) ?? null,
);

const selectedBulkTemplate = computed(
  () => templates.value.find((template) => template.code === bulkForm.providerCode),
);

const bulkBaseUrlOptions = computed(() => selectedBulkTemplate.value?.baseUrls ?? []);

const selectedBulkBaseUrlOption = computed(
  () => bulkBaseUrlOptions.value.find((option) => option.url === bulkForm.baseUrl) ?? null,
);

const selectedConfiguredProductLine = computed<ConfiguredProductLine | null>(() => {
  const option = selectedBulkBaseUrlOption.value;
  if (!option) return null;
  return selectedBulkTemplate.value?.productLines?.find(
    (line) => line.code === option.productLineCode,
  ) ?? null;
});

const bulkProtocolConfigs = computed<RelayProtocolConfigs>(() => (
  selectedBulkBaseUrlOption.value && selectedBulkTemplate.value
    ? providerOptionProtocolConfigs(selectedBulkBaseUrlOption.value, selectedBulkTemplate.value)
    : {}
));

const importTargetChannel = computed(
  () => channels.value.find((channel) => channel.id === bulkForm.productLineId) ?? null,
);

const importChannelLabel = computed(() => {
  if (importTargetChannel.value) return channelDisplayName(importTargetChannel.value);
  const option = bulkBaseUrlOptions.value.find((item) => item.url === bulkForm.baseUrl);
  if (option && selectedBulkTemplate.value) {
    return formatChannelName(selectedBulkTemplate.value.name, option.productLineName);
  }
  return selectedBulkTemplate.value
    ? templateDisplayName(selectedBulkTemplate.value)
    : "API Key";
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

  const requestedChannelId = parseQueryId(route.query.channelId);
  if (requestedChannelId != null && channels.value.some((channel) => channel.id === requestedChannelId)) {
    selectedProductLineId.value = requestedChannelId;
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
  if (current === id) return;
  syncingQuery.value = true;
  const query = { ...route.query };
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
  keyPage.value = 1;
  syncSelectedToQuery(id);
  clearSelectedKeys();
  if (detailRow.value && detailRow.value.productLineId !== id) {
    showKeyDetails.value = false;
  }
  showChannelDetails.value = false;
});

watch(
  () => selectedChannel.value?.keys.length ?? 0,
  (total) => {
    const maxPage = Math.max(1, Math.ceil(total / KEY_PAGE_SIZE));
    if (keyPage.value > maxPage) keyPage.value = maxPage;
  },
);

watch(() => route.query.channelId, () => {
  if (syncingQuery.value) return;
  reconcileSelection();
});

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
  const keys = selectedChannel.value?.keys ?? [];
  const idSet = new Set(ids);
  const createdRows = keys.filter((row) => idSet.has(row.id));
  if (!createdRows.length) return;
  const firstIndex = keys.findIndex((row) => row.id === createdRows[0].id);
  if (firstIndex >= 0) {
    keyPage.value = Math.floor(firstIndex / KEY_PAGE_SIZE) + 1;
  }
  await nextTick();
  keyTableRef.value?.clearSelection();
  const visibleIds = new Set(pagedKeys.value.map((row) => row.id));
  for (const row of createdRows) {
    if (visibleIds.has(row.id)) keyTableRef.value?.toggleRowSelection(row, true);
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  const responseMessage = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof responseMessage === "string" ? responseMessage : fallback;
}

function getErrorCode(error: unknown): string | undefined {
  const responseCode = (error as { response?: { data?: { code?: unknown } } })
    ?.response?.data?.code;
  return typeof responseCode === "string" ? responseCode : undefined;
}

function protocolSignature(protocols: RelayProtocol[]): string {
  return [...protocols].sort().join(",");
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

function configurableProtocols(protocols: readonly RelayProtocol[]): RelayProtocol[] {
  const configured = new Set(protocols);
  return relayProtocolOptions
    .map((option) => option.value)
    .filter((protocol) => configured.has(protocol));
}

function isValidProtocolConfig(
  config: RelayProtocolConfigs[RelayProtocol],
): config is { baseUrl: string; authStyle: RelayAuthStyle } {
  return Boolean(
    config
      && isValidHttpBaseUrl(config.baseUrl)
      && (config.authStyle === "bearer" || config.authStyle === "x-api-key"),
  );
}

function providerOptionProtocolConfigs(
  option: ProviderBaseUrl,
  template: ProviderTemplate,
): RelayProtocolConfigs {
  const result: RelayProtocolConfigs = {};
  for (const protocol of RELAY_PROTOCOLS) {
    const config = option.protocolConfigs?.[protocol];
    if (isValidProtocolConfig(config)) result[protocol] = { ...config };
  }
  if (Object.keys(result).length) return result;

  // Compatibility for a briefly deployed template shape that had one URL and
  // provider-level auth. New templates always send protocolConfigs.
  const authStyle = template.authStyle ?? "bearer";
  for (const protocol of configurableProtocols(template.defaultProtocols)) {
    result[protocol] = { baseUrl: option.url, authStyle };
  }
  return result;
}

function initialOptionProtocols(
  option: ProviderBaseUrl,
  template: ProviderTemplate,
): RelayProtocol[] {
  const configs = providerOptionProtocolConfigs(option, template);
  const available = relayProtocolOptions
    .map((protocolOption) => protocolOption.value)
    .filter((protocol) => isValidProtocolConfig(configs[protocol]));
  const preferred = configurableProtocols(template.defaultProtocols)
    .filter((protocol) => available.includes(protocol));
  return preferred.length ? preferred : available;
}

function resolveTemplateOptionForChannel(
  template: ProviderTemplate,
  productLineCode: string,
): ProviderBaseUrl | undefined {
  return template.baseUrls.find((option) => option.productLineCode === productLineCode)
    // Mirrors the backend compatibility rule for GLM product lines created
    // before protocol-specific routing metadata existed.
    ?? (template.code === "glm" ? template.baseUrls[0] : undefined);
}

function protocolsHaveConfigs(
  protocols: readonly RelayProtocol[],
  configs: RelayProtocolConfigs,
): boolean {
  return protocols.every((protocol) => isValidProtocolConfig(configs[protocol]));
}

function protocolConfigsMatch(
  protocols: readonly RelayProtocol[],
  current: RelayProtocolConfigs,
  target: RelayProtocolConfigs,
): boolean {
  return protocols.every((protocol) => {
    const currentConfig = current[protocol];
    const targetConfig = target[protocol];
    if (!isValidProtocolConfig(currentConfig) || !isValidProtocolConfig(targetConfig)) {
      return false;
    }
    return currentConfig.baseUrl.trim().replace(/\/+$/, "")
        === targetConfig.baseUrl.trim().replace(/\/+$/, "")
      && currentConfig.authStyle === targetConfig.authStyle;
  });
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

/** 公司名称/模型名称，如 智谱/GLM、深度求索/DeepSeek */
function formatChannelName(companyName: string, modelName: string): string {
  const company = companyName.trim();
  const model = modelName.trim();
  if (!company) return model;
  if (!model) return company;
  if (company === model || model.startsWith(`${company}/`)) return model;
  return `${company}/${model}`;
}

function templateDisplayName(template: ProviderTemplate): string {
  return formatChannelName(template.name, template.modelName || template.shortName);
}

function channelDisplayName(
  channel: Pick<ChannelGroup, "providerName" | "productLineName"> | Pick<CredentialRow, "providerName" | "productLineName">,
): string {
  return formatChannelName(channel.providerName, channel.productLineName);
}

function baseUrlOptionLabel(option: ProviderBaseUrl): string {
  const template = selectedBulkTemplate.value;
  const channelName = template
    ? formatChannelName(template.name, option.productLineName)
    : option.productLineName;
  const configured = template?.productLines?.some(
    (line) => line.code === option.productLineCode,
  );
  return `${channelName} · ${option.label}${configured ? "（已配置）" : ""}`;
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

function channelStatusText(channel: ChannelGroup): string {
  return channel.providerStatus === "active" && channel.productLineStatus === "active"
    ? "启用"
    : "停用";
}

function channelStatusType(channel: ChannelGroup): "success" | "danger" {
  return channelStatusText(channel) === "启用" ? "success" : "danger";
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
    channelSummaries.value = new Map();
    clearSelectedKeys();
  }
}

async function openChannelDetails(channel: ChannelGroup) {
  selectedProductLineId.value = channel.id;
  showChannelDetails.value = true;
  if (channelSummaries.value.has(channel.id)) return;
  channelSummaryLoading.value = true;
  try {
    const { data } = await http.get(`/api/admin/product-lines/${channel.id}/summary`);
    if (data.success) {
      const next = new Map(channelSummaries.value);
      next.set(channel.id, data.data);
      channelSummaries.value = next;
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "渠道详情加载失败"));
  } finally {
    channelSummaryLoading.value = false;
  }
}

async function loadMeta() {
  const templateResponse = await http.get("/api/admin/credential-templates");
  if (templateResponse.data.success) templates.value = templateResponse.data.data;
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

function resetBulkForm() {
  const first = templates.value[0];
  const firstOption = first?.baseUrls[0];
  bulkForm.productLineId = null;
  bulkForm.providerCode = first?.code ?? "glm";
  bulkForm.baseUrl = firstOption?.url ?? "";
  bulkForm.name = firstOption?.productLineName ?? first?.modelName ?? "";
  bulkForm.rawKeys = "";
  bulkForm.status = "active";
  bulkForm.supportedProtocols = first && firstOption
    ? initialOptionProtocols(firstOption, first)
    : ["openai_chat"];
}

function openCreateChannel() {
  resetBulkForm();
  showBulkForm.value = true;
}

function openEditChannel(channel: ChannelGroup) {
  if (!canWrite.value || channelEditSaving.value) return;
  const template = templates.value.find((item) => item.code === channel.providerCode);
  const option = template
    ? resolveTemplateOptionForChannel(template, channel.productLineCode)
    : undefined;
  const templateConfigs = template && option
    ? providerOptionProtocolConfigs(option, template)
    : {};
  const selectedConfigurableProtocols = configurableProtocols(channel.protocols);

  channelEditForm.id = channel.id;
  channelEditForm.configVersion = channel.configVersion;
  channelEditForm.name = channel.productLineName;
  channelEditForm.supportedProtocols = selectedConfigurableProtocols;
  channelEditForm.status = channel.productLineStatus;
  channelEditProtocolConfigs.value = Object.keys(templateConfigs).length
    ? templateConfigs
    : { ...channel.protocolConfigs };
  channelEditProtocolsTouched.value = false;
  channelEditRoutingUpgradeRequested.value = false;
  channelEditRoutingConfigDrift.value = Boolean(
    selectedConfigurableProtocols.length
      && template
      && option
      && protocolsHaveConfigs(selectedConfigurableProtocols, templateConfigs)
      && !protocolConfigsMatch(
        selectedConfigurableProtocols,
        channel.protocolConfigs,
        templateConfigs,
      ),
  );
  channelEditOriginal.value = {
    name: channel.productLineName,
    supportedProtocols: [...channel.protocols],
    status: channel.productLineStatus,
  };
  showChannelEdit.value = true;
}

async function saveChannelEdit() {
  if (!canWrite.value || channelEditSaving.value) return;

  const productLineId = channelEditForm.id;
  const name = channelEditForm.name.trim();
  const original = channelEditOriginal.value;
  if (!productLineId) {
    ElMessage.error("未找到要编辑的渠道");
    return;
  }
  if (!original) {
    ElMessage.error("渠道原始配置已失效，请重新打开编辑窗口");
    return;
  }
  if (!name) {
    ElMessage.warning("请输入渠道名称");
    return;
  }
  if (name.length > 100) {
    ElMessage.warning("渠道名称不能超过 100 个字符");
    return;
  }

  const originalSelectableProtocols = configurableProtocols(original.supportedProtocols);
  const selectableProtocolsChanged = protocolSignature(channelEditForm.supportedProtocols)
    !== protocolSignature(originalSelectableProtocols);
  const explicitlyUpgradingDrift = channelEditRoutingConfigDrift.value
    && (channelEditProtocolsTouched.value || channelEditRoutingUpgradeRequested.value);
  const shouldSendProtocols = selectableProtocolsChanged
    || explicitlyUpgradingDrift;
  if (shouldSendProtocols && !channelEditForm.supportedProtocols.length) {
    ElMessage.warning("请至少选择一种支持协议");
    return;
  }
  if (
    shouldSendProtocols
    && !protocolsHaveConfigs(channelEditForm.supportedProtocols, channelEditProtocolConfigs.value)
  ) {
    ElMessage.warning("所选协议缺少有效的 URL 或鉴权配置");
    return;
  }

  const payload: Record<string, unknown> = {
    expectedConfigVersion: channelEditForm.configVersion,
  };
  if (name !== original.name) payload.name = name;
  if (channelEditForm.status !== original.status) payload.status = channelEditForm.status;
  if (shouldSendProtocols) {
    payload.supportedProtocols = [...channelEditForm.supportedProtocols];
  }
  if (Object.keys(payload).length === 1) {
    ElMessage.info("未检测到需要保存的修改");
    return;
  }

  channelEditSaving.value = true;
  try {
    await http.patch(`/api/admin/product-lines/${productLineId}`, payload);
    await loadCredentials();
    if (channels.value.some((channel) => channel.id === productLineId)) {
      selectedProductLineId.value = productLineId;
      syncSelectedToQuery(productLineId);
    }
    showChannelEdit.value = false;
    ElMessage.success("渠道已更新");
  } catch (error) {
    if (getErrorCode(error) === "CHANNEL_CONFIG_STALE") {
      showChannelEdit.value = false;
      await Promise.all([loadCredentials(), loadMeta()]).catch(() => undefined);
      if (channels.value.some((channel) => channel.id === productLineId)) {
        selectedProductLineId.value = productLineId;
        syncSelectedToQuery(productLineId);
      }
      ElMessage.warning("渠道已被其他管理员更新，请刷新后重试");
    } else {
      ElMessage.error(getErrorMessage(error, "渠道更新失败"));
    }
  } finally {
    channelEditSaving.value = false;
  }
}

function openAddKeys(channel: ChannelGroup) {
  resetBulkForm();
  bulkForm.productLineId = channel.id;
  bulkForm.providerCode = channel.providerCode as ProviderTemplateCode;
  bulkForm.baseUrl = channel.baseUrl;
  bulkForm.name = channel.productLineName;
  bulkForm.supportedProtocols = [...channel.protocols];
  bulkForm.status = channel.productLineStatus;
  showBulkForm.value = true;
}

function selectBulkTemplate(template: ProviderTemplate) {
  const option = template.baseUrls[0];
  bulkForm.providerCode = template.code;
  bulkForm.baseUrl = option?.url ?? "";
  bulkForm.name = option?.productLineName ?? template.modelName;
  bulkForm.supportedProtocols = option ? initialOptionProtocols(option, template) : [];
}

function selectBulkVariant() {
  const option = selectedBulkBaseUrlOption.value;
  const template = selectedBulkTemplate.value;
  if (!option || !template) return;
  bulkForm.name = option.productLineName;
  bulkForm.supportedProtocols = initialOptionProtocols(option, template);
}

function useConfiguredVariant() {
  const configured = selectedConfiguredProductLine.value;
  const option = selectedBulkBaseUrlOption.value;
  const template = selectedBulkTemplate.value;
  if (!configured || !option || !template) return;

  const channel = channels.value.find((item) => item.id === configured.id);
  bulkForm.productLineId = configured.id;
  bulkForm.name = channel?.productLineName ?? configured.name;
  bulkForm.supportedProtocols = channel
    ? [...channel.protocols]
    : initialOptionProtocols(option, template);
  if (channel) {
    bulkForm.status = channel.productLineStatus;
  }
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
  const creatingChannel = !bulkForm.productLineId;
  const selectedOption = selectedBulkBaseUrlOption.value;
  if (!parsed.keys.length) {
    ElMessage.warning("请粘贴至少一个 API Key");
    return;
  }
  if (parsed.errors.length) {
    ElMessage.warning("请先修正 Key 格式错误");
    return;
  }
  if (creatingChannel && !bulkForm.supportedProtocols.length) {
    ElMessage.warning("请至少选择一种支持协议");
    return;
  }
  if (creatingChannel) {
    const name = bulkForm.name.trim();
    if (selectedConfiguredProductLine.value) {
      ElMessage.warning("该渠道变体已经存在，请改为向现有渠道添加 Key");
      return;
    }
    if (!name) {
      ElMessage.warning("请输入渠道名称");
      return;
    }
    if (name.length > 100) {
      ElMessage.warning("渠道名称不能超过 100 个字符");
      return;
    }
    if (!selectedOption) {
      ElMessage.warning("请选择渠道变体");
      return;
    }
    if (!protocolsHaveConfigs(bulkForm.supportedProtocols, bulkProtocolConfigs.value)) {
      ElMessage.warning("所选协议缺少有效的 URL 或鉴权配置");
      return;
    }
  }

  bulkSaving.value = true;
  try {
    const payload = {
      ...(bulkForm.productLineId
        ? { productLineId: bulkForm.productLineId }
        : {
          providerCode: bulkForm.providerCode,
          // Legacy locator only; protocolConfigs determine actual upstream URLs.
          baseUrl: selectedOption!.url,
          name: bulkForm.name.trim(),
          status: bulkForm.status,
        }),
      keys: parsed.keys.map(({ label, secret, hasCustomLabel }) => (
        hasCustomLabel ? { label, secret } : { secret }
      )),
      ...(!bulkForm.productLineId
        ? { supportedProtocols: [...bulkForm.supportedProtocols] }
        : {}),
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
    if (creatingChannel) {
      await Promise.all([loadCredentials(), loadMeta()]);
    } else {
      await loadCredentials();
    }
    if (Number.isInteger(targetId) && channels.value.some((channel) => channel.id === targetId)) {
      selectedProductLineId.value = targetId;
    } else if (!bulkForm.productLineId) {
      const createdChannel = channels.value.find(
        (channel) => channel.providerCode === bulkForm.providerCode
          && channel.productLineCode === selectedOption?.productLineCode,
      );
      if (createdChannel) selectedProductLineId.value = createdChannel.id;
    }
    await nextTick();
    await selectKeysByIds(createdIds);
    ElMessage.success({
      message: `已导入 ${createdCount} 个 Key，并自动选中。请点击“批量测试”确认上游连接可用。`,
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
  const channelConfirmName = channelDisplayName(channel);
  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${targets.length} 个 Key？删除后不可恢复，历史调用日志仍会保留。`,
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
}

function closeKeyDetails() {
  detailCredentialId.value = null;
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

.channel-summary-body {
  min-height: 280px;
}

.channel-summary-head {
  margin-bottom: 16px;
}

.url-value {
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.drawer-overview {
  margin: 0;
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

.pager {
  display: flex;
  justify-content: flex-end;
  padding: 10px 14px 12px;
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

.editing-context > div {
  flex: 1;
  min-width: 0;
}

.channel-edit-context {
  margin-bottom: 18px;
}

.configured-variant-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -2px 0 18px;
}

.configured-variant-notice :deep(.el-alert) {
  flex: 1;
  min-width: 0;
}

.cell-secondary {
  margin-top: 3px;
  color: #94a3b8;
  font-size: 12px;
}

.credential-form {
  margin-top: 4px;
}

.credential-dialog :deep(.el-dialog__body) {
  max-height: calc(100vh - 180px);
  overflow-y: auto;
}

.protocol-form-item :deep(.el-form-item__content) {
  display: block;
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

  .configured-variant-notice {
    align-items: stretch;
    flex-direction: column;
  }

  .provider-grid,
  .info-grid {
    grid-template-columns: 1fr;
  }

}
</style>
