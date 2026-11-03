import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "../queen/internal/ui/dist",
    emptyOutDir: true,
    assetsDir: "assets",
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://127.0.0.1:8080",
      "/healthz": "http://127.0.0.1:8080",
      "/install": "http://127.0.0.1:8080",
      "/releases": "http://127.0.0.1:8080",
      "/agent": "http://127.0.0.1:8080",
    },
  },
});
