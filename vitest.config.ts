import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Sólo para que los tests del panel puedan montar un `.vue`. No afecta a
  // server/ ni a web/, que no importan componentes de Vue.
  plugins: [vue()],
  test: {
    include: [
      "server/src/**/*.test.ts",
      "server/scripts/**/*.test.ts",
      "web/src/**/*.test.{ts,tsx}",
      "panel/src/**/*.test.ts",
    ],
    // `environment: "node"` sigue siendo el default; los tests que necesitan
    // DOM lo piden por archivo con `/** @vitest-environment jsdom */`, igual
    // que los de web/.
    environment: "node",
  },
});
