/// <reference types="vitest/config" />
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: { outDir: "../internal/webui/dist", emptyOutDir: true },
  server: {
    proxy: {
      "/admin/api": "http://127.0.0.1:18080",
      "/health": "http://127.0.0.1:18080",
      "/v1": "http://127.0.0.1:18080",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
