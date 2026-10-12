<template>
  <AuthShell>
    <p class="kicker">欢迎回来</p>
    <h2>登录 KodaX Fabric</h2>
    <p class="lead">{{ leadText }}</p>

    <el-radio-group v-model="mode" class="login-mode">
      <el-radio-button value="dingtalk">钉钉登录</el-radio-button>
      <el-radio-button value="ldap">LDAP登录</el-radio-button>
      <el-radio-button value="account">账户登录</el-radio-button>
    </el-radio-group>

    <el-form
      v-if="mode !== 'dingtalk'"
      class="auth-form"
      label-position="top"
      @submit.prevent="onSubmit"
    >
      <el-form-item v-if="mode === 'ldap'" label="公司账号">
        <el-input v-model="username" autocomplete="username" placeholder="公司账号" />
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

    <el-button
      v-else
      class="dingtalk-login"
      :loading="dingtalkLoading"
      style="width: 100%"
      @click="onDingtalk"
    >
      打开钉钉扫码
    </el-button>

    <p v-if="mode === 'account'" class="switch">
      还没有账号？
      <router-link to="/register">申请注册</router-link>
    </p>
  </AuthShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { homePathForUser } from "@/lib/home";
import { useAuthStore } from "@/stores/auth";
import AuthShell from "@/views/AuthShell.vue";

const mode = ref<"dingtalk" | "ldap" | "account">("dingtalk");
const username = ref("");
const phone = ref("");
const password = ref("");
const loading = ref(false);
const dingtalkLoading = ref(false);
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const leadText = computed(() => {
  if (mode.value === "dingtalk") return "Token Hub · 使用钉钉扫码进入工作台或管理后台。";
  if (mode.value === "ldap") return "Token Hub · 使用公司账号登录（与 Wiki 相同）";
  return "Token Hub · 使用注册手机号进入工作台或管理后台。";
});

onMounted(() => {
  const preset = route.query.phone;
  if (typeof preset === "string") phone.value = preset;
});

function resolveRedirect(user: { role: "employee" | "admin" | "org_admin" | "dept_admin"; mustChangePassword: boolean }) {
  if (user.mustChangePassword) return "/change-password";
  const home = homePathForUser({ role: user.role });
  const raw = route.query.redirect as string | undefined;
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

function axiosBody(e: unknown): { code?: string; message?: string; data?: { pendingState?: string } } | undefined {
  return (e as { response?: { data?: { code?: string; message?: string; data?: { pendingState?: string } } } })
    ?.response?.data;
}

async function startDingtalk(pendingState?: string) {
  dingtalkLoading.value = true;
  try {
    const redirectUri = `${window.location.origin}/login/dingtalk`;
    const authorizeUrl = await auth.startDingtalkLogin(redirectUri, pendingState);
    window.location.assign(authorizeUrl);
  } catch (e: unknown) {
    const msg = axiosBody(e)?.message || (e as Error).message || "无法开始钉钉登录";
    ElMessage.error(msg);
    dingtalkLoading.value = false;
  }
}

async function onSubmit() {
  loading.value = true;
  try {
    const user = mode.value === "ldap"
      ? await auth.loginLdap(username.value.trim(), password.value)
      : await auth.login(phone.value.trim(), password.value);
    ElMessage.success("登录成功");
    await router.replace(resolveRedirect(user));
  } catch (e: unknown) {
    const body = axiosBody(e);
    if (body?.code === "INITIAL_PASSWORD_DINGTALK_REQUIRED") {
      try {
        await ElMessageBox.confirm(
          "当前账号仍在使用初始密码。请先通过钉钉确认身份，再设置新密码。是否前往钉钉认证？",
          "需要钉钉认证",
          {
            type: "warning",
            confirmButtonText: "前往钉钉认证",
            cancelButtonText: "取消",
          },
        );
      } catch {
        return;
      }
      await startDingtalk(body.data?.pendingState);
      return;
    }
    ElMessage.error(body?.message || (e as Error).message || "登录失败");
  } finally {
    loading.value = false;
  }
}

async function onDingtalk() {
  await startDingtalk();
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

.dingtalk-login {
  --el-button-text-color: #fff;
  --el-button-bg-color: #1677ff;
  --el-button-border-color: #1677ff;
  --el-button-hover-text-color: #fff;
  --el-button-hover-bg-color: #3c8cff;
  --el-button-hover-border-color: #3c8cff;
  --el-button-active-text-color: #fff;
  --el-button-active-bg-color: #0e63d8;
  --el-button-active-border-color: #0e63d8;
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
