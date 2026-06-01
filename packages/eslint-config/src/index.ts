import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

/**
 * A single flat-config object (ESLint 9 `eslint.config.js` array element).
 * Kept loose on purpose — ESLint's own `Linter.Config` type pulls in the full
 * ESLint dependency, which we declare only as a peer.
 */
export type FlatConfig = Record<string, unknown>;

/**
 * Base profile: TypeScript parsing + the shared rule set used across every
 * Arcanada repo. Returns an array so it can be spread into a consumer's
 * `eslint.config.js` default export.
 */
export function base(): FlatConfig[] {
  return [
    {
      files: ["**/*.ts", "**/*.tsx"],
      languageOptions: {
        parser: tsparser,
        parserOptions: {
          ecmaVersion: 2022,
          sourceType: "module",
        },
      },
      plugins: {
        "@typescript-eslint": tseslint,
      },
      rules: {
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "no-console": ["warn", { allow: ["warn", "error"] }],
        eqeqeq: ["error", "always"],
      },
    },
  ];
}

/**
 * NestJS profile: base rules, but decorator-heavy code legitimately leaves
 * constructor-injected parameters "unused" at the syntactic level, so the
 * parameter check is relaxed to the leading-underscore convention only and
 * `no-console` is dropped (pino is the logger; console use is caught in review).
 */
export function nestjs(): FlatConfig[] {
  return [
    ...base(),
    {
      files: ["**/*.ts"],
      rules: {
        "@typescript-eslint/no-unused-vars": [
          "error",
          { args: "none", varsIgnorePattern: "^_" },
        ],
      },
    },
  ];
}

/**
 * React profile: base rules plus JSX/TSX file coverage. React-specific plugins
 * (react-hooks, jsx-a11y) are intentionally left to the consuming app so it can
 * pin its own versions; this profile only carries the shared TS baseline.
 */
export function react(): FlatConfig[] {
  return [
    ...base(),
    {
      files: ["**/*.tsx"],
      languageOptions: {
        parserOptions: {
          ecmaFeatures: { jsx: true },
        },
      },
    },
  ];
}

export default { base, nestjs, react };
