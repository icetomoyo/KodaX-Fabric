<template>
  <div class="keys-page">
    <section class="page-card">
      <div class="page-head">
        <div>
          <h2 class="page-title">API Key</h2>
          <p class="page-subtitle">每把 Key 固定使用一个上游渠道，明文仅在创建完成时展示一次</p>
        </div>
        <el-button type="primary" :disabled="!canIssueKey" @click="openCreate">创建 Key</el-button>
      </div>
      <el-alert
        v-if="!hasTeam"
        class="join-alert"
        title="尚未加入团队，没有员工权限。请等待团队管理员用你的注册手机号邀请。"
        type="warning"
        show-icon
        :closable="false"
      />

      <el-table v-loading="loading" :data="keys" stripe empty-text="暂无 API Key">
        <el-table-column label="团队" min-width="140">
          <template #default="{ row }">
            {{ row.teamName || "未绑定团队" }}
          </template>
        </el-table-column>
        <el-table-column label="名称" min-width="140">
          <template #default="{ row }">
            <span class="key-name">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="协议" min-width="140">
          <template #default="{ row }">
            {{ relayProtocolLabel(row.protocol, true) }}
          </template>
        </el-table-column>
        <el-table-column label="上游渠道" min-width="210">
          <template #default="{ row }">
            {{ keyChannelLabel(row) }}
          </template>
        </el-table-column>
        <el-table-column label="首Token延迟" min-width="120">
          <template #default="{ row }">
            <span v-if="row.metrics?.requestCount" class="metric-value">
              {{ row.metrics.avgTtftMs }} ms
            </span>
            <span v-else class="metric-empty">—</span>
          </template>
        </el-table-column>
        <el-table-column label="生成速度" min-width="120">
          <template #default="{ row }">
            <span v-if="row.metrics?.requestCount" class="metric-value">
              {{ row.metrics.avgTokensPerSecond }} tok/s
            </span>
            <span v-else class="metric-empty">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag
              :type="row.status === 'active' ? 'success' : 'info'"
              size="small"
              effect="light"
            >
              {{ keyStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              type="danger"
              :loading="deletingId === row.id"
              @click="removeKey(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog
      v-model="showCreate"
      :title="createdResult ? '复制新 API Key' : '创建 API Key'"
      width="560px"
      destroy-on-close
      :close-on-click-modal="!creating"
      :close-on-press-escape="!creating"
      :before-close="handleCreateBeforeClose"
      @closed="onCreateClosed"
    >
      <div v-if="createdResult" class="create-result">
        <el-alert
          title="API Key 已创建，请立即复制；关闭后无法再次查看"
          type="warning"
          :closable="false"
          show-icon
        />

        <dl class="result-meta">
          <div>
            <dt>名称</dt>
            <dd>{{ createdResult.name }}</dd>
          </div>
          <div>
            <dt>上游渠道</dt>
            <dd>{{ channelLabel({ providerName: createdResult.providerName, productLineName: createdResult.productLineName }) }}</dd>
          </div>
          <div>
            <dt>协议</dt>
            <dd>{{ relayProtocolLabel(createdResult.protocol) }}</dd>
          </div>
        </dl>

        <div class="secret-label">API Key（仅显示一次）</div>
        <div class="secret-box">
          <el-input
            :model-value="createdResult.key"
            readonly
            class="secret-input"
            aria-label="新创建的 API Key，仅显示一次"
            @focus="selectSecretInput"
          />
          <el-button
            type="primary"
            :loading="copyingCreatedKey"
            @click="copyCreatedKey"
          >
            复制 API Key
          </el-button>
        </div>
        <p class="result-tip">
          请立即复制并保存到密码管理器或客户端配置中；关闭后无法再次查看。
        </p>
      </div>

      <div v-else class="create-form-state">
        <el-skeleton v-if="channelsLoading" :rows="4" animated />

        <div v-else-if="channelsError" class="channel-state">
          <el-alert
            :title="channelsError"
            type="error"
            :closable="false"
            show-icon
          />
          <el-button :loading="channelsLoading" @click="loadChannels">重新加载</el-button>
        </div>

        <el-empty
          v-else-if="upstreamChannels.length === 0"
          description="暂无可用上游渠道，请联系管理员在“上游渠道”中配置并授权"
          :image-size="72"
        />

        <el-form v-else label-position="top" @submit.prevent>
          <el-form-item label="1. 所属团队" required>
            <el-select
              v-model="createForm.teamId"
              placeholder="请选择团队"
              style="width: 100%"
              :disabled="creating"
            >
              <el-option
                v-for="team in teams"
                :key="team.id"
                :label="team.name"
                :value="team.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="2. 上游渠道" required>
            <el-select
              v-model="createForm.productLineId"
              placeholder="请选择上游渠道"
              style="width: 100%"
              :disabled="creating"
              @change="onChannelChange"
            >
              <el-option
                v-for="channel in upstreamChannels"
                :key="channel.productLineId"
                :label="channelLabel(channel)"
                :value="channel.productLineId"
              />
            </el-select>
            <div v-if="selectedChannel" class="channel-hint">
              {{ selectedChannel.productType === "coding_plan" ? "Coding Plan" : "标准 API" }}
              · {{ selectedChannel.credentialCount }} 个可用凭证
            </div>
          </el-form-item>

          <el-form-item label="3. 兼容协议" required class="protocol-form-item">
            <el-radio-group
              v-model="createForm.protocol"
              class="protocol-radio-group"
              :disabled="creating || !selectedChannel"
            >
              <el-radio
                v-for="option in protocolChoiceOptions"
                :key="option.value"
                :value="option.value"
                :disabled="!option.available"
                border
                class="protocol-radio-option"
              >
                <span class="protocol-option-copy">
                  <strong>{{ option.displayLabel }}</strong>
                  <small>{{ option.description }}</small>
                  <code>{{ option.endpoint }}</code>
                </span>
              </el-radio>
            </el-radio-group>

            <div v-if="!selectedChannel" class="form-help">
              请先选择上游渠道；协议决定客户端请求接口与鉴权方式。
            </div>
            <div v-else-if="compatibleProtocolOptions.length === 0" class="form-help">
              该渠道暂无兼容协议，请联系管理员检查渠道 Key 的协议声明。
            </div>
            <div v-else class="form-help">
              一把 Key 只能绑定一种协议；请按客户端实际协议选择，创建后不可修改。
            </div>

            <el-alert
              v-if="selectedChannel && compatibleProtocolOptions.length === 0"
              class="protocol-empty"
              title="该渠道暂无兼容协议，请联系管理员检查渠道 Key 的协议声明"
              type="warning"
              :closable="false"
            />

            <div v-if="selectedProtocolGuide" class="protocol-guide">
              <div class="protocol-guide-head">
                <strong>{{ selectedProtocolGuide.shortLabel }}</strong>
                <el-tag size="small" effect="plain">已选协议</el-tag>
              </div>
              <div class="protocol-guide-row">
                <span>适用客户端</span>
                <span>{{ selectedProtocolGuide.recommendedClients.join("、") }}</span>
              </div>
              <div class="protocol-guide-row">
                <span>请求接口</span>
                <code>{{ selectedProtocolGuide.endpoint }}</code>
              </div>
              <div class="protocol-guide-row">
                <span>鉴权 Header</span>
                <div class="protocol-guide-lines">
                  <code
                    v-for="line in selectedProtocolGuide.authHeaders"
                    :key="line"
                  >{{ line }}</code>
                </div>
              </div>
              <p class="protocol-guide-hint">
                一种客户端建议一把 Key。完整步骤见
                <router-link to="/me/guide">接入教程</router-link>。
              </p>
            </div>
          </el-form-item>

          <el-form-item label="4. 名称" required>
            <el-input
              v-model="createForm.name"
              maxlength="100"
              show-word-limit
              placeholder="例如：本机 Cursor"
              :disabled="creating"
            />
          </el-form-item>

          <div v-if="submitError" class="submit-error">
            <el-alert :title="submitError" type="error" :closable="false" show-icon />
            <el-button link type="primary" @click="loadChannels">刷新渠道列表</el-button>
          </div>
        </el-form>
      </div>

      <template #footer>
        <template v-if="createdResult">
          <el-button
            type="primary"
            @click="requestCreateClose"
          >
            完成，关闭
          </el-button>
        </template>
        <template v-else>
          <el-button :disabled="creating" @click="requestCreateClose">取消</el-button>
          <el-button
            type="primary"
            :loading="creating"
            :disabled="!canCreate"
            @click="createKey"
          >
            创建
          </el-button>
        </template>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { useAuthStore } from "@/stores/auth";
import { copyText } from "@/lib/clipboard";
import {
  relayProtocolLabel,
  relayProtocolOption,
  relayProtocolOptions,
  type RelayProtocol,
} from "@/views/relay-protocol";

const auth = useAuthStore();
const teams = ref<Array<{ id: number; name: string }>>([]);
const hasTeam = computed(() => teams.value.length > 0);
const canIssueKey = computed(() => hasTeam.value);

type KeyRow = {
  id: number;
  name: string;
  keyPrefix: string;
  protocol: RelayProtocol;
  productLineId: number;
  teamId?: number | null;
  teamName?: string | null;
  productLineName: string;
  providerCode: string;
  providerName: string;
  status: string;
  createdAt: string;
  lastUsedAt?: string | null;
  metrics?: {
    requestCount: number;
    avgTtftMs: number;
    avgTokensPerSecond: number;
  } | null;
};

type UpstreamChannel = {
  productLineId: number;
  productLineCode: string;
  productLineName: string;
  productType: "api" | "coding_plan" | string;
  providerId: number;
  providerCode: string;
  providerName: string;
  compatibleProtocols: RelayProtocol[];
  credentialCount: number;
};

type CreatedKeyResult = {
  id: number;
  name: string;
  key: string;
  keyPrefix: string;
  protocol: RelayProtocol;
  productLineId: number;
  productLineName: string;
  providerName: string;
};

const keys = ref<KeyRow[]>([]);
const loading = ref(false);
const creating = ref(false);
const deletingId = ref<number | null>(null);
const showCreate = ref(false);
const channelsLoading = ref(false);
const channelsError = ref("");
const submitError = ref("");
const upstreamChannels = ref<UpstreamChannel[]>([]);
const createdResult = ref<CreatedKeyResult | null>(null);
const copyingCreatedKey = ref(false);
const createForm = reactive({
  name: "",
  teamId: null as number | null,
  productLineId: null as number | null,
  protocol: null as RelayProtocol | null,
});
let channelRequestSequence = 0;

const selectedChannel = computed(() =>
  upstreamChannels.value.find(
    (channel) => channel.productLineId === createForm.productLineId,
  ) ?? null,
);

const compatibleProtocolOptions = computed(() => {
  const protocols = selectedChannel.value?.compatibleProtocols ?? [];
  return relayProtocolOptions.filter((option) => protocols.includes(option.value));
});

/** Card choices mirror admin channel protocol picker; unavailable ones stay visible but disabled. */
const protocolChoiceOptions = computed(() => {
  const available = new Set(
    (selectedChannel.value?.compatibleProtocols ?? []) as RelayProtocol[],
  );
  return relayProtocolOptions.map((option) => {
    const isAvailable = selectedChannel.value
      ? available.has(option.value)
      : false;
    return {
      ...option,
      available: isAvailable,
      displayLabel: isAvailable
        ? option.label
        : selectedChannel.value
          ? `${option.label}（当前渠道不支持）`
          : option.label,
    };
  });
});

const selectedProtocolGuide = computed(() => {
  if (!createForm.protocol) return null;
  if (!compatibleProtocolOptions.value.some((option) => option.value === createForm.protocol)) {
    return null;
  }
  return relayProtocolOption(createForm.protocol);
});

const canCreate = computed(() =>
  !channelsLoading.value
  && !channelsError.value
  && Boolean(createForm.teamId)
  && Boolean(createForm.name.trim())
  && Boolean(selectedChannel.value)
  && Boolean(createForm.protocol)
  && compatibleProtocolOptions.value.some(
    (option) => option.value === createForm.protocol,
  ),
);

function getErrorMessage(error: unknown, fallback: string): string {
  const responseMessage = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function keyStatusLabel(status: string) {
  return status === "active" ? "正常" : status === "revoked" ? "已吊销" : status;
}

async function loadTeams() {
  try {
    const { data } = await http.get("/api/me/org");
    if (data.success) teams.value = Array.isArray(data.data?.teams) ? data.data.teams : [];
  } catch {
    teams.value = [];
  }
}

async function load() {
  loading.value = true;
  try {
    await loadTeams();
    const { data } = await http.get("/api/me/api-keys");
    if (data.success) keys.value = Array.isArray(data.data) ? data.data : [];
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "加载 API Key 失败"));
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  resetCreateState();
  showCreate.value = true;
  void loadChannels();
}

function onCreateClosed() {
  resetCreateState();
}

function resetCreateState() {
  channelRequestSequence += 1;
  createForm.name = "";
  createForm.teamId = teams.value.length === 1 ? teams.value[0].id : null;
  createForm.productLineId = null;
  createForm.protocol = null;
  upstreamChannels.value = [];
  channelsError.value = "";
  submitError.value = "";
  createdResult.value = null;
  copyingCreatedKey.value = false;
  channelsLoading.value = false;
}

/** 公司名称/模型名称，如 智谱/GLM、深度求索/DeepSeek */
function channelLabel(channel: Pick<UpstreamChannel, "providerName" | "productLineName">): string {
  const company = channel.providerName.trim();
  const model = channel.productLineName.trim();
  if (!company) return model;
  if (!model) return company;
  if (company === model || model.startsWith(`${company}/`)) return model;
  return `${company}/${model}`;
}

function keyChannelLabel(row: KeyRow): string {
  return channelLabel(row);
}

function onChannelChange(productLineId: number | null) {
  submitError.value = "";
  const channel = upstreamChannels.value.find(
    (item) => item.productLineId === productLineId,
  );
  createForm.protocol = channel?.compatibleProtocols[0] ?? null;
}

async function loadChannels() {
  const requestId = ++channelRequestSequence;
  channelsLoading.value = true;
  channelsError.value = "";
  submitError.value = "";
  createForm.productLineId = null;
  createForm.protocol = null;
  try {
    const { data } = await http.get("/api/me/upstream-channels");
    if (requestId !== channelRequestSequence) return;
    if (!data.success) throw new Error(data.message || "加载上游渠道失败");
    upstreamChannels.value = Array.isArray(data.data) ? data.data : [];
  } catch (error) {
    if (requestId !== channelRequestSequence) return;
    upstreamChannels.value = [];
    channelsError.value = getErrorMessage(error, "加载上游渠道失败，请稍后重试");
  } finally {
    if (requestId === channelRequestSequence) channelsLoading.value = false;
  }
}

function requestCreateClose() {
  if (creating.value) {
    ElMessage.warning("API Key 正在创建，请稍候");
    return;
  }
  showCreate.value = false;
}

function handleCreateBeforeClose(done: () => void) {
  if (creating.value) {
    ElMessage.warning("API Key 正在创建，请稍候");
    return;
  }
  done();
}

async function createKey() {
  if (!selectedChannel.value) {
    ElMessage.warning("请选择上游渠道");
    return;
  }
  if (
    !createForm.protocol
    || !compatibleProtocolOptions.value.some(
      (option) => option.value === createForm.protocol,
    )
  ) {
    ElMessage.warning("请选择该渠道支持的兼容协议");
    return;
  }
  if (!createForm.name.trim()) {
    ElMessage.warning("请填写名称");
    return;
  }
  if (!createForm.teamId) {
    ElMessage.warning("请选择团队");
    return;
  }

  const channel = selectedChannel.value;
  const protocol = createForm.protocol;
  const name = createForm.name.trim();
  submitError.value = "";
  creating.value = true;
  try {
    const { data } = await http.post("/api/me/api-keys", {
      name,
      teamId: createForm.teamId,
      productLineId: channel.productLineId,
      protocol,
    });
    if (!data.success) throw new Error(data.message || "创建失败");
    if (typeof data.data?.key !== "string" || data.data.key.length === 0) {
      throw new Error("API Key 已创建，但服务端未返回明文，请立即联系管理员");
    }

    createdResult.value = {
      id: Number(data.data.id),
      name: typeof data.data.name === "string" ? data.data.name : name,
      key: data.data.key,
      keyPrefix: typeof data.data.keyPrefix === "string" ? data.data.keyPrefix : "",
      protocol,
      productLineId: channel.productLineId,
      productLineName:
        typeof data.data.productLineName === "string"
          ? data.data.productLineName
          : channel.productLineName,
      providerName:
        typeof data.data.providerName === "string"
          ? data.data.providerName
          : channel.providerName,
    };
    void load();
  } catch (error) {
    const errorCode = (error as {
      response?: { data?: { code?: unknown } };
    })?.response?.data?.code;
    if (errorCode === "channel_protocol_incompatible") {
      submitError.value = "所选协议与上游渠道不兼容，请刷新渠道列表后重新选择";
    } else if (errorCode === "upstream_channel_unavailable") {
      submitError.value = "上游渠道不可用，请刷新后重新选择";
    } else {
      submitError.value = getErrorMessage(error, "创建失败");
    }
    ElMessage.error(submitError.value);
  } finally {
    creating.value = false;
  }
}

function selectSecretInput(event: FocusEvent) {
  const target = event.target;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    target.select();
  }
}

async function copyCreatedKey() {
  if (!createdResult.value) return;
  copyingCreatedKey.value = true;
  try {
    const copied = await copyText(createdResult.value.key);
    if (copied) {
      ElMessage.success("API Key 已复制");
    } else {
      ElMessage.error("复制失败，请点击 Key 文本全选后手动复制");
    }
  } finally {
    copyingCreatedKey.value = false;
  }
}

async function removeKey(row: KeyRow) {
  const keyName = row.name.trim();

  try {
    await ElMessageBox.confirm(
      `确认删除 API Key「${keyName}」（${row.keyPrefix}••••）？删除后不可恢复，使用该 Key 的客户端将立即失效。`,
      "删除 API Key",
      {
        type: "warning",
        confirmButtonText: "继续",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      },
    );
  } catch {
    return;
  }

  try {
    await ElMessageBox.prompt(
      `删除不可恢复。请再次输入 Key 名称「${keyName}」以完成二次确认。`,
      "二次确认删除",
      {
        inputPlaceholder: "请输入 Key 名称",
        inputValidator: (value) =>
          value?.trim() === keyName ? true : "输入内容与 Key 名称不一致",
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
        confirmButtonClass: "el-button--danger",
      },
    );
  } catch {
    return;
  }

  deletingId.value = row.id;
  try {
    await http.delete(`/api/me/api-keys/${row.id}`);
    ElMessage.success("已删除");
    await load();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "删除失败"));
  } finally {
    deletingId.value = null;
  }
}

