<template>
  <el-container class="shell">
    <el-aside width="220px" class="aside">
      <div class="brand">TokenHub Admin</div>
      <el-menu :default-active="route.path" router>
        <el-menu-item index="/admin">概览</el-menu-item>
        <el-menu-item v-if="auth.isAdmin" index="/admin/users">员工管理</el-menu-item>
        <el-menu-item index="/admin/credentials">上游渠道</el-menu-item>
        <el-menu-item index="/admin/logs">调用日志</el-menu-item>
        <el-menu-item v-if="auth.isAdmin" index="/admin/log-grants">日志授权</el-menu-item>
        <el-menu-item v-if="auth.isAdmin" index="/admin/quota">配额策略</el-menu-item>
        <el-menu-item v-if="auth.isAdmin" index="/admin/ops-audit">操作审计</el-menu-item>
        <el-menu-item index="/admin/profile">个人中心</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <router-link to="/admin/profile" class="account-link">
          <strong>{{ auth.user?.name }}</strong>
          <span class="muted"> · 管理后台</span>
        </router-link>
        <el-button link type="primary" @click="onLogout">退出</el-button>
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
  background: #111827;
  color: #fff;
}
.brand {
  padding: 20px 16px;
  font-weight: 700;
}
.aside :deep(.el-menu) {
  border-right: none;
  background: transparent;
}
.aside :deep(.el-menu-item) {
  color: #d1d5db;
}
.aside :deep(.el-menu-item.is-active) {
  background: #1f2937;
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
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}
.shell :deep(.el-main) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}
.account-link {
  color: inherit;
  text-decoration: none;
}
</style>
