<template>
  <div class="page-card profile-page">
    <h2 class="page-title">个人中心</h2>

    <section class="profile-section">
      <div class="section-heading">
        <h3 class="section-title">基本信息</h3>
        <p class="section-desc">手机号同时用于登录，请确保填写准确。</p>
      </div>

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
      </el-descriptions>
    </section>

    <el-divider />

    <section v-if="auth.isOrgAdmin || auth.isDeptAdmin || auth.isTeamAdmin" class="profile-section">
      <div class="section-heading">
        <h3 class="section-title">API Key</h3>
        <p class="section-desc">自己调用模型用的凭据，和编制管理分开。</p>
      </div>
      <el-button type="primary" @click="goKeys">管理我的 API Key</el-button>
    </section>

    <el-divider v-if="auth.isOrgAdmin || auth.isDeptAdmin || auth.isTeamAdmin" />

    <section class="profile-section">
      <div class="section-heading">
        <h3 class="section-title">修改密码</h3>
        <p class="section-desc">定期更新密码有助于保护账号安全。</p>
      </div>
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
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { roleLabel as formatRoleLabel } from "@/lib/roles";
import { useAuthStore } from "@/stores/auth";

const router = useRouter();
const auth = useAuthStore();
const profileSaving = ref(false);
const passwordSaving = ref(false);
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

const roleLabel = computed(() => formatRoleLabel(auth.user?.role));

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

function goKeys() {
  void router.push("/admin/keys");
}

function resetProfile() {
  profileForm.name = auth.user?.name ?? "";
  profileForm.phone = auth.user?.phone ?? "";
  profileForm.dept = auth.user?.dept ?? "";
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
  max-width: 880px;
}

.profile-section {
  margin-top: 18px;
}

.section-heading {
  margin-bottom: 18px;
}

.section-title {
  margin: 0;
  font-size: 17px;
}

.section-desc {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 13px;
}

.profile-form {
  max-width: 720px;
}

.profile-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 24px;
}

.form-actions {
  display: flex;
  gap: 8px;
}

.account-info {
  margin-top: 16px;
}

.password-form {
  max-width: 480px;
}

@media (max-width: 700px) {
  .profile-fields {
    grid-template-columns: 1fr;
  }
}
</style>
