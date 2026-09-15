import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// F1: the dev server proxies /api to the backend so the browser never needs CORS,
// credentials, or a frontend .env file.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: false,
    setupFiles: ["./test/setup.js"],
  },
});
