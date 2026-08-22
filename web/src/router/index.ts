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
      meta: { roles: ["employee", "team_admin"] },
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
          path: "tickets",
          name: "me-tickets",
          component: () => import("@/views/me/TicketsView.vue"),
        },
      ],
    },
    {
      path: "/admin",
      component: () => import("@/layouts/AdminLayout.vue"),
      meta: { roles: ["admin", "org_admin", "team_admin"] },
      children: [
        {
          path: "",
          name: "admin-home",
          component: () => import("@/views/admin/DashboardView.vue"),
          meta: { roles: ["admin"] },
        },
        {
          path: "enterprises",
          name: "admin-enterprises",
          component: () => import("@/views/admin/EnterprisesView.vue"),
          meta: { roles: ["admin"] },
        },
        {
          path: "teams",
          name: "admin-teams",
          component: () => import("@/views/admin/TeamsView.vue"),
          meta: { roles: ["admin", "org_admin", "team_admin"] },
        },
        {
          path: "teams/:id",
          name: "admin-team-detail",
          component: () => import("@/views/admin/TeamDetailView.vue"),
          meta: { roles: ["admin", "org_admin", "team_admin"] },
        },
        {
          path: "users",
          name: "admin-users",
          component: () => import("@/views/admin/UsersView.vue"),
          meta: { roles: ["admin", "org_admin"] },
        },
        {
          path: "users/:id",
          name: "admin-user-detail",
          component: () => import("@/views/admin/UserDetailView.vue"),
          meta: { roles: ["admin", "org_admin"] },
        },
        {
          path: "providers",
          redirect: "/admin/credentials",
          meta: { roles: ["admin"] },
        },
        {
          path: "credentials",
          name: "admin-credentials",
          component: () => import("@/views/admin/CredentialsView.vue"),
          meta: { roles: ["admin"] },
        },
        {
          path: "model-routes",
          redirect: "/admin/credentials",
          meta: { roles: ["admin"] },
        },
        {
          path: "logs",
          name: "admin-logs",
          component: () => import("@/views/admin/LogsView.vue"),
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
          path: "tickets",
          name: "admin-tickets",
          component: () => import("@/views/admin/TicketsView.vue"),
          meta: { roles: ["admin"] },
        },
        {
          path: "profile",
          name: "admin-profile",
          component: () => import("@/views/admin/ProfileView.vue"),
          meta: { roles: ["admin", "org_admin", "team_admin"] },
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

  const need = to.matched
    .map((r) => r.meta.roles as string[] | undefined)
    .filter((x): x is string[] => Array.isArray(x) && x.length > 0)
    .at(-1);

  if (need && auth.user && !need.includes(auth.user.role)) {
    return home;
  }

  return true;
});
