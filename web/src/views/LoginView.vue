<template>
  <AuthShell>
    <p class="kicker">欢迎回来</p>
    <h2>登录 KodaX Fabric</h2>
    <p class="lead">{{
      mode === "ldap"
        ? "Token Hub · 使用公司账号登录（与 Wiki 相同）"
        : "Token Hub · 使用注册手机号进入工作台或管理后台。"
    }}</p>

    <el-radio-group v-model="mode" class="login-mode">
      <el-radio-button value="ldap">LDAP登录</el-radio-button>
      <el-radio-button value="account">账户登录</el-radio-button>
    </el-radio-group>

    <el-form class="auth-form" label-position="top" @submit.prevent="onSubmit">
      <el-form-item v-if="mode === 'ldap'" label="公司账号">
        <el-input v-model="username" autocomplete="username" placeholder="如 zhangchuang" />
      </el-form-item>
      <el-form-item v-else label="手机号">
        <el-input v-model="phone" autocomplete="username" placeholder="11 位手机号" />
      </el-form-item>
      <el-form-item label="密码">
        <el-input
          v-model="password"
          type="password"
          show-password
          autocomplete="current-password"
          placeholder="请输入密码"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" native-type="submit" :loading="loading" style="width: 100%">
          登录
        </el-button>
      </el-form-item>
    </el-form>

    <p v-if="mode === 'account'" class="switch">
      还没有账号？
      <router-link to="/register">申请注册</router-link>
    </p>
  </AuthShell>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { homePathForUser } from "@/lib/home";
import { useAuthStore } from "@/stores/auth";
import AuthShell from "@/views/AuthShell.vue";

const mode = ref<"ldap" | "account">("ldap");
const username = ref("");
const phone = ref("");
const password = ref("");
const loading = ref(false);
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

onMounted(() => {
  const preset = route.query.phone;
  if (typeof preset === "string") phone.value = preset;
});

function resolveRedirect(role: "employee" | "admin" | "org_admin" | "dept_admin" | "team_admin") {
  const home = homePathForUser({ role });
  const raw = route.query.redirect as string | undefined;
  if (role === "admin" || role === "org_admin" || role === "dept_admin" || role === "team_admin") {
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
    const user = mode.value === "ldap"
      ? await auth.loginLdap(username.value.trim(), password.value)
      : await auth.login(phone.value.trim(), password.value);
    ElMessage.success("登录成功");
    if (mode.value !== "ldap" && user.mustChangePassword) {
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

.login-mode {
  margin-bottom: 20px;
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
