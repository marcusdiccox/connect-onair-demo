import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "server/patriot.js",
    outDir: "dist-api/server",
    emptyOutDir: true,
    minify: true,
    rolldownOptions: { output: { entryFileNames: "index.js" } },
  },
});
