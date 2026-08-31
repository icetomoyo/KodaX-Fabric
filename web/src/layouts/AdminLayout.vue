<template>
  <el-container class="shell">
    <el-aside width="220px" class="aside">
      <div class="brand">
        <strong>KodaX Fabric</strong>
        <span>Token Hub · 管理</span>
      </div>
      <el-menu :default-active="route.path" router>
        <el-menu-item index="/admin">工作台</el-menu-item>
        <el-menu-item v-if="auth.isSuperAdmin" index="/admin/enterprises">企业管理</el-menu-item>
        <el-menu-item v-if="auth.isOrgAdmin" index="/admin/users">员工管理</el-menu-item>
        <el-menu-item v-if="!auth.isSuperAdmin" index="/admin/teams">团队管理</el-menu-item>
        <el-menu-item v-if="auth.isTeamAdmin" index="/admin/members">团队成员</el-menu-item>
        <el-menu-item v-if="auth.isTeamAdmin" index="/admin/projects">项目管理</el-menu-item>
        <el-menu-item v-if="auth.isTeamAdmin" index="/admin/keys">API Key</el-menu-item>
        <el-menu-item v-if="auth.isSuperAdmin" index="/admin/credentials">上游渠道</el-menu-item>
        <el-menu-item v-if="auth.isSuperAdmin" index="/admin/key-bindings">Key 绑定</el-menu-item>
        <el-menu-item v-if="auth.isSuperAdmin" index="/admin/model-prices">模型单价</el-menu-item>
        <el-menu-item v-if="auth.isSuperAdmin" index="/admin/logs">调用日志</el-menu-item>
        <el-menu-item index="/admin/error-logs">报错日志</el-menu-item>
        <el-menu-item v-if="auth.isSuperAdmin || auth.isOrgAdmin" index="/admin/tickets">工单管理</el-menu-item>
        <el-menu-item v-if="auth.isSuperAdmin" index="/admin/ops-audit">操作审计</el-menu-item>
        <el-menu-item index="/admin/profile">个人中心</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-left">
          <router-link to="/admin/profile" class="account-link">
            <strong>{{ auth.user?.name }}</strong>
            <span class="muted">
              · {{ auth.isTeamAdmin ? "团队管理" : auth.isOrgAdmin ? "本企业管理" : "管理后台" }}
              <template v-if="auth.user?.enterprise?.code">
                · 编号 {{ auth.user.enterprise.code }}
              </template>
            </span>
          </router-link>
          <el-tag size="small" effect="plain" type="warning">{{ roleTag }}</el-tag>
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
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { roleLabel } from "@/lib/roles";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const roleTag = computed(() => roleLabel(auth.user?.role));

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
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 18px 16px 16px;
}

.brand strong {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.brand span {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
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
  gap: 16px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}
.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.header-right {
  flex-shrink: 0;
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
  white-space: nowrap;
}
</style>
