<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">API Key</h2>
      <el-button type="primary" @click="openCreate">生成新 Key</el-button>
    </div>

    <div v-if="freshKey" class="fresh-key">
      <div class="fresh-key-main">
        <div class="fresh-key-label">
          <strong>新 Key</strong>
          <el-tag size="small" effect="plain">
            {{ relayProtocolLabel(freshKey.protocol, true) }}
          </el-tag>
        </div>
        <el-input :model-value="freshKey.value" readonly>
          <template #append>
            <el-button @click="copyFreshKey">复制</el-button>
          </template>
        </el-input>
        <div class="fresh-key-tip">请妥善保存；调用时只能使用上方标记的客户端协议。</div>
      </div>
      <el-button @click="freshKey = null">隐藏</el-button>
    </div>

    <el-table :data="keys" stripe>
      <el-table-column prop="name" label="名称" width="140" />
      <el-table-column prop="keyPrefix" label="前缀" width="140" />
      <el-table-column label="客户端协议" min-width="210">
        <template #default="{ row }">
          <el-tag effect="plain">{{ relayProtocolLabel(row.protocol) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          {{ keyStatusLabel(row.status) }}
        </template>
      </el-table-column>
      <el-table-column label="创建时间" min-width="210">
        <template #default="{ row }">
          {{ formatDateTime(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column label="最近使用" min-width="210">
        <template #default="{ row }">
          {{ formatDateTime(row.lastUsedAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120">
        <template #default="{ row }">
          <el-button
            v-if="row.status === 'active'"
            link
            type="danger"
            @click="revoke(row.id)"
          >
            吊销
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showCreate" title="生成 API Key" width="540px" destroy-on-close>
      <el-alert
        title="每个 Key 只绑定一种客户端协议；创建后不能切换。"
        type="info"
        :closable="false"
        show-icon
        class="protocol-alert"
      />
      <el-form label-position="top">
        <el-form-item label="名称" required>
          <el-input v-model="createForm.name" maxlength="100" placeholder="如：我的 Codex Key" />
        </el-form-item>
        <el-form-item label="客户端协议" required>
          <el-select v-model="createForm.protocol" style="width: 100%">
            <el-option
              v-for="option in relayProtocolOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
      </el-form>

      <div class="protocol-guide">
        <strong>{{ selectedProtocol.label }}</strong>
        <span>{{ selectedProtocol.description }}</span>
        <code>{{ selectedProtocol.endpoint }}</code>
        <code v-for="line in selectedProtocol.authHeaders" :key="line">{{ line }}</code>
      </div>

      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="createKey">确认生成</el-button>
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
  relayProtocolOption,
  relayProtocolOptions,
  type RelayProtocol,
} from "@/views/relay-protocol";

type KeyRow = {
  id: number;
  name: string;
  keyPrefix: string;
  protocol: RelayProtocol;
  status: string;
  createdAt: string;
  lastUsedAt?: string | null;
};

const keys = ref<KeyRow[]>([]);
const creating = ref(false);
const freshKey = ref<{ value: string; protocol: RelayProtocol } | null>(null);
const showCreate = ref(false);
const createForm = reactive({
  name: "default",
  protocol: "openai_chat" as RelayProtocol,
});

const selectedProtocol = computed(() => relayProtocolOption(createForm.protocol));

async function load() {
  const { data } = await http.get("/api/me/api-keys");
  if (data.success) keys.value = data.data;
}

function openCreate() {
  createForm.name = "default";
  createForm.protocol = "openai_chat";
  showCreate.value = true;
}

async function createKey() {
  if (!createForm.name.trim()) {
    ElMessage.warning("请填写 Key 名称");
    return;
  }
  creating.value = true;
  try {
    const { data } = await http.post("/api/me/api-keys", {
      name: createForm.name.trim(),
      protocol: createForm.protocol,
    });
    if (!data.success) throw new Error(data.message);
    freshKey.value = { value: data.data.key, protocol: createForm.protocol };
    showCreate.value = false;
    ElMessage.success(`${relayProtocolLabel(createForm.protocol, true)} Key 已生成`);
    await load();
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || "生成失败");
  } finally {
    creating.value = false;
  }
}

async function revoke(id: number) {
  await ElMessageBox.confirm("吊销后不可恢复，确认？", "提示");
  await http.post(`/api/me/api-keys/${id}/revoke`);
  ElMessage.success("已吊销");
  await load();
}

async function copyFreshKey() {
  if (!freshKey.value) return;
  try {
    await navigator.clipboard.writeText(freshKey.value.value);
    ElMessage.success("已复制");
  } catch {
    ElMessage.error("复制失败");
  }
}

function keyStatusLabel(status: string) {
  return status === "active" ? "正常" : status === "revoked" ? "已吊销" : status;
}

onMounted(load);
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.fresh-key {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  margin-bottom: 16px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #eff6ff;
}
.fresh-key-main {
  flex: 1;
  min-width: 0;
}
.fresh-key-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.fresh-key-tip {
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
}
.protocol-alert {
  margin-bottom: 16px;
}
.protocol-guide {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px 14px;
  border-radius: 8px;
  background: #f8fafc;
  color: #475569;
  font-size: 13px;
}
.protocol-guide strong {
  color: #0f172a;
}
.protocol-guide code {
  overflow-wrap: anywhere;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
