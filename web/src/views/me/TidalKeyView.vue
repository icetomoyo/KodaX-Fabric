<template>
  <el-card shadow="never">
    <div class="tidal-head">
      <h3 class="tidal-title">潮汐KEY</h3>
      <el-tag v-if="headTag" :type="headTag.type" effect="light" size="small">{{ headTag.text }}</el-tag>
    </div>
    <p class="tidal-desc">
      用于大并发的 Agent 测试：只在开放时段可用，请求会铺到闲置的渠道 Key 上，和你平时用的 API Key 分开。
      <template v-if="!tidal">需要先申请，管理员审核通过后才能创建。</template>
    </p>

    <div v-loading="loading" class="tidal-board">
      <!-- 有未到期的授权：授权信息和这把 KEY。 -->
      <template v-if="tidal">
        <el-descriptions :column="2" border class="grant-info">
          <el-descriptions-item label="开放时段">{{ tidalWindowText }}</el-descriptions-item>
          <el-descriptions-item label="授权到期">
            <span data-testid="tidal-expires-at">
              {{ tidal.expiresAt ? formatTime(tidal.expiresAt) : "长期有效" }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="并发上限">
            <span data-testid="tidal-max-concurrency">{{ tidal.maxConcurrency }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="每分钟请求">
            <span data-testid="tidal-rpm-limit">{{ tidal.rpmLimit }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <el-alert
          v-if="!hasDepartment"
          class="join-alert"
          title="尚未加入部门，暂时不能创建潮汐KEY。"
          type="warning"
          show-icon
          :closable="false"
        />

        <template v-if="tidalKey">
          <div class="key-toolbar">
            <span class="muted">调用地址和 API Key 页的一样，把 Key 换成这一把即可。</span>
            <el-switch v-model="showKey" active-text="显示 Key" inactive-text="隐藏 Key" />
          </div>
          <div class="key-row">
            <span class="proto-label">{{ tidalKey.name || "潮汐KEY" }}</span>
            <code class="key-text" :title="displayKey(tidalKey)">{{ displayKey(tidalKey) }}</code>
            <el-button
              class="row-action"
              link
              type="warning"
              :loading="regeneratingId === tidalKey.id"
              @click="regenerateKey(tidalKey)"
            >
              更新
            </el-button>
            <el-button
              class="row-action"
              link
              type="primary"
              :disabled="!tidalKey.key"
              :loading="copyingId === tidalKey.id"
              @click="copyKey(tidalKey)"
            >
              复制
            </el-button>
            <el-button
              class="row-action"
              link
              type="danger"
              :loading="deletingId === tidalKey.id"
              @click="removeKey(tidalKey)"
            >
              删除
            </el-button>
          </div>
        </template>
        <el-button
          v-else
          type="primary"
          :disabled="!hasDepartment"
          :loading="creatingTidal"
          @click="createTidalKey"
        >
          创建潮汐KEY
        </el-button>
      </template>

      <!-- 没有授权、潮汐开着：申请入口。 -->
      <section v-else-if="tidalApply?.available" data-testid="tidal-apply">
        <p v-if="pendingApplication" class="apply-state">
          已提交申请，申请用到 {{ formatTime(pendingApplication.requestedExpiresAt) }}，等待管理员审核。
        </p>
        <template v-else>
          <p v-if="rejectedApplication" class="apply-state">
            上次申请未通过{{ rejectedApplication.reviewNote ? `：${rejectedApplication.reviewNote}` : "" }}，可以重新申请。
          </p>
          <p v-else class="apply-state">你还没有潮汐授权。</p>
          <el-button type="primary" @click="openApply">申请潮汐KEY</el-button>
        </template>
      </section>

      <el-empty
        v-else-if="!loading"
        description="潮汐调度暂未开启，或者当前账号不能使用潮汐KEY"
        :image-size="72"
      />
    </div>

    <el-dialog v-model="showApply" title="申请潮汐KEY" width="460px">
      <el-form label-width="84px" @submit.prevent>
        <el-form-item label="到期时间" required>
          <el-date-picker
            v-model="applyForm.expiresAt"
            type="datetime"
            placeholder="选择到期时间"
            :shortcuts="applyShortcuts"
            :disabled-date="isPastDay"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="申请说明">
          <el-input
            v-model="applyForm.reason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="例如：Agent 夜间回归测试"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showApply = false">取消</el-button>
        <el-button type="primary" :loading="applying" @click="submitApply">提交申请</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import {
  getErrorMessage,
  loadMyDepartments,
  useApiKeyActions,
  type ApiKeyRef,
  type OrgDepartment,
} from "./api-key-actions";

/** 潮汐授权；只有被授权的员工，接口才会返回这一段。 */
type TidalInfo = {
  maxConcurrency: number;
  rpmLimit: number;
  expiresAt: string | null;
  hasKey: boolean;
  enabled: boolean;
  windowStart: string;
  windowEnd: string;
  windowOpen: boolean;
  timezone: string;
};

/** 潮汐申请；available 为 false 时不给申请入口（潮汐没开启，或这个账号用不了潮汐）。 */
type TidalApplication = {
  id: number;
  status: "pending" | "approved" | "rejected";
  requestedExpiresAt: string;
  reason: string | null;
  reviewNote: string | null;
};

type TidalApplyInfo = {
  available: boolean;
  granted: boolean;
  application: TidalApplication | null;
};

type HeadTag = { type: "success" | "warning" | "info"; text: string };

const DAY_MS = 24 * 60 * 60 * 1_000;
const applyShortcuts = [1, 3, 7, 30].map((days) => ({
  text: `${days} 天后`,
  value: () => new Date(Date.now() + days * DAY_MS),
}));

const loading = ref(false);
const departments = ref<OrgDepartment[]>([]);
const hasDepartment = computed(() => departments.value.length > 0);

const tidal = ref<TidalInfo | null>(null);
const tidalKey = ref<ApiKeyRef | null>(null);
const showKey = ref(false);
const creatingTidal = ref(false);

const tidalApply = ref<TidalApplyInfo | null>(null);
const showApply = ref(false);
const applying = ref(false);
const applyForm = reactive({ expiresAt: null as Date | null, reason: "" });

const { deletingId, copyingId, regeneratingId, copyKey, regenerateKey, removeKey } =
  useApiKeyActions(loadKey);

const pendingApplication = computed(() => {
  const application = tidalApply.value?.application;
  return application?.status === "pending" ? application : null;
});

const rejectedApplication = computed(() => {
  const application = tidalApply.value?.application;
  return application?.status === "rejected" ? application : null;
});

const headTag = computed<HeadTag | null>(() => {
  if (tidal.value) {
    if (!tidal.value.enabled) return { type: "info", text: "暂未开启" };
    return tidal.value.windowOpen
      ? { type: "success", text: "开放中" }
      : { type: "warning", text: "未到开放时段" };
  }
  if (pendingApplication.value) return { type: "warning", text: "待审核" };
  return null;
});

const tidalWindowText = computed(() => {
  const info = tidal.value;
  if (!info) return "";
  if (info.windowStart === info.windowEnd) return "全天";
  return `${info.windowStart}–${info.windowEnd}（${info.timezone}）`;
});

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function isPastDay(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() < today.getTime();
}

function displayKey(row: ApiKeyRef) {
  if (showKey.value && row.key) return row.key;
  return `${row.keyPrefix}••••`;
}

/** 授权信息和潮汐KEY 都在 Key 列表接口里；没有授权时这两样都不会返回。 */
async function loadKey() {
  const { data } = await http.get("/api/me/api-keys");
  if (!data.success) return;
  const rows: Array<ApiKeyRef & { tidal?: boolean }> = Array.isArray(data.data) ? data.data : [];
  tidalKey.value = rows.find((row) => row.tidal) ?? null;
  tidal.value = data.tidal ?? null;
}

async function loadApplication() {
  try {
    const { data } = await http.get("/api/me/tidal-application");
    tidalApply.value = data.success ? data.data : null;
  } catch {
    tidalApply.value = null;
  }
}

function openApply() {
  applyForm.expiresAt = null;
  applyForm.reason = "";
  showApply.value = true;
}

async function submitApply() {
  if (!applyForm.expiresAt) {
    ElMessage.error("请选择到期时间");
    return;
  }
  if (applyForm.expiresAt.getTime() <= Date.now()) {
    ElMessage.error("到期时间必须晚于现在");
    return;
  }
  applying.value = true;
  try {
    await http.post("/api/me/tidal-application", {
      expiresAt: applyForm.expiresAt.toISOString(),
      reason: applyForm.reason.trim() || null,
    });
    ElMessage.success("申请已提交，等待管理员审核");
    showApply.value = false;
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "提交失败"));
  } finally {
    applying.value = false;
  }
  // 提交失败多半是状态变了（刚被授权、已有待审核的申请），两边都重新取一次。
  await Promise.all([loadKey(), loadApplication()]);
}

async function createTidalKey() {
  const department = departments.value[0];
  if (!department) return;
  creatingTidal.value = true;
  try {
    await http.post("/api/me/api-keys", {
      name: "潮汐KEY",
      departmentId: department.id,
      tidal: true,
    });
    ElMessage.success("已创建潮汐KEY");
    await loadKey();
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "创建失败"));
  } finally {
    creatingTidal.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    departments.value = await loadMyDepartments();
    await Promise.all([loadKey(), loadApplication()]);
  } catch (error) {
    ElMessage.error(getErrorMessage(error, "加载潮汐KEY 失败"));
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.tidal-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.tidal-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.tidal-desc {
  margin: 0 0 20px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.tidal-board {
  min-height: 120px;
}

.grant-info {
  max-width: 760px;
  margin-bottom: 20px;
}

.join-alert {
  margin-bottom: 16px;
}

.apply-state {
  margin: 0 0 16px;
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.key-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.key-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.proto-label {
  flex-shrink: 0;
  width: 260px;
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.key-text {
  flex-shrink: 0;
  width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--el-font-family-mono, ui-monospace, monospace);
  font-size: 13px;
  color: var(--el-text-color-regular);
  user-select: all;
}

.row-action {
  flex-shrink: 0;
  padding: 0;
}
</style>
