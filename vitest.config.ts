import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  oxc: {
    tsconfig: path.resolve(__dirname, "tsconfig.json"),
  },
});
