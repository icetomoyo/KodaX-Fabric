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
        <div class="account">
          <strong>{{ auth.user?.name }}</strong>
          <span class="muted"> · {{ auth.user?.phone }} · 员工工作台</span>
        </div>
        <div class="header-right">
          <el-button link type="primary" @click="onLogout">退出</el-button>
        </div>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

function onLogout() {
  auth.logout();
  router.push("/login");
}
</script>

<style scoped>
.shell {
  height: 100vh;
  overflow: hidden;
}
.aside {
  height: 100%;
  overflow-y: auto;
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
.shell > :deep(.el-container) {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.header-right {
  flex-shrink: 0;
}
.account {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.shell :deep(.el-main) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}
.muted {
  color: #6b7280;
  font-size: 13px;
}
</style>
