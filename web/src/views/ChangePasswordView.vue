<template>
  <div class="wrap">
    <div class="card">
      <h1>修改密码</h1>
      <p class="muted">首次登录或管理员重置后，必须修改密码后才能继续使用</p>
      <el-form label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="原密码">
          <el-input v-model="oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="newPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="confirm" type="password" show-password />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="loading" style="width: 100%">
          确认修改
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { homePathForUser } from "@/lib/home";
import { useAuthStore } from "@/stores/auth";

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
.wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #f8fafc;
}
.card {
  width: 400px;
  background: #fff;
  border-radius: 16px;
  padding: 32px 28px;
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.08);
}
h1 {
  margin: 0 0 4px;
  font-size: 22px;
}
.muted {
  margin: 0 0 20px;
}
</style>
