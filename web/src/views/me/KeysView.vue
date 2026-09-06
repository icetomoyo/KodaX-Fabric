<template>
  <el-card shadow="never">
      <div class="page-head">
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

      <el-table v-loading="loading" :data="pagedKeys" stripe empty-text="暂无 API Key">
        <el-table-column label="团队" min-width="140">
          <template #default="{ row }">
            {{ row.teamName || "未绑定团队" }}
          </template>
        </el-table-column>
        <el-table-column label="名称" min-width="140">
          <template #default="{ row }">
            {{ row.name }}
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
      <div class="pager">
        <el-pagination
          v-model:current-page="keyPage"
          background
          layout="total, prev, pager, next"
          :total="keyTotal"
          :page-size="keyPageSize"
        />
      </div>
  </el-card>

    <el-dialog
      v-model="showCreate"
      :title="createdResult ? '复制新 API Key' : '创建 API Key'"
      width="480px"
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

        <el-descriptions :column="1" border>
          <el-descriptions-item label="名称">{{ createdResult.name }}</el-descriptions-item>
          <el-descriptions-item label="上游渠道">
            {{ channelLabel({ providerName: createdResult.providerName, productLineName: createdResult.productLineName }) }}
          </el-descriptions-item>
          <el-descriptions-item label="协议">{{ relayProtocolLabel(createdResult.protocol) }}</el-descriptions-item>
        </el-descriptions>

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
        <p class="result-tip">关闭后无法再次查看，请先复制。</p>
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
          <el-form-item label="名称" required>
            <el-input
              v-model="createForm.name"
              maxlength="100"
              placeholder="例如 Cursor"
              :disabled="creating"
            />
          </el-form-item>
          <el-form-item label="上游渠道" required>
            <el-select
              v-model="createForm.productLineId"
              placeholder="选择渠道"
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
          </el-form-item>
          <el-form-item v-if="selectedChannel" label="协议" required>
            <el-radio-group
              v-if="compatibleProtocolOptions.length > 0"
              v-model="createForm.protocol"
              :disabled="creating"
            >
              <el-radio
                v-for="option in compatibleProtocolOptions"
                :key="option.value"
                :value="option.value"
                border
              >
                {{ option.shortLabel }}
              </el-radio>
            </el-radio-group>
            <div v-else class="form-help">
              该渠道暂无可用协议
            </div>
          </el-form-item>

          <div v-if="submitError" class="submit-error">
            <el-alert :title="submitError" type="error" :closable="false" show-icon style="flex: 1" />
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
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { useAuthStore } from "@/stores/auth";
import { copyText } from "@/lib/clipboard";
import { useTablePage } from "@/lib/table-page";
import {
  relayProtocolLabel,
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
const {
  page: keyPage,
  paged: pagedKeys,
  total: keyTotal,
  pageSize: keyPageSize,
} = useTablePage(keys);
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
  createForm.teamId = teams.value[0]?.id ?? null;
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

function onChannelChange() {
  submitError.value = "";
  const available = selectedChannel.value?.compatibleProtocols ?? [];
  if (!createForm.protocol || !available.includes(createForm.protocol)) {
    createForm.protocol = null;
  }
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
    ElMessage.warning("请选择协议");
    return;
  }
  if (!createForm.name.trim()) {
    ElMessage.warning("请填写名称");
    return;
  }
  if (!createForm.teamId) {
    ElMessage.warning("尚未加入团队");
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
.page-head {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 16px;
}

.join-alert {
  margin-bottom: 16px;
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

.form-help {
  margin-top: 8px;
  color: var(--el-text-color-secondary);
}

.submit-error {
  display: flex;
  align-items: center;
  gap: 8px;
}

.create-result {
  display: grid;
  gap: 16px;
}

.secret-label {
  color: var(--el-text-color-regular);
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

.result-tip {
  margin: 0;
  color: var(--el-text-color-secondary);
}
</style>
