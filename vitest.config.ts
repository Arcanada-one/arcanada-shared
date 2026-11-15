import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "packages/access-contracts/test/observation-inspector.test.js",
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
    },
  },
});
