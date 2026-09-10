<template>
  <el-card class="profile-page" shadow="never">
    <div class="profile-shell">
      <nav class="profile-nav" aria-label="个人中心">
        <button
          v-for="item in profileNavItems"
          :key="item.id"
          type="button"
          class="profile-nav-item"
          :class="{ active: activeProfileSection === item.id }"
          @click="activeProfileSection = item.id"
        >
          {{ item.label }}
        </button>
      </nav>

      <div class="profile-pane">
        <section v-if="activeProfileSection === 'profile'" class="profile-section">
          <el-form
            v-if="auth.isSuperAdmin || auth.isOrgAdmin"
            label-position="top"
            class="profile-form"
            @submit.prevent="submitProfile"
          >
            <div class="profile-fields">
              <el-form-item label="姓名" required>
                <el-input
                  v-model="profileForm.name"
                  autocomplete="name"
                  :maxlength="100"
                />
              </el-form-item>
              <el-form-item label="手机号" required>
                <el-input
                  v-model="profileForm.phone"
                  autocomplete="tel"
                  inputmode="tel"
                  :maxlength="20"
                />
              </el-form-item>
              <el-form-item label="部门">
                <el-input :model-value="profileForm.dept || '—'" disabled />
              </el-form-item>
              <el-form-item label="角色">
                <el-input :model-value="roleLabel" disabled />
              </el-form-item>
            </div>
            <div class="form-actions">
              <el-button
                type="primary"
                native-type="submit"
                :loading="profileSaving"
                :disabled="!profileDirty"
              >
                保存个人信息
              </el-button>
              <el-button v-if="profileDirty" :disabled="profileSaving" @click="resetProfile">
                取消修改
              </el-button>
            </div>
          </el-form>

          <el-descriptions v-else :column="2" border class="account-info">
            <el-descriptions-item label="姓名">{{ auth.user?.name || "—" }}</el-descriptions-item>
            <el-descriptions-item label="手机号">{{ auth.user?.phone || "—" }}</el-descriptions-item>
            <el-descriptions-item label="角色">{{ roleLabel }}</el-descriptions-item>
            <el-descriptions-item label="部门">{{ auth.user?.dept || "—" }}</el-descriptions-item>
            <el-descriptions-item v-if="auth.user?.enterprise?.name" label="企业">
              {{ auth.user.enterprise.name }} · {{ auth.user.enterprise.code }}
            </el-descriptions-item>
          </el-descriptions>
        </section>

        <section v-else-if="activeProfileSection === 'channel-key'" class="profile-section">
          <p class="section-hint">
            选择渠道并填写渠道KEY，然后测试连通性，测试通过后方可提交。
          </p>
          <el-form label-position="top" class="profile-form channel-key-form" @submit.prevent="submitChannelKey">
            <div class="profile-fields channel-key-fields">
              <el-form-item label="渠道" required>
                <el-select
                  v-model="channelKeyForm.productLineId"
                  filterable
                  placeholder="请选择渠道"
                  :loading="channelKeyChannelsLoading"
                  :disabled="channelKeyLocked"
                  style="width: 100%"
                >
                  <el-option
                    v-for="channel in channelKeyChannels"
                    :key="channel.id"
                    :label="`${channel.providerName} / ${channel.name}`"
                    :value="channel.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="渠道 KEY" required>
                <el-input
                  v-model="channelKeyForm.secret"
                  autocomplete="off"
                  placeholder="粘贴上游渠道 Key"
                  :disabled="channelKeyLocked"
                />
                <p v-if="channelKeyLocked" class="lock-hint">
                  已锁定{{ channelKeyTestMessage ? `：${channelKeyTestMessage}` : "" }}
                </p>
              </el-form-item>
            </div>
            <div class="form-actions">
              <el-button
                :loading="channelKeyTesting"
                :disabled="!canTestChannelKey"
                @click="testChannelKey"
              >
                测试
              </el-button>
              <el-button v-if="channelKeyLocked" :disabled="channelKeySaving" @click="unlockChannelKey">
                重新填写
              </el-button>
              <el-button
                type="primary"
                native-type="submit"
                :loading="channelKeySaving"
                :disabled="!channelKeyLocked"
              >
                提交
              </el-button>
            </div>
            <p v-if="!channelKeyChannelsLoading && !channelKeyChannels.length" class="section-hint">
              暂无可提交的渠道
            </p>
          </el-form>

          <div class="submit-history">
            <h4 class="history-title">提交记录</h4>
            <el-table
              v-loading="channelKeyHistoryLoading"
              :data="channelKeyHistory"
              stripe
              empty-text="暂无提交记录"
              class="history-table"
            >
              <el-table-column label="渠道" min-width="160">
                <template #default="{ row }">
                  {{ row.providerName }} / {{ row.productLineName }}
                </template>
              </el-table-column>
              <el-table-column label="尾号" width="100">
                <template #default="{ row }">****{{ row.secretSuffix }}</template>
              </el-table-column>
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="credentialStatusType(row.status)" effect="light">
                    {{ credentialStatusLabel(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="提交时间" min-width="170">
                <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="90" fixed="right">
                <template #default="{ row }">
                  <el-button
                    type="danger"
                    link
                    :loading="channelKeyDeletingId === row.id"
                    @click="deleteSubmittedChannelKey(row)"
                  >
                    删除
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </section>

        <section v-else class="profile-section">
          <el-form label-position="top" class="password-form" @submit.prevent="submitPassword">
            <el-form-item label="原密码" required>
              <el-input
                v-model="passwordForm.oldPassword"
                type="password"
                show-password
                autocomplete="current-password"
              />
            </el-form-item>
            <el-form-item label="新密码" required>
              <el-input
                v-model="passwordForm.newPassword"
                type="password"
                show-password
                autocomplete="new-password"
                :maxlength="128"
              />
            </el-form-item>
            <el-form-item label="确认密码" required>
              <el-input
                v-model="passwordForm.confirmPassword"
                type="password"
                show-password
                autocomplete="new-password"
                :maxlength="128"
              />
            </el-form-item>
            <el-button type="primary" native-type="submit" :loading="passwordSaving">
              保存密码
            </el-button>
          </el-form>
        </section>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";
import { roleLabel as formatRoleLabel } from "@/lib/roles";
import { useAuthStore } from "@/stores/auth";

type SubmitableChannel = {
  id: number;
  name: string;
  code: string;
  productType: "api" | "coding_plan";
  providerCode: string;
  providerName: string;
};

type SubmittedChannelKey = {
  id: number;
  productLineId: number;
  productLineName: string;
  providerName: string;
  providerCode: string;
  label: string;
  secretSuffix: string;
  status: "active" | "disabled" | "auto_disabled" | "cooling";
  createdAt: string;
};

type ProfileSection = "profile" | "channel-key" | "password";

const auth = useAuthStore();
const activeProfileSection = ref<ProfileSection>("profile");
const profileSaving = ref(false);
const passwordSaving = ref(false);
const channelKeySaving = ref(false);
const channelKeyTesting = ref(false);
const channelKeyLocked = ref(false);
const channelKeyTestProof = ref("");
const channelKeyTestMessage = ref("");
const channelKeyChannelsLoading = ref(false);
const channelKeyHistoryLoading = ref(false);
const channelKeyDeletingId = ref<number | null>(null);
const channelKeyChannels = ref<SubmitableChannel[]>([]);
const channelKeyHistory = ref<SubmittedChannelKey[]>([]);
const profileForm = reactive({
  name: "",
  phone: "",
  dept: "",
});
const passwordForm = reactive({
  oldPassword: "",
  newPassword: "",
  confirmPassword: "",
});
const channelKeyForm = reactive({
  productLineId: null as number | null,
  secret: "",
});

const roleLabel = computed(() => formatRoleLabel(auth.user?.role));
const canSubmitChannelKey = computed(() => Boolean(auth.user) && !auth.isSuperAdmin);
const canTestChannelKey = computed(
  () =>
    !channelKeyLocked.value
    && !channelKeySaving.value
    && channelKeyForm.productLineId != null
    && Boolean(channelKeyForm.secret.trim())
    && channelKeyChannels.value.length > 0,
);
const profileNavItems = computed(() => {
  const items: Array<{ id: ProfileSection; label: string }> = [
    { id: "profile", label: "基本信息" },
  ];
  if (canSubmitChannelKey.value) {
    items.push({ id: "channel-key", label: "提交渠道 KEY" });
  }
  items.push({ id: "password", label: "修改密码" });
  return items;
});

const profileDirty = computed(() => {
  const user = auth.user;
  if (!user) return false;
  return profileForm.name.trim() !== user.name || profileForm.phone.trim() !== user.phone;
});

watch(
  () => auth.user,
  () => resetProfile(),
  { immediate: true },
);

watch(canSubmitChannelKey, (enabled) => {
  if (!enabled && activeProfileSection.value === "channel-key") {
    activeProfileSection.value = "profile";
  }
  if (!enabled) {
    channelKeyChannels.value = [];
    channelKeyHistory.value = [];
    channelKeyForm.productLineId = null;
    channelKeyForm.secret = "";
    unlockChannelKey();
  }
});

watch(
  () => canSubmitChannelKey.value && activeProfileSection.value === "channel-key",
  (shouldLoad) => {
    if (shouldLoad) {
      void loadSubmitChannels();
      void loadSubmitHistory();
    }
  },
  { immediate: true },
);

function resetProfile() {
  profileForm.name = auth.user?.name ?? "";
  profileForm.phone = auth.user?.phone ?? "";
  profileForm.dept = auth.user?.dept ?? "";
}

function unlockChannelKey() {
  channelKeyLocked.value = false;
  channelKeyTestProof.value = "";
  channelKeyTestMessage.value = "";
}

function credentialStatusLabel(status: SubmittedChannelKey["status"]): string {
  if (status === "cooling") return "冷却";
  if (status === "auto_disabled") return "自动停用";
  if (status === "disabled") return "已停用";
  return "可用";
}

function credentialStatusType(status: SubmittedChannelKey["status"]) {
  if (status === "cooling") return "warning" as const;
  if (status === "auto_disabled" || status === "disabled") return "danger" as const;
  return "success" as const;
}

async function loadSubmitHistory() {
  channelKeyHistoryLoading.value = true;
  try {
    const { data } = await http.get("/api/me/upstream-credentials");
    if (!data.success) throw new Error(data.message || "加载提交记录失败");
    channelKeyHistory.value = Array.isArray(data.data) ? data.data : [];
  } catch (error) {
    channelKeyHistory.value = [];
    ElMessage.error(requestErrorMessage(error, "加载提交记录失败"));
  } finally {
    channelKeyHistoryLoading.value = false;
  }
}

async function loadSubmitChannels() {
  channelKeyChannelsLoading.value = true;
  try {
    const { data } = await http.get("/api/me/upstream-credential-channels");
    if (!data.success) throw new Error(data.message || "加载渠道失败");
    channelKeyChannels.value = Array.isArray(data.data) ? data.data : [];
    if (
      channelKeyForm.productLineId != null
      && !channelKeyChannels.value.some((channel) => channel.id === channelKeyForm.productLineId)
    ) {
      channelKeyForm.productLineId = null;
      unlockChannelKey();
    }
  } catch (error) {
    channelKeyChannels.value = [];
    ElMessage.error(requestErrorMessage(error, "加载渠道失败"));
  } finally {
    channelKeyChannelsLoading.value = false;
  }
}

function requestErrorMessage(error: unknown, fallback: string) {
  const requestError = error as {
    message?: string;
    response?: { data?: { message?: string } };
  };
  return requestError.response?.data?.message || requestError.message || fallback;
}

async function submitProfile() {
  const user = auth.user;
  if (!user || !(auth.isSuperAdmin || auth.isOrgAdmin)) return;

  const name = profileForm.name.trim();
  const phone = profileForm.phone.trim();
  if (!name || !phone) {
    ElMessage.warning("请填写姓名和手机号");
    return;
  }
  if (phone.length < 5) {
    ElMessage.warning("手机号长度应为 5–20 个字符");
    return;
  }

  profileSaving.value = true;
  try {
    const { data } = await http.patch(`/api/admin/users/${user.id}`, {
      name,
      phone,
    });
    if (!data.success) throw new Error(data.message || "保存失败");
    await auth.fetchMe();
    ElMessage.success("个人信息已更新");
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, "个人信息更新失败"));
  } finally {
    profileSaving.value = false;
  }
}

async function testChannelKey() {
  if (!canSubmitChannelKey.value || !canTestChannelKey.value) return;
  if (channelKeyForm.productLineId == null) {
    ElMessage.warning("请选择渠道");
    return;
  }
  const secret = channelKeyForm.secret.trim();
  if (!secret) {
    ElMessage.warning("请填写渠道 KEY");
    return;
  }

  channelKeyTesting.value = true;
  try {
    const { data } = await http.post("/api/me/upstream-credentials/test", {
      productLineId: channelKeyForm.productLineId,
      secret,
    });
    if (!data.success) throw new Error(data.message || "测试失败");
    const result = data.data as {
      ok?: boolean;
      proof?: string | null;
      message?: string;
    };
    if (!result?.ok || !result.proof) {
      ElMessage.error(result?.message || "测试未通过");
      return;
    }
    channelKeyLocked.value = true;
    channelKeyTestProof.value = result.proof;
    channelKeyTestMessage.value = result.message || "测试通过";
    ElMessage.success(channelKeyTestMessage.value);
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, "渠道 KEY 测试失败"));
  } finally {
    channelKeyTesting.value = false;
  }
}

