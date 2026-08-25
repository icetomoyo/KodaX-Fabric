<template>
  <AuthShell>
    <p class="kicker">账号安全</p>
    <h2>修改密码</h2>
    <p class="lead">首次登录或重置后，需要设置新密码才能继续。</p>
    <el-form class="auth-form" label-position="top" @submit.prevent="onSubmit">
      <el-form-item label="原密码">
        <el-input v-model="oldPassword" type="password" show-password autocomplete="current-password" />
      </el-form-item>
      <el-form-item label="新密码">
        <el-input v-model="newPassword" type="password" show-password autocomplete="new-password" :maxlength="128" />
      </el-form-item>
      <el-form-item label="确认新密码">
        <el-input v-model="confirm" type="password" show-password autocomplete="new-password" :maxlength="128" />
      </el-form-item>
      <el-button type="primary" native-type="submit" :loading="loading">
        确认修改
      </el-button>
    </el-form>
  </AuthShell>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { homePathForUser } from "@/lib/home";
import { useAuthStore } from "@/stores/auth";
import AuthShell from "@/views/AuthShell.vue";

const oldPassword = ref("");
const newPassword = ref("");
const confirm = ref("");
const loading = ref(false);
const auth = useAuthStore();
const router = useRouter();

async function onSubmit() {
  if (newPassword.value !== confirm.value) {
    ElMessage.warning("两次输入的新密码不一致");
    return;
  }
  loading.value = true;
  try {
    const user = await auth.changePassword(oldPassword.value, newPassword.value);
    ElMessage.success("密码已更新");
    await router.replace(homePathForUser(user));
  } catch (e: unknown) {
    const msg =
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
      (e as Error).message ||
      "修改失败";
    ElMessage.error(msg);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.kicker {
  margin: 0 0 8px;
  color: #2563eb;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

h2 {
  margin: 0 0 8px;
  color: #0f172a;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.03em;
}

.lead {
  margin: 0 0 28px;
  color: #64748b;
  font-size: 14px;
  line-height: 1.6;
}

.auth-form :deep(.el-button) {
  width: 100%;
  margin-top: 8px;
}
</style>
