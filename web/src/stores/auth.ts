import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { http } from "@/api/http";

export type UserEnterprise = {
  id: number;
  name: string;
  code: string;
  status: string;
};

export type ActAsPayload = {
  role: "org_admin" | "dept_admin" | "team_admin" | "employee";
  enterpriseId: number;
  departmentId?: number;
  teamId?: number;
  employeeId?: number;
};

export type UserActAs = ActAsPayload & {
  label: string;
};

export type User = {
  id: number;
  name: string;
  phone: string;
  dept?: string | null;
  role: "employee" | "admin" | "org_admin" | "dept_admin" | "team_admin";
  status: string;
  enterpriseId?: number | null;
  enterprise?: UserEnterprise | null;
  mustChangePassword: boolean;
  lastLoginAt?: string | null;
  trueRole?: "employee" | "admin" | "org_admin" | "dept_admin" | "team_admin";
  actAs?: UserActAs | null;
};

const TOKEN_KEY = "th_token";
const USER_KEY = "th_user";
const ACT_AS_KEY = "th_act_as";

function readStoredActAs(): ActAsPayload | null {
  const raw = localStorage.getItem(ACT_AS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ActAsPayload;
    if (
      parsed?.role === "org_admin"
      || parsed?.role === "dept_admin"
      || parsed?.role === "team_admin"
      || parsed?.role === "employee"
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY));
  const user = ref<User | null>(
    localStorage.getItem(USER_KEY) ? JSON.parse(localStorage.getItem(USER_KEY)!) : null,
  );
  const actAs = ref<ActAsPayload | null>(readStoredActAs());

  const isLoggedIn = computed(() => Boolean(token.value));
  const trueRole = computed(() => user.value?.trueRole ?? user.value?.role);
  const canSwitchActAs = computed(() => trueRole.value === "admin");
  const isSuperAdmin = computed(() => user.value?.role === "admin");
  const isOrgAdmin = computed(() => user.value?.role === "org_admin");
  const isDeptAdmin = computed(() => user.value?.role === "dept_admin");
  const isTeamAdmin = computed(() => user.value?.role === "team_admin");
  const isAdmin = computed(
    () => isSuperAdmin.value || isOrgAdmin.value || isDeptAdmin.value || isTeamAdmin.value,
  );

  function setSession(nextToken: string, nextUser: User) {
    token.value = nextToken;
    user.value = nextUser;
    localStorage.setItem(TOKEN_KEY, nextToken);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
  }

  function setActAs(next: ActAsPayload | null) {
    actAs.value = next;
    if (next) localStorage.setItem(ACT_AS_KEY, JSON.stringify(next));
    else localStorage.removeItem(ACT_AS_KEY);
  }

  function logout() {
    token.value = null;
    user.value = null;
    actAs.value = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ACT_AS_KEY);
  }

  async function login(phone: string, password: string) {
    const { data } = await http.post("/api/auth/login", { phone, password });
    if (!data.success) throw new Error(data.message || "登录失败");
    setSession(data.data.token, data.data.user);
    return data.data.user as User;
  }

  async function register(payload: {
    name: string;
    phone: string;
    password: string;
  }) {
    const { data } = await http.post("/api/auth/register", payload);
    if (!data.success) throw new Error(data.message || "提交申请失败");
    return data.data;
  }

  async function changePassword(oldPassword: string, newPassword: string) {
    const { data } = await http.post("/api/auth/change-password", {
      oldPassword,
      newPassword,
    });
    if (!data.success) throw new Error(data.message || "修改失败");
    setSession(data.data.token, data.data.user);
    return data.data.user as User;
  }

  async function fetchMe() {
    const { data } = await http.get("/api/auth/me");
    if (!data.success) throw new Error(data.message || "获取用户失败");
    user.value = data.data;
    localStorage.setItem(USER_KEY, JSON.stringify(data.data));
    return data.data as User;
  }

  return {
    token,
    user,
    actAs,
    isLoggedIn,
    isAdmin,
    isSuperAdmin,
    isOrgAdmin,
    isDeptAdmin,
    isTeamAdmin,
    trueRole,
    canSwitchActAs,
    setSession,
    setActAs,
    logout,
    login,
    register,
    changePassword,
    fetchMe,
  };
});