async function submitChannelKey() {
  if (!canSubmitChannelKey.value) return;
  if (channelKeyForm.productLineId == null) {
    ElMessage.warning("请选择渠道");
    return;
  }
  const secret = channelKeyForm.secret.trim();
  if (!secret) {
    ElMessage.warning("请填写渠道 KEY");
    return;
  }
  if (!channelKeyLocked.value || !channelKeyTestProof.value) {
    ElMessage.warning("请先测试渠道 KEY，测试通过后再提交");
    return;
  }

  channelKeySaving.value = true;
  try {
    const { data } = await http.post("/api/me/upstream-credentials", {
      productLineId: channelKeyForm.productLineId,
      secret,
      testProof: channelKeyTestProof.value,
    });
    if (!data.success) throw new Error(data.message || "提交失败");
    channelKeyForm.secret = "";
    unlockChannelKey();
    ElMessage.success("渠道 KEY 已提交");
    await loadSubmitHistory();
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, "渠道 KEY 提交失败"));
  } finally {
    channelKeySaving.value = false;
  }
}

async function deleteSubmittedChannelKey(row: SubmittedChannelKey) {
  if (!canSubmitChannelKey.value) return;
  try {
    await ElMessageBox.confirm(
      `确认删除渠道 KEY（尾号 ****${row.secretSuffix}）？删除后不可恢复。`,
      "删除渠道 KEY",
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

  channelKeyDeletingId.value = row.id;
  try {
    const { data } = await http.delete(`/api/me/upstream-credentials/${row.id}`);
    if (!data.success) throw new Error(data.message || "删除失败");
    ElMessage.success("渠道 KEY 已删除");
    await loadSubmitHistory();
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, "渠道 KEY 删除失败"));
  } finally {
    channelKeyDeletingId.value = null;
  }
}

