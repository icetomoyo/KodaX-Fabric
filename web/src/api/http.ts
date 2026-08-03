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
  return config;
});

http.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const code = err.response?.data?.code;
    if (status === 401) {
      const auth = useAuthStore();
      auth.logout();
      if (location.pathname !== "/login") {
        location.href = `/login?redirect=${encodeURIComponent(location.pathname)}`;
      }
    }
    if (status === 403 && code === "MUST_CHANGE_PASSWORD") {
      if (location.pathname !== "/change-password") {
        location.href = "/change-password";
      }
    }
    return Promise.reject(err);
  },
);
