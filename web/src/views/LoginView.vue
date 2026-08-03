<template>
  <div class="wrap">
    <div class="card">
      <h1>TokenHub</h1>
      <p class="muted">公司内网模型出口 · 账号由管理员开通</p>
      <el-form label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="手机号">
          <el-input v-model="phone" autocomplete="username" placeholder="登录手机号" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="password"
            type="password"
            show-password
            autocomplete="current-password"
            placeholder="初始密码首次登录后需修改"
          />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="loading" style="width: 100%">
          登录
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { homePathForUser } from "@/lib/home";
import { useAuthStore } from "@/stores/auth";

const phone = ref("");
const password = ref("");
const loading = ref(false);
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

function resolveRedirect(role: "employee" | "admin" | "auditor") {
  const home = homePathForUser({ role });
  const raw = route.query.redirect as string | undefined;
  // Admin must not be sent to employee pages via redirect
  if (role === "admin" || role === "auditor") {
    if (!raw || raw.startsWith("/me")) return home;
    if (raw.startsWith("/admin") || raw === "/change-password") return raw;
    return home;
  }
  if (raw && raw.startsWith("/admin")) return home;
  return raw || home;
}

async function onSubmit() {
  loading.value = true;
  try {
    const user = await auth.login(phone.value.trim(), password.value);
    ElMessage.success("登录成功");
    if (user.mustChangePassword) {
      await router.replace("/change-password");
      return;
    }
    await router.replace(resolveRedirect(user.role));
  } catch (e: unknown) {
    const msg =
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
      (e as Error).message ||
      "登录失败";
    ElMessage.error(msg);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at top left, #dbeafe, transparent 40%),
    radial-gradient(circle at bottom right, #e0e7ff, transparent 35%),
    #f8fafc;
}
.card {
  width: 380px;
  background: #fff;
  border-radius: 16px;
  padding: 32px 28px;
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.08);
}
h1 {
  margin: 0 0 4px;
  font-size: 24px;
}
.muted {
  margin: 0 0 24px;
}
</style>
