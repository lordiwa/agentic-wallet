import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/src/**/*.test.ts", "server/scripts/**/*.test.ts", "web/src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