async function submitPassword() {
  if (!passwordForm.oldPassword || !passwordForm.newPassword) {
    ElMessage.warning("请填写密码");
    return;
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    ElMessage.warning("两次密码不一致");
    return;
  }

  passwordSaving.value = true;
  try {
    await auth.changePassword(passwordForm.oldPassword, passwordForm.newPassword);
    passwordForm.oldPassword = "";
    passwordForm.newPassword = "";
    passwordForm.confirmPassword = "";
    ElMessage.success("密码已修改");
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, "修改失败"));
  } finally {
    passwordSaving.value = false;
  }
}
</script>

<style scoped>
.profile-page {
  max-width: 960px;
}

.profile-shell {
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  min-height: 360px;
}

.profile-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 16px;
  border-right: 1px solid var(--el-border-color-lighter);
}

.profile-nav-item {
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #475569;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.profile-nav-item:hover {
  background: #f1f5f9;
  color: #0f172a;
}

.profile-nav-item.active {
  background: #eff6ff;
  color: #1d4ed8;
  font-weight: 600;
}

.profile-pane {
  min-width: 0;
  padding-left: 24px;
}

.profile-section {
  margin-top: 0;
}

.section-hint {
  margin: 0 0 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.profile-form {
  max-width: 720px;
}

.profile-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 24px;
}

.channel-key-form {
  max-width: none;
}

.channel-key-fields {
  grid-template-columns: 200px minmax(0, 1fr);
}

.form-actions {
  display: flex;
  gap: 8px;
}

.lock-hint {
  margin: 8px 0 0;
  color: var(--el-color-success);
  font-size: 12px;
  line-height: 1.4;
}

.account-info {
  margin-top: 0;
}

.password-form {
  max-width: 480px;
}

.submit-history {
  margin-top: 24px;
}

.history-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
}

.history-table {
  width: 100%;
}

@media (max-width: 700px) {
  .profile-shell {
    grid-template-columns: 1fr;
  }

  .profile-nav {
    flex-direction: row;
    flex-wrap: wrap;
    padding: 0 0 12px;
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }

  .profile-pane {
    padding: 16px 0 0;
  }

  .profile-fields,
  .channel-key-fields {
    grid-template-columns: 1fr;
  }
}
</style>
