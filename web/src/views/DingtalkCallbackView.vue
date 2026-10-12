<template>
  <AuthShell>
    <p class="kicker">钉钉登录</p>
    <h2>{{ error ? "登录失败" : "正在登录" }}</h2>
    <p class="lead">{{ error || "已从钉钉返回，正在核对本企业通讯录。" }}</p>
    <el-button v-if="error" type="primary" style="width: 100%" @click="router.replace('/login')">
      返回登录
    </el-button>
  </AuthShell>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { homePathForUser } from "@/lib/home";
import { useAuthStore } from "@/stores/auth";
import AuthShell from "@/views/AuthShell.vue";

const error = ref("");
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

function queryValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

function resolveRedirect(user: { role: "employee" | "admin" | "org_admin" | "dept_admin"; mustChangePassword: boolean }) {
  if (user.mustChangePassword) return "/change-password";
  const home = homePathForUser({ role: user.role });
  const raw = queryValue(route.query.redirect);
  if (raw === "/change-password") {
    return user.role === "employee" ? "/me/profile" : "/admin/profile";
  }
  if (user.role === "admin" || user.role === "org_admin" || user.role === "dept_admin") {
    if (!raw || raw.startsWith("/me")) return home;
    if (raw.startsWith("/admin")) return raw;
    return home;
  }
  if (raw && raw.startsWith("/admin")) return home;
  return raw || home;
}

onMounted(async () => {
  const code = queryValue(route.query.authCode) || queryValue(route.query.code);
  const state = queryValue(route.query.state);
  if (!code || !state) {
    error.value = "钉钉未返回授权码，请重新登录。";
    return;
  }
  try {
    const user = await auth.loginDingtalk(code, state);
    ElMessage.success(user.mustChangePassword ? "钉钉认证通过，请设置新密码" : "登录成功");
    await router.replace(resolveRedirect(user));
  } catch (e: unknown) {
    error.value =
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
      (e as Error).message ||
      "钉钉登录失败";
  }
});
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
</style>
