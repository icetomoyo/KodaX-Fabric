<template>
  <el-container class="shell">
    <el-aside width="220px" class="aside">
      <div class="brand">
        <strong>KodaX Fabric</strong>
        <span>Token Hub</span>
      </div>
      <el-menu
        :default-active="route.path"
        router
        class="aside-menu"
        background-color="#0f172a"
        text-color="#cbd5e1"
        active-text-color="#ffffff"
      >
        <el-menu-item index="/me">工作台</el-menu-item>
        <el-menu-item index="/me/keys">API Key</el-menu-item>
        <el-menu-item index="/me/models">模型列表</el-menu-item>
        <el-menu-item index="/me/guide">接入教程</el-menu-item>
        <el-menu-item index="/me/logs">我的调用</el-menu-item>
        <el-menu-item index="/me/profile">个人中心</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-left">
          <router-link to="/me/profile" class="account-link">
            <strong>{{ auth.user?.name }}</strong>
            <span class="muted">
              · {{ auth.user?.phone }}
              · {{ auth.user?.enterprise?.name ? `${auth.user.enterprise.name} · ${auth.user.enterprise.code}` : "普通注册用户" }}
            </span>
          </router-link>
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
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
  <ActAsDrawer v-model="actAsOpen" />
  <TokenBotPanel />
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import TokenBotPanel from "@/components/TokenBotPanel.vue";
import { useAuthStore } from "@/stores/auth";
import ActAsDrawer from "@/views/admin/ActAsDrawer.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const actAsOpen = ref(false);

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
.account-link {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.account-link:hover strong {
  color: var(--el-color-primary);
}
.shell .el-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}
.muted {
  color: var(--el-text-color-secondary);
}
</style>
