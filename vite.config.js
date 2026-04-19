import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const basePath = (() => {
  const rawValue = process.env.TASK_TRACKER_BASE_PATH || "/";
  const normalizedValue = rawValue.startsWith("/") ? rawValue : `/${rawValue}`;
  return normalizedValue.endsWith("/") ? normalizedValue : `${normalizedValue}/`;
})();

export default defineConfig({
  base: basePath,
  plugins: [react()],
  root: "frontend",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/uploads": "http://127.0.0.1:8000",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "frontend/src"),
    },
  },
});
