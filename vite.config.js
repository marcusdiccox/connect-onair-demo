import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { chunkSizeWarningLimit: 750 },
  server: { port: 5173, strictPort: true },
});
