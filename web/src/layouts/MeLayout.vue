<template>
  <el-container class="shell">
    <el-aside width="220px" class="aside">
      <div class="brand">TokenHub</div>
      <el-menu :default-active="route.path" router>
        <el-menu-item index="/me">工作台</el-menu-item>
        <el-menu-item index="/me/keys">API Key</el-menu-item>
        <el-menu-item index="/me/logs">我的调用</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div>
          <strong>{{ auth.user?.name }}</strong>
          <span class="muted"> · {{ auth.user?.phone }} · {{ roleLabel }}</span>
        </div>
        <el-button link type="primary" @click="onLogout">退出</el-button>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const roleLabel = computed(() => {
  const map: Record<string, string> = {
    admin: "管理员",
    auditor: "审计员",
    employee: "员工",
  };
  return map[auth.user?.role ?? ""] ?? "";
});

function onLogout() {
  auth.logout();
  router.push("/login");
}
</script>

<style scoped>
.shell {
  min-height: 100vh;
}
.aside {
  background: #0f172a;
  color: #fff;
}
.brand {
  padding: 20px 16px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.aside :deep(.el-menu) {
  border-right: none;
  background: transparent;
}
.aside :deep(.el-menu-item) {
  color: #cbd5e1;
}
.aside :deep(.el-menu-item.is-active) {
  background: #1e293b;
  color: #fff;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}
</style>
