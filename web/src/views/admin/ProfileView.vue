<template>
  <div class="page-card profile-page">
    <h2 class="page-title">个人中心</h2>

    <el-descriptions :column="2" border class="account-info">
      <el-descriptions-item label="姓名">{{ auth.user?.name || "—" }}</el-descriptions-item>
      <el-descriptions-item label="手机号">{{ auth.user?.phone || "—" }}</el-descriptions-item>
      <el-descriptions-item label="角色">{{ roleLabel }}</el-descriptions-item>
      <el-descriptions-item label="部门">{{ auth.user?.dept || "—" }}</el-descriptions-item>
    </el-descriptions>

    <el-divider />

    <h3 class="section-title">修改密码</h3>
    <el-form label-position="top" class="password-form" @submit.prevent="submit">
      <el-form-item label="原密码" required>
        <el-input
          v-model="form.oldPassword"
          type="password"
          show-password
          autocomplete="current-password"
        />
      </el-form-item>
      <el-form-item label="新密码" required>
        <el-input
          v-model="form.newPassword"
          type="password"
          show-password
          autocomplete="new-password"
          :maxlength="128"
        />
      </el-form-item>
      <el-form-item label="确认密码" required>
        <el-input
          v-model="form.confirmPassword"
          type="password"
          show-password
          autocomplete="new-password"
          :maxlength="128"
        />
      </el-form-item>
      <el-button type="primary" native-type="submit" :loading="saving">保存密码</el-button>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const saving = ref(false);
const form = reactive({
  oldPassword: "",
  newPassword: "",
  confirmPassword: "",
});

const roleLabel = computed(() => ({
  admin: "管理员",
  auditor: "审计员",
  employee: "员工",
}[auth.user?.role || "employee"]));

async function submit() {
  if (!form.oldPassword || !form.newPassword) {
    ElMessage.warning("请填写密码");
    return;
  }
  if (form.newPassword !== form.confirmPassword) {
    ElMessage.warning("两次密码不一致");
    return;
  }

  saving.value = true;
  try {
    await auth.changePassword(form.oldPassword, form.newPassword);
    form.oldPassword = "";
    form.newPassword = "";
    form.confirmPassword = "";
    ElMessage.success("密码已修改");
  } catch (error: unknown) {
    const message = (error as { response?: { data?: { message?: string } } })
      .response?.data?.message;
    ElMessage.error(message || "修改失败");
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.profile-page {
  max-width: 880px;
}

.account-info {
  margin-top: 16px;
}

.section-title {
  margin: 0 0 16px;
  font-size: 17px;
}

.password-form {
  max-width: 480px;
}
</style>
