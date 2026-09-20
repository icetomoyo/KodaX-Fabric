import axios from "axios";
import { useAuthStore } from "@/stores/auth";

export const http = axios.create({
  baseURL: "",
  timeout: 30000,
});

http.interceptors.request.use((config) => {
  const auth = useAuthStore();
  if (auth.token) {
    config.headers.Authorization = `Bearer ${auth.token}`;
  }
  if (auth.actAs) {
    config.headers["X-Act-As"] = JSON.stringify(auth.actAs);
  }
  return config;
});

http.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const code = err.response?.data?.code;
    if (status === 401) {
      const auth = useAuthStore();
      const alreadyOnLogin = location.pathname === "/login";
      auth.logout();
      if (!alreadyOnLogin) {
        location.assign(`/login?redirect=${encodeURIComponent(location.pathname)}`);
      }
    }
    if (status === 403 && code === "MUST_CHANGE_PASSWORD") {
      const auth = useAuthStore();
      auth.markMustChangePassword();
      if (location.pathname !== "/change-password") {
        location.assign("/change-password");
      }
    }
    if (status === 400 && code === "INVALID_ACT_AS") {
      const auth = useAuthStore();
      if (auth.actAs) {
        auth.setActAs(null);
        location.reload();
      }
    }
    return Promise.reject(err);
  },
);
