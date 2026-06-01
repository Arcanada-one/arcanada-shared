// @ts-check
// Root flat config for the monorepo itself. Consumers do NOT use this file —
// they extend the published @arcanada/eslint-config package (nestjs()/react()).
import { base } from "@arcanada/eslint-config";

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.tsbuildinfo", "coverage/**"],
  },
  ...base(),
];
