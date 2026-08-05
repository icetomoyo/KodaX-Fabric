import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3100",
        changeOrigin: true,
        xfwd: true,
      },
      "/health": {
        target: "http://127.0.0.1:3100",
        changeOrigin: true,
        xfwd: true,
      },
      "/v1": {
        target: "http://127.0.0.1:3100",
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
});
