export const UNIVERSAL_TASK_PREFIXES = Object.freeze([
  "INFRA",
  "WEB",
  "DEV",
  "DEVOPS",
  "CONTENT",
  "RESEARCH",
  "AGENT",
  "BENCH",
  "MAINT",
  "FIN",
  "QA",
  "SEC",
  "QCK",
  "TUNE",
  "ROB",
  "DATA",
]);

export const ARCANADA_TASK_PREFIXES = Object.freeze([
  "ARCA",
  "CUBR",
  "VERD",
  "AUTH",
  "BILL",
  "CONV",
  "MUN",
  "TRANS",
  "SUP",
  "OVER",
  "CONS",
  "VOICE",
  "LTM",
  "SRCH",
  "CONN",
  "ARGA",
  "EMAIL",
  "ARAS",
  "STATUS",
  "ADSR",
  "LEGAL",
  "PUB",
  "SPACE",
  "SHARED",
  "CTRL",
  "WIKI",
  "DISK",
]);

export const INTERNAL_TASK_PREFIXES = Object.freeze([
  ...UNIVERSAL_TASK_PREFIXES,
  ...ARCANADA_TASK_PREFIXES,
]);

export const INTERNAL_TASK_ID_PATTERN = new RegExp(
  `\\b(?:${INTERNAL_TASK_PREFIXES.join("|")})-\\d{4}\\b`,
);

const GLOBAL_TOOLCHAIN_MUTATION_PATTERN =
  /(?=.*\b(?:npm|pnpm)\b)(?=.*\b(?:add|install|i|update|upgrade)\b)(?=.*(?:-g\b|--global(?:=true)?\b|--location(?:=|\s+)global\b)).+|\bcorepack\s+(?:install|prepare|use)\b.*(?:--global(?:\s|$)|--activate(?:\s|$))|\bcorepack\s+(?:enable|disable)\b/;

export const normalizeShellCommand = (command) =>
  String(command)
    .replace(/\\\r?\n[ \t]*/g, " ")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();

export const isGlobalToolchainMutation = (command) =>
  GLOBAL_TOOLCHAIN_MUTATION_PATTERN.test(normalizeShellCommand(command));

export const findInternalTaskId = (content) =>
  String(content).match(INTERNAL_TASK_ID_PATTERN)?.[0] ?? null;
