import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

import { preserveLegacyStaticScript } from "./scripts/vite-preserve-static.ts";
import { copyGeneratedData } from "./scripts/vite-copy-data.ts";

export default defineConfig({
  base: "./",
  plugins: [vue(), preserveLegacyStaticScript(), copyGeneratedData()],
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        detail: fileURLToPath(new URL("./detail.html", import.meta.url)),
      },
    },
  },
});
