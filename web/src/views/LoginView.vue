<template>
  <div class="wrap">
    <div class="card">
      <h1>TokenHub</h1>
      <p class="muted">个人注册后暂无 Token 额度，加入企业后才能调用模型</p>
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
        <el-button class="register-button" text @click="openRegister">注册申请</el-button>
      </el-form>
    </div>

    <el-dialog v-model="showRegister" title="注册" width="460px" destroy-on-close>
      <el-tabs v-model="registerKind">
        <el-tab-pane label="个人注册" name="personal">
          <p class="register-tip">
            注册后可立即使用初始密码 Hz@123456 登录。加入企业（填写企业编号）后才有 Token 额度。
          </p>
        </el-tab-pane>
        <el-tab-pane label="企业注册" name="enterprise">
          <p class="register-tip">
            提交后由超级管理员审核企业。审核通过后，申请人成为该企业的企业管理员，可使用初始密码 Hz@123456 登录。
          </p>
        </el-tab-pane>
      </el-tabs>
      <el-form label-position="top" @submit.prevent="onRegister">
        <el-form-item v-if="registerKind === 'enterprise'" label="企业名称" required>
          <el-input v-model="registerForm.enterpriseName" placeholder="请输入企业名称" />
        </el-form-item>
        <el-form-item label="姓名" required>
          <el-input v-model="registerForm.name" autocomplete="name" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item v-if="registerKind === 'personal'" label="部门" required>
          <el-input v-model="registerForm.dept" autocomplete="organization" placeholder="请输入部门" />
        </el-form-item>
        <el-form-item label="手机号" required>
          <el-input
            v-model="registerForm.phone"
            autocomplete="tel"
            placeholder="请输入手机号"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showRegister = false">取消</el-button>
        <el-button type="primary" :loading="registering" @click="onRegister">
          {{ registerKind === "enterprise" ? "提交企业申请" : "提交注册" }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { homePathForUser } from "@/lib/home";
import { useAuthStore } from "@/stores/auth";

const phone = ref("");
const password = ref("");
const loading = ref(false);
const showRegister = ref(false);
const registering = ref(false);
const registerKind = ref<"personal" | "enterprise">("personal");
const registerForm = reactive({
  name: "",
  dept: "",
  phone: "",
  enterpriseName: "",
});
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

function resolveRedirect(role: "employee" | "admin" | "org_admin" | "team_admin") {
  const home = homePathForUser({ role });
  const raw = route.query.redirect as string | undefined;
  // Admin-facing operators must not be sent to employee pages via redirect
  if (role === "admin" || role === "org_admin" || role === "team_admin") {
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

function openRegister() {
  registerKind.value = "personal";
  registerForm.name = "";
  registerForm.dept = "";
  registerForm.phone = "";
  registerForm.enterpriseName = "";
  showRegister.value = true;
}

async function onRegister() {
  if (!registerForm.name.trim() || !registerForm.phone.trim()) {
    ElMessage.warning("请填写姓名和手机号");
    return;
  }
  if (registerKind.value === "personal" && !registerForm.dept.trim()) {
    ElMessage.warning("请填写部门");
    return;
  }
  if (registerKind.value === "enterprise" && !registerForm.enterpriseName.trim()) {
    ElMessage.warning("请填写企业名称");
    return;
  }

  registering.value = true;
  try {
    const result = await auth.register({
      kind: registerKind.value,
      name: registerForm.name.trim(),
      phone: registerForm.phone.trim(),
      dept: registerForm.dept.trim() || undefined,
      enterpriseName: registerForm.enterpriseName.trim() || undefined,
    });
    phone.value = registerForm.phone.trim();
    showRegister.value = false;
    if (registerKind.value === "enterprise") {
      const code = result.enterprise?.code ? `企业编号 ${result.enterprise.code}。` : "";
      ElMessage.success(`企业申请已提交。${code}请等待超级管理员审核，通过后使用初始密码 Hz@123456 登录。`);
    } else {
      ElMessage.success("注册成功。请使用初始密码 Hz@123456 登录，加入企业后才有 Token 额度。");
    }
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
.register-button {
  display: block;
  width: 100%;
  margin: 8px 0 0 !important;
}
.register-tip {
  margin: 0 0 16px;
  color: #64748b;
  font-size: 14px;
  line-height: 1.6;
}
</style>
