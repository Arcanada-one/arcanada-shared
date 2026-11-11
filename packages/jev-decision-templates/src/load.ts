import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { digestTemplate } from "./digest.js";
import type { DecisionTemplate } from "./types.js";
import { validateTemplate } from "./validate-template.js";

export const FIRST_QUEUE_TEMPLATE_IDS = [
  "retrieval.relevance",
  "retrieval.redundancy",
  "retrieval.coverage",
  "task.domain",
  "task.intent",
  "kc.role_relevance",
  "kc.skill_relevance",
  "health",
] as const;

export type FirstQueueTemplateId = (typeof FIRST_QUEUE_TEMPLATE_IDS)[number];

declare const __dirname: string | undefined;

function moduleDirectory(): string {
  if (typeof __dirname === "string" && __dirname.length > 0) {
    return __dirname;
  }
  return dirname(fileURLToPath(import.meta.url));
}

function packageRoot(): string {
  const here = moduleDirectory();
  const root = join(here, "..");
  if (!existsSync(join(root, "package.json"))) {
    throw new Error(
      `unable to resolve @arcanada/jev-decision-templates root from ${here}`,
    );
  }
  return root;
}

export function templatesDirectory(root = packageRoot()): string {
  return join(root, "templates");
}

export function parseTemplateYaml(raw: string): DecisionTemplate {
  const parsed = parseYaml(raw) as DecisionTemplate;
  return parsed;
}

export function loadTemplateFile(path: string): DecisionTemplate {
  const raw = readFileSync(path, "utf8");
  return parseTemplateYaml(raw);
}

export function loadFirstQueueTemplates(
  root = packageRoot(),
): Record<FirstQueueTemplateId, DecisionTemplate> {
  const dir = templatesDirectory(root);
  const out = {} as Record<FirstQueueTemplateId, DecisionTemplate>;
  for (const id of FIRST_QUEUE_TEMPLATE_IDS) {
    const path = join(dir, `${id}.yaml`);
    const template = loadTemplateFile(path);
    if (template.id !== id) {
      throw new Error(`template id mismatch at ${path}: ${template.id}`);
    }
    const result = validateTemplate(template);
    if (!result.ok) {
      throw new Error(
        `first-queue template ${id} failed validation: ${JSON.stringify(result.issues)}`,
      );
    }
    out[id] = template;
  }
  return out;
}

export function listTemplateFiles(root = packageRoot()): string[] {
  const dir = templatesDirectory(root);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => join(dir, name))
    .sort();
}

export function digestAllFirstQueue(
  root = packageRoot(),
): Record<FirstQueueTemplateId, string> {
  const templates = loadFirstQueueTemplates(root);
  const out = {} as Record<FirstQueueTemplateId, string>;
  for (const id of FIRST_QUEUE_TEMPLATE_IDS) {
    out[id] = digestTemplate(templates[id]);
  }
  return out;
}
