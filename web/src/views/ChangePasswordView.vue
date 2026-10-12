<template>
  <AuthShell>
    <p class="kicker">安全验证</p>
    <h2>设置新密码</h2>
    <p class="lead">钉钉认证已通过。当前账号仍是初始密码，请设置新密码后再进入系统。</p>

    <el-form class="auth-form" label-position="top" @submit.prevent="onSubmit">
      <el-form-item label="新密码">
        <el-input
          v-model="password"
          type="password"
          show-password
          autocomplete="new-password"
          placeholder="至少 8 位，含字母和数字"
        />
      </el-form-item>
      <el-form-item label="确认密码">
        <el-input
          v-model="confirm"
          type="password"
          show-password
          autocomplete="new-password"
          placeholder="再次输入新密码"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" native-type="submit" :loading="loading" style="width: 100%">
          保存并进入
        </el-button>
      </el-form-item>
    </el-form>

    <p class="switch">
      <a href="#" @click.prevent="onLogout">退出登录</a>
    </p>
  </AuthShell>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { homePathForUser } from "@/lib/home";
import { useAuthStore } from "@/stores/auth";
import AuthShell from "@/views/AuthShell.vue";

const password = ref("");
const confirm = ref("");
const loading = ref(false);
const auth = useAuthStore();
const router = useRouter();

async function onSubmit() {
  if (!password.value || !confirm.value) {
    ElMessage.warning("请填写新密码");
    return;
  }
  if (password.value !== confirm.value) {
    ElMessage.warning("两次密码不一致");
    return;
  }
  loading.value = true;
  try {
    const user = await auth.changePassword(undefined, password.value);
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

function onLogout() {
  auth.logout();
  void router.replace("/login");
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
  margin: 0 0 20px;
  color: #64748b;
  font-size: 14px;
  line-height: 1.6;
}

.switch {
  margin: 22px 0 0;
  color: #64748b;
  font-size: 13px;
}

.switch a {
  color: #0f172a;
  font-weight: 600;
}

.switch a:hover {
  color: #2563eb;
}
</style>
