<template>
  <el-container class="shell">
    <el-aside width="220px" class="aside">
      <div class="brand">
        <strong>KodaX Fabric</strong>
        <span>Token Hub · 管理</span>
      </div>
      <el-menu
        :default-active="route.path"
        :default-openeds="['upstream']"
        router
        class="aside-menu"
        background-color="#111827"
        text-color="#d1d5db"
        active-text-color="#ffffff"
      >
        <el-menu-item index="/admin">工作台</el-menu-item>
        <el-menu-item v-if="auth.isSuperAdmin" index="/admin/enterprises">企业管理</el-menu-item>
        <el-menu-item v-if="auth.isOrgAdmin" index="/admin/enterprises">本企业编制</el-menu-item>
        <el-menu-item v-if="auth.isDeptAdmin" index="/admin/enterprises">本部门编制</el-menu-item>
        <el-menu-item v-if="auth.isTeamAdmin" index="/admin/enterprises">员工</el-menu-item>
        <el-menu-item v-if="auth.isOrgAdmin || auth.isDeptAdmin || auth.isTeamAdmin" index="/admin/keys">API Key</el-menu-item>
        <el-menu-item v-if="auth.isOrgAdmin || auth.isDeptAdmin || auth.isTeamAdmin" index="/admin/models">模型列表</el-menu-item>
        <el-menu-item v-if="auth.isOrgAdmin || auth.isDeptAdmin || auth.isTeamAdmin" index="/admin/guide">接入教程</el-menu-item>
        <el-menu-item v-if="auth.isOrgAdmin || auth.isDeptAdmin || auth.isTeamAdmin" index="/admin/my-logs">我的调用</el-menu-item>
        <el-sub-menu v-if="auth.isSuperAdmin" index="upstream">
          <template #title>上游</template>
          <el-menu-item index="/admin/channels">渠道</el-menu-item>
          <el-menu-item index="/admin/seats">席位</el-menu-item>
          <el-menu-item index="/admin/channel-keys">渠道 KEY</el-menu-item>
        </el-sub-menu>
        <el-menu-item v-if="auth.isSuperAdmin || auth.isOrgAdmin" index="/admin/key-bindings">调度画布</el-menu-item>
        <el-menu-item v-if="auth.isSuperAdmin" index="/admin/model-prices">模型列表</el-menu-item>
        <el-menu-item v-if="auth.isSuperAdmin" index="/admin/logs">调用日志</el-menu-item>
        <el-menu-item index="/admin/error-logs">报错日志</el-menu-item>
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
              · {{
                auth.isTeamAdmin
                  ? "团队管理"
                  : auth.isDeptAdmin
                    ? "本部门管理"
                    : auth.isOrgAdmin
                      ? "本企业管理"
                      : "管理后台"
              }}
              <template v-if="auth.user?.enterprise?.code">
                · 编号 {{ auth.user.enterprise.code }}
              </template>
            </span>
          </router-link>
          <el-tag effect="plain" type="warning">{{ roleTag }}</el-tag>
          <el-tag
            v-if="auth.user?.actAs"
            effect="light"
            type="danger"
          >
            临时 · {{ auth.user.actAs.label }}
          </el-tag>
        </div>
        <div class="header-right">
          <el-button v-if="auth.canSwitchActAs" @click="actAsOpen = true">
            切换临时权限
          </el-button>
          <el-button link type="primary" @click="onLogout">退出</el-button>
        </div>
      </el-header>
      <el-main :class="{ 'is-canvas': route.path === '/admin/key-bindings' }">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
  <ActAsDrawer v-model="actAsOpen" />
  <TokenBotPanel />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import TokenBotPanel from "@/components/TokenBotPanel.vue";
import { roleLabel } from "@/lib/roles";
import { useAuthStore } from "@/stores/auth";
import ActAsDrawer from "@/views/admin/ActAsDrawer.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const actAsOpen = ref(false);
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
  font-weight: 700;
}

.brand span {
  color: var(--el-color-info-light-3);
}
.aside-menu {
  border-right: none;
}

.aside-menu :deep(.el-sub-menu__title) {
  color: #d1d5db !important;
  background: #111827 !important;
}

.aside-menu :deep(.el-sub-menu .el-menu) {
  background: #0f172a !important;
}
.shell > .el-container {
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
.shell .el-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}
.shell .el-main.is-canvas {
  padding: 0;
  overflow: hidden;
}
.account-link {
  color: inherit;
  text-decoration: none;
  white-space: nowrap;
}
</style>
