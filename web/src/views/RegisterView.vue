<template>
  <AuthShell>
    <p class="kicker">新账号</p>
    <h2>申请注册</h2>
    <p class="lead">设置登录密码后即可使用。员工权限由团队邀请开通。</p>

    <el-form class="auth-form" label-position="top" @submit.prevent="onRegister">
      <el-form-item label="姓名" required>
        <el-input v-model="registerForm.name" autocomplete="name" placeholder="请输入姓名" />
      </el-form-item>
      <el-form-item label="手机号" required>
        <el-input
          v-model="registerForm.phone"
          autocomplete="tel"
          placeholder="11 位手机号"
        />
      </el-form-item>
      <el-form-item label="密码" required>
        <el-input
          v-model="registerForm.password"
          type="password"
          show-password
          autocomplete="new-password"
          placeholder="至少 8 位，需包含字母和数字"
        />
      </el-form-item>
      <el-button type="primary" native-type="submit" :loading="registering">
        提交注册
      </el-button>
    </el-form>

    <p class="switch">
      已有账号？
      <router-link to="/login">返回登录</router-link>
    </p>
  </AuthShell>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import AuthShell from "@/views/AuthShell.vue";

const registering = ref(false);
const registerForm = reactive({
  name: "",
  phone: "",
  password: "",
});
const auth = useAuthStore();
const router = useRouter();

async function onRegister() {
  if (!registerForm.name.trim() || !registerForm.phone.trim() || !registerForm.password) {
    ElMessage.warning("请填写姓名、手机号和密码");
    return;
  }

  registering.value = true;
  try {
    await auth.register({
      name: registerForm.name.trim(),
      phone: registerForm.phone.trim(),
      password: registerForm.password,
    });
    ElMessage.success("注册成功，请登录");
    await router.replace({ path: "/login", query: { phone: registerForm.phone.trim() } });
  } catch (e: unknown) {
    const msg =
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
      (e as Error).message ||
      "提交申请失败";
    ElMessage.error(msg);
  } finally {
    registering.value = false;
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
