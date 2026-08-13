import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../internal/webui/dist",
    emptyOutDir: true,
  },
  server: {
    port: 8080,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/v1": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000",
    },
  },
  test: {
    environment: "node",
  },
});
