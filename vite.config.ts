import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const webRoot = fileURLToPath(new URL("./web", import.meta.url));
const distDir = fileURLToPath(new URL("./dist", import.meta.url));

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: false },
      "/preview": { target: "http://127.0.0.1:4000", changeOrigin: false },
    },
  },
  build: {
    outDir: distDir,
    emptyOutDir: true,
    sourcemap: false,
  },
});
