<template>
  <div class="keys-page">
    <section class="page-card">
      <div class="page-head">
        <div>
          <h2 class="page-title">API Key</h2>
          <p class="page-subtitle">管理个人调用凭证，可随时复制</p>
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
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'active'"
              link
              type="primary"
              :loading="copyingId === row.id"
              @click="copyKey(row)"
            >
              复制
            </el-button>
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
      title="创建 API Key"
      width="480px"
      destroy-on-close
      @closed="onCreateClosed"
    >
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="名称" required>
          <el-input
            v-model="createForm.name"
            maxlength="100"
            show-word-limit
            placeholder="例如：本机 Cursor"
          />
        </el-form-item>
        <el-form-item label="协议" required>
          <el-select v-model="createForm.protocol" style="width: 100%">
            <el-option
              v-for="option in relayProtocolOptions"
              :key="option.value"
              :label="option.shortLabel"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="createKey">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
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
  status: string;
  createdAt: string;
  lastUsedAt?: string | null;
};

const keys = ref<KeyRow[]>([]);
const loading = ref(false);
const creating = ref(false);
const copyingId = ref<number | null>(null);
const deletingId = ref<number | null>(null);
const showCreate = ref(false);
const createForm = reactive({
  name: "",
  protocol: "openai_chat" as RelayProtocol,
});

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
    if (data.success) keys.value = data.data;
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "加载 API Key 失败"));
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  createForm.name = "";
  createForm.protocol = "openai_chat";
  showCreate.value = true;
}

function onCreateClosed() {
  createForm.name = "";
  createForm.protocol = "openai_chat";
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
  if (!createForm.name.trim()) {
    ElMessage.warning("请填写名称");
    return;
  }
  creating.value = true;
  try {
    const { data } = await http.post("/api/me/api-keys", {
      name: createForm.name.trim(),
      protocol: createForm.protocol,
    });
    if (!data.success) throw new Error(data.message || "创建失败");
    const key = data.data.key as string;
    showCreate.value = false;
    const copied = await writeClipboard(key);
    ElMessage.success(copied ? "已创建并复制到剪贴板" : "已创建；复制失败，可在列表中再次复制");
    await load();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "创建失败"));
  } finally {
    creating.value = false;
  }
}

async function copyKey(row: KeyRow) {
  copyingId.value = row.id;
  try {
    const { data } = await http.post(`/api/me/api-keys/${row.id}/reveal`);
    if (!data.success || typeof data.data?.key !== "string") {
      throw new Error(data.message || "读取 Key 失败");
    }
    const copied = await writeClipboard(data.data.key);
    if (!copied) throw new Error("复制失败，请检查剪贴板权限");
    ElMessage.success("已复制");
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "复制失败"));
  } finally {
    copyingId.value = null;
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

</style>
