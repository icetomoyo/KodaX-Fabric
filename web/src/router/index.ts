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
          path: "logs",
          name: "me-logs",
          component: () => import("@/views/me/LogsView.vue"),
        },
      ],
    },
    {
      path: "/admin",
      component: () => import("@/layouts/AdminLayout.vue"),
      meta: { roles: ["admin", "auditor"] },
      children: [
        {
          path: "",
          name: "admin-home",
          component: () => import("@/views/admin/DashboardView.vue"),
        },
        {
          path: "users",
          name: "admin-users",
          component: () => import("@/views/admin/UsersView.vue"),
          meta: { roles: ["admin"] },
        },
        {
          path: "providers",
          redirect: "/admin/credentials",
          meta: { roles: ["admin", "auditor"] },
        },
        {
          path: "credentials",
          name: "admin-credentials",
          component: () => import("@/views/admin/CredentialsView.vue"),
          meta: { roles: ["admin", "auditor"] },
        },
        {
          path: "model-routes",
          redirect: "/admin/credentials",
          meta: { roles: ["admin", "auditor"] },
        },
        {
          path: "logs",
          name: "admin-logs",
          component: () => import("@/views/admin/LogsView.vue"),
        },
        {
          path: "log-grants",
          name: "admin-log-grants",
          component: () => import("@/views/admin/LogGrantsView.vue"),
          meta: { roles: ["admin"] },
        },
        {
          path: "quota",
          name: "admin-quota",
          component: () => import("@/views/admin/QuotaView.vue"),
          meta: { roles: ["admin"] },
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
        },
      ],
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  const home = homePathForUser(auth.user);

  if (to.meta.public) {
    if (auth.isLoggedIn && to.name === "login") {
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

  if (auth.user && (auth.user.role === "admin" || auth.user.role === "auditor")) {
    if (to.path === "/me" || to.path.startsWith("/me/")) {
      return "/admin";
    }
  }

  const need = to.matched
    .map((r) => r.meta.roles as string[] | undefined)
    .filter((x): x is string[] => Array.isArray(x) && x.length > 0)
    .at(-1);

  if (need && auth.user && !need.includes(auth.user.role)) {
    return home;
  }

  if (to.path.startsWith("/admin") && auth.user?.role === "employee") {
    return "/me";
  }

  return true;
});