onMounted(load);
</script>

<style scoped>
.keys-page {
  min-width: 0;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.join-alert {
  margin-bottom: 16px;
}

.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
  color: #0f172a;
}

.page-subtitle {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 13px;
}

.key-name {
  color: #0f172a;
  font-weight: 600;
}

.metric-value {
  color: #0f172a;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
}

.metric-empty {
  color: #94a3b8;
  font-size: 12px;
}

.create-form-state {
  min-height: 220px;
}

.channel-state {
  display: grid;
  justify-items: start;
  gap: 16px;
  padding: 12px 0;
}

.channel-hint {
  width: 100%;
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.protocol-form-item :deep(.el-form-item__content) {
  display: block;
}

.protocol-radio-group {
  display: grid;
  grid-template-columns: 1fr;
  width: 100%;
  gap: 10px;
}

.protocol-radio-option.el-radio.is-bordered {
  width: 100%;
  height: auto;
  min-height: 72px;
  margin: 0;
  padding: 12px 14px;
  border-radius: 8px;
  align-items: flex-start;
}

.protocol-radio-option :deep(.el-radio__input) {
  margin-top: 2px;
}

.protocol-radio-option :deep(.el-radio__label) {
  min-width: 0;
  width: 100%;
  padding-left: 10px;
  white-space: normal;
}

.protocol-option-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.4;
}

