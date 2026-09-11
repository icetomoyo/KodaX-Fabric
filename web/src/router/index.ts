import { createRouter, createWebHistory } from "vue-router";
import { homePathForUser } from "@/lib/home";
import { useAuthStore } from "@/stores/auth";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/LoginView.vue"),
      meta: { public: true },
    },
    {
      path: "/register",
      name: "register",
      component: () => import("@/views/RegisterView.vue"),
      meta: { public: true },
    },
    {
      path: "/change-password",
      name: "change-password",
      component: () => import("@/views/ChangePasswordView.vue"),
    },
    {
      path: "/",
      redirect: () => {
        const auth = useAuthStore();
        return homePathForUser(auth.user);
      },
    },
    {
      path: "/me",
      component: () => import("@/layouts/MeLayout.vue"),
      meta: { roles: ["employee"] },
      children: [
        {
          path: "",
          name: "me-home",
          component: () => import("@/views/me/HomeView.vue"),
        },
        {
          path: "keys",
          name: "me-keys",
          component: () => import("@/views/me/KeysView.vue"),
        },
        {
          path: "models",
          name: "me-models",
          component: () => import("@/views/me/ModelsView.vue"),
        },
        {
          path: "guide",
          name: "me-guide",
          component: () => import("@/views/me/GuideView.vue"),
        },
        {
          path: "logs",
          name: "me-logs",
          component: () => import("@/views/me/LogsView.vue"),
        },
        {
          path: "profile",
          name: "me-profile",
          component: () => import("@/views/admin/ProfileView.vue"),
        },
      ],
    },
    {
      path: "/admin",
      component: () => import("@/layouts/AdminLayout.vue"),
      meta: { roles: ["admin", "org_admin", "dept_admin", "team_admin"] },
      children: [
        {
          path: "",
          name: "admin-home",
          component: () => import("@/views/admin/DashboardView.vue"),
          meta: { roles: ["admin", "org_admin", "dept_admin", "team_admin"] },
        },
        {
          path: "enterprises",
          name: "admin-enterprises",
          component: () => import("@/views/admin/EnterprisesView.vue"),
          meta: { roles: ["admin", "org_admin", "dept_admin", "team_admin"] },
        },
        {
          path: "departments",
          redirect: "/admin/enterprises",
        },
        {
          path: "teams",
          redirect: "/admin/enterprises",
        },
        {
          path: "teams/:id",
          redirect: "/admin/enterprises",
        },
        {
          path: "members",
          redirect: "/admin/enterprises",
        },
        {
          path: "keys",
          name: "admin-keys",
          component: () => import("@/views/me/KeysView.vue"),
          meta: { roles: ["org_admin", "dept_admin", "team_admin"] },
        },
        {
          path: "models",
          name: "admin-models",
          component: () => import("@/views/me/ModelsView.vue"),
          meta: { roles: ["org_admin", "dept_admin", "team_admin"] },
        },
        {
          path: "guide",
          name: "admin-guide",
          component: () => import("@/views/me/GuideView.vue"),
          meta: { roles: ["org_admin", "dept_admin", "team_admin"] },
        },
        {
          path: "my-logs",
          name: "admin-my-logs",
          component: () => import("@/views/me/LogsView.vue"),
          meta: { roles: ["org_admin", "dept_admin", "team_admin"] },
        },
        {
          path: "users",
          redirect: "/admin/enterprises",
        },
        {
          path: "users/:id",
          name: "admin-user-detail",
          component: () => import("@/views/admin/UserDetailView.vue"),
          meta: { roles: ["org_admin"] },
        },
        {
          path: "providers",
          redirect: "/admin/channels",
          meta: { roles: ["admin"] },
        },
        {
          path: "credentials",
          redirect: "/admin/channel-keys",
          meta: { roles: ["admin"] },
        },
        {
          path: "channels",
          name: "admin-channels",
          component: () => import("@/views/admin/CredentialsView.vue"),
          meta: { roles: ["admin"] },
        },
        {
          path: "channel-keys",
          name: "admin-channel-keys",
          component: () => import("@/views/admin/CredentialsView.vue"),
          meta: { roles: ["admin"] },
        },
        {
          path: "seats",
          name: "admin-seats",
          component: () => import("@/views/admin/SeatsView.vue"),
          meta: { roles: ["admin"] },
        },
        {
          path: "key-bindings",
          name: "admin-key-bindings",
          component: () => import("@/views/admin/KeyBindingsView.vue"),
          meta: { roles: ["admin", "org_admin"] },
        },
        {
          path: "model-prices",
          name: "admin-model-prices",
          component: () => import("@/views/admin/ModelPricesView.vue"),
          meta: { roles: ["admin"] },
        },
        {
          path: "model-routes",
          redirect: "/admin/channels",
          meta: { roles: ["admin"] },
        },
        {
          path: "logs",
          name: "admin-logs",
          component: () => import("@/views/admin/LogsView.vue"),
          meta: { roles: ["admin"] },
        },
        {
          path: "error-logs",
          name: "admin-error-logs",
          component: () => import("@/views/admin/ErrorLogsView.vue"),
          meta: { roles: ["admin", "org_admin", "dept_admin", "team_admin"] },
        },
        {
          path: "ops-audit",
          name: "admin-ops-audit",
          component: () => import("@/views/admin/OpsAuditView.vue"),
          meta: { roles: ["admin"] },
        },
        {
          path: "profile",
          name: "admin-profile",
          component: () => import("@/views/admin/ProfileView.vue"),
          meta: { roles: ["admin", "org_admin", "dept_admin", "team_admin"] },
        },
      ],
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  const home = homePathForUser(auth.user);

  if (to.meta.public) {
    if (auth.isLoggedIn && (to.name === "login" || to.name === "register")) {
      return auth.user?.mustChangePassword ? "/change-password" : home;
    }
    return true;
  }

  if (!auth.isLoggedIn) {
    return { path: "/login", query: { redirect: to.fullPath } };
  }

  if (auth.user?.mustChangePassword && to.name !== "change-password") {
    return "/change-password";
  }

  if (!auth.user?.mustChangePassword && to.name === "change-password") {
    return home;
  }

  const need = to.matched
    .map((r) => r.meta.roles as string[] | undefined)
    .filter((x): x is string[] => Array.isArray(x) && x.length > 0)
    .at(-1);

  if (need && auth.user && !need.includes(auth.user.role)) {
    return home;
  }

  return true;
});
