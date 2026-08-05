<template>
  <div class="keys-page">
    <section class="page-card">
      <div class="page-head">
        <div>
          <h2 class="page-title">API Key</h2>
          <p class="page-subtitle">每把 Key 固定使用一个上游渠道，明文仅在创建完成时展示一次</p>
        </div>
        <el-button type="primary" @click="openCreate">创建 Key</el-button>
      </div>

      <el-table v-loading="loading" :data="keys" stripe empty-text="暂无 API Key">
        <el-table-column label="名称" min-width="140">
          <template #default="{ row }">
            <span class="key-name">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Key" min-width="180">
          <template #default="{ row }">
            <code class="key-mask">{{ row.keyPrefix }}••••</code>
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
        <el-table-column label="创建时间" min-width="170">
          <template #default="{ row }">
            {{ formatDateTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="最近使用" min-width="170">
          <template #default="{ row }">
            {{ formatDateTime(row.lastUsedAt) }}
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
      :title="createdResult ? '保存 API Key' : '创建 API Key'"
      width="560px"
      destroy-on-close
      :close-on-click-modal="!createdResult"
      :close-on-press-escape="!createdResult"
      :before-close="handleCreateBeforeClose"
      @closed="onCreateClosed"
    >
      <div v-if="createdResult" class="create-result">
        <el-alert
          title="API Key 已创建，关闭后员工端无法再次查看"
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

        <div class="secret-label">完整 API Key</div>
        <div class="secret-box">
          <code>{{ createdResult.key }}</code>
          <el-button
            type="primary"
            :loading="copyingCreatedKey"
            @click="copyCreatedKey"
          >
            复制 Key
          </el-button>
        </div>
        <p class="result-tip">
          请立即保存到密码管理器或客户端配置中。列表仅保留前缀，之后不能从员工端找回明文。
        </p>
        <el-checkbox v-model="savedConfirmed" class="saved-confirmation">
          我已将 API Key 保存到安全位置
        </el-checkbox>
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
          <el-form-item label="1. 上游渠道" required>
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

          <el-form-item label="2. 兼容协议" required>
            <el-select
              v-model="createForm.protocol"
              placeholder="请先选择上游渠道"
              style="width: 100%"
              :disabled="creating || !selectedChannel || compatibleProtocolOptions.length === 0"
            >
              <el-option
                v-for="option in compatibleProtocolOptions"
                :key="option.value"
                :label="option.shortLabel"
                :value="option.value"
              >
                <span>{{ option.shortLabel }}</span>
                <span class="protocol-endpoint">{{ option.endpoint }}</span>
              </el-option>
            </el-select>
            <el-alert
              v-if="selectedChannel && compatibleProtocolOptions.length === 0"
              class="protocol-empty"
              title="该渠道暂无兼容协议，请联系管理员检查渠道 Key 的协议声明"
              type="warning"
              :closable="false"
            />
          </el-form-item>

          <el-form-item label="3. 名称" required>
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
            :disabled="!savedConfirmed"
            @click="requestCreateClose"
          >
            已保存，关闭
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
import { formatDateTime } from "@/lib/date-time";
import {
  relayProtocolLabel,
  relayProtocolOptions,
  type RelayProtocol,
} from "@/views/relay-protocol";

type KeyRow = {
  id: number;
  name: string;
  keyPrefix: string;
  protocol: RelayProtocol;
  productLineId: number;
  productLineName: string;
  providerCode: string;
  providerName: string;
  status: string;
  createdAt: string;
  lastUsedAt?: string | null;
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
const savedConfirmed = ref(false);
const createForm = reactive({
  name: "",
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

const canCreate = computed(() =>
  !channelsLoading.value
  && !channelsError.value
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

async function load() {
  loading.value = true;
  try {
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
  createForm.productLineId = null;
  createForm.protocol = null;
  upstreamChannels.value = [];
  channelsError.value = "";
  submitError.value = "";
  createdResult.value = null;
  savedConfirmed.value = false;
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
  if (createdResult.value && !savedConfirmed.value) {
    ElMessage.warning("请确认已安全保存 API Key 后再关闭");
    return;
  }
  showCreate.value = false;
}

function handleCreateBeforeClose(done: () => void) {
  if (creating.value) {
    ElMessage.warning("API Key 正在创建，请稍候");
    return;
  }
  if (createdResult.value && !savedConfirmed.value) {
    ElMessage.warning("请确认已安全保存 API Key 后再关闭");
    return;
  }
  done();
}

async function writeClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
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

  const channel = selectedChannel.value;
  const protocol = createForm.protocol;
  const name = createForm.name.trim();
  submitError.value = "";
  creating.value = true;
  try {
    const { data } = await http.post("/api/me/api-keys", {
      name,
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
    savedConfirmed.value = false;
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

async function copyCreatedKey() {
  if (!createdResult.value) return;
  copyingCreatedKey.value = true;
  const copied = await writeClipboard(createdResult.value.key);
  copied
    ? ElMessage.success("API Key 已复制")
    : ElMessage.error("复制失败，请手动选择并复制 API Key");
  copyingCreatedKey.value = false;
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

.key-mask {
  color: #475569;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
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

.protocol-endpoint {
  float: right;
  margin-left: 20px;
  color: #94a3b8;
  font-size: 12px;
}

.protocol-empty {
  margin-top: 8px;
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

.secret-box code {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  padding: 12px;
  overflow-wrap: anywhere;
  border: 1px solid #fbbf24;
  border-radius: 8px;
  background: #fffbeb;
  color: #92400e;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  user-select: all;
}

.secret-box .el-button {
  height: auto;
}

.result-tip {
  margin: -6px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
}

.saved-confirmation {
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
}

</style>