.protocol-option-copy strong {
  color: #334155;
  font-size: 13px;
  font-weight: 600;
}

.protocol-option-copy small {
  color: #64748b;
  font-size: 12px;
}

.protocol-option-copy code {
  color: #475569;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.protocol-radio-option.is-checked .protocol-option-copy strong {
  color: var(--el-color-primary);
}

.protocol-radio-option.is-disabled .protocol-option-copy strong,
.protocol-radio-option.is-disabled .protocol-option-copy small,
.protocol-radio-option.is-disabled .protocol-option-copy code {
  color: #94a3b8;
}

.form-help {
  margin-top: 8px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.protocol-empty {
  margin-top: 8px;
}

.protocol-guide {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.protocol-guide-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.protocol-guide-head strong {
  color: #0f172a;
  font-size: 13px;
}

.protocol-guide-row {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 10px;
  margin-top: 8px;
  align-items: start;
}

.protocol-guide-row > span {
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
}

.protocol-guide-row > code,
.protocol-guide-lines code {
  display: block;
  overflow-wrap: anywhere;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
}

.protocol-guide-hint {
  margin: 10px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
}

.protocol-guide-hint a {
  color: #2563eb;
  font-weight: 600;
}

.protocol-guide-lines {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.submit-error {
  display: flex;
  align-items: center;
  gap: 8px;
}

.submit-error :deep(.el-alert) {
  flex: 1;
}

.create-result {
  display: grid;
  gap: 16px;
}

.result-meta {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.result-meta > div {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 12px;
}

.result-meta dt {
  color: #64748b;
}

.result-meta dd {
  margin: 0;
  color: #0f172a;
  font-weight: 600;
}

.secret-label {
  margin-bottom: -8px;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
}

.secret-box {
  display: flex;
  align-items: stretch;
  gap: 10px;
}

.secret-input {
  flex: 1;
  min-width: 0;
}

.secret-input :deep(.el-input__wrapper) {
  background: #fffbeb;
  box-shadow: 0 0 0 1px #fbbf24 inset;
}

.secret-input :deep(.el-input__wrapper.is-focus) {
  box-shadow:
    0 0 0 1px var(--el-color-primary) inset,
    0 0 0 3px rgb(64 158 255 / 20%);
}

.secret-input :deep(.el-input__inner) {
  background: #fffbeb;
  color: #92400e;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
}

.secret-box .el-button {
  min-width: 116px;
}

.result-tip {
  margin: -6px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
}

</style>
