import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { http } from "@/api/http";

export type User = {
  id: number;
  name: string;
  phone: string;
  dept?: string | null;
  role: "employee" | "admin" | "auditor";
  status: string;
  mustChangePassword: boolean;
  lastLoginAt?: string | null;
};

const TOKEN_KEY = "th_token";
const USER_KEY = "th_user";

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY));
  const user = ref<User | null>(
    localStorage.getItem(USER_KEY) ? JSON.parse(localStorage.getItem(USER_KEY)!) : null,
  );

  const isLoggedIn = computed(() => Boolean(token.value));
  const isAdmin = computed(() => user.value?.role === "admin");
  const isAuditor = computed(
    () => user.value?.role === "admin" || user.value?.role === "auditor",
  );

  function setSession(nextToken: string, nextUser: User) {
    token.value = nextToken;
    user.value = nextUser;
    localStorage.setItem(TOKEN_KEY, nextToken);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
  }

  function logout() {
    token.value = null;
    user.value = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function login(phone: string, password: string) {
    const { data } = await http.post("/api/auth/login", { phone, password });
    if (!data.success) throw new Error(data.message || "登录失败");
    setSession(data.data.token, data.data.user);
    return data.data.user as User;
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
    isLoggedIn,
    isAdmin,
    isAuditor,
    setSession,
    logout,
    login,
    changePassword,
    fetchMe,
  };
});
