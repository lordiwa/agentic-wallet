import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    // El emulador de Firestore es un proceso compartido: dos archivos de test
    // escribiendo el mismo tenant a la vez se pisan. Cada archivo usa un uid
    // propio, pero el arranque en serie hace que un fallo sea legible.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
