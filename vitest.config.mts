import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Las pruebas unitarias nunca tocan la red: el cliente HTTP se inyecta con fetch simulado.
    testTimeout: 10_000,
  },
});
