import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const webDir = __dirname;
  const repoRoot = resolve(webDir, "..");
  const apiTarget =
    process.env.DEV_API_TARGET
    || loadEnv(mode, webDir, "").DEV_API_TARGET
    || loadEnv(mode, repoRoot, "").DEV_API_TARGET
    || "http://127.0.0.1:3100";
  const proxy = {
    target: apiTarget,
    changeOrigin: true,
    xfwd: true,
  };

  console.log(`[vite] dev API proxy → ${apiTarget}`);

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        "@": resolve(webDir, "src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/api": proxy,
        "/health": proxy,
        "/ai": proxy,
      },
    },
  };
});

