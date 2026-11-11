import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  digestAllFirstQueue,
  loadFirstQueueTemplates,
  parseTemplateYaml,
  validate,
  validateTemplate,
} from "../src/index.js";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NEG = join(PKG_ROOT, "fixtures", "negative");

function loadNegativeTemplate(name: string) {
  return parseTemplateYaml(readFileSync(join(NEG, name), "utf8"));
}

describe("first-queue templates (AC-08 / AC-24 static)", () => {
  it("loads and validates every first-queue English template", () => {
    const templates = loadFirstQueueTemplates(PKG_ROOT);
    expect(Object.keys(templates).sort()).toEqual(
      [
        "health",
        "kc.role_relevance",
        "kc.skill_relevance",
        "retrieval.coverage",
        "retrieval.redundancy",
        "retrieval.relevance",
        "task.domain",
        "task.intent",
      ].sort(),
    );

    for (const template of Object.values(templates)) {
      const result = validateTemplate(template);
      expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    }

    const digests = digestAllFirstQueue(PKG_ROOT);
    for (const digest of Object.values(digests)) {
      expect(digest).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("accepts validate(template, state) on representative fixtures", () => {
    const templates = loadFirstQueueTemplates(PKG_ROOT);

    expect(
      validate(templates["task.intent"], {
        trusted: {
          task_text: "Implement the decision template package",
          context_labels: {
            project_prefix: "SHARED",
            caller_kind: "agent",
            has_attachments: false,
          },
        },
        untrusted: {},
      }).ok,
    ).toBe(true);

    expect(
      validate(templates["retrieval.relevance"], {
        trusted: {
          question: "Where do JEV templates live?",
          context_labels: {
            namespace_group: "arcanada",
            coverage_pass: 1,
            budget_class: "normal",
          },
        },
        untrusted: {
          candidates: [
            {
              k: "1",
              namespace: "plans",
              revision_id: "r1",
              content_hash: "abc",
              source_path: "JEV.md",
              text: "Templates live in @arcanada/jev-decision-templates",
            },
          ],
        },
      }).ok,
    ).toBe(true);

    expect(
      validate(templates.health, "ok: hooks loaded; deny-list active").ok,
    ).toBe(true);
  });
});

describe("negative controls", () => {
  it("rejects a choice template without other (AC-08)", () => {
    const result = validateTemplate(
      loadNegativeTemplate("choice-without-other.yaml"),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "choice_missing_other")).toBe(
      true,
    );
  });

  it("rejects a noul template without criteria (AC-08)", () => {
    const result = validateTemplate(
      loadNegativeTemplate("noul-without-criteria.yaml"),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "noul_missing_criteria")).toBe(
      true,
    );
  });

  it("rejects one Cyrillic letter in an option description (AC-24)", () => {
    const result = validateTemplate(
      loadNegativeTemplate("cyrillic-option-description.yaml"),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "non_ascii_text")).toBe(true);
  });

  it("rejects non-slug option id Relevant (AC-24)", () => {
    const result = validateTemplate(
      loadNegativeTemplate("non-slug-option-name.yaml"),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "option_id_not_slug")).toBe(
      true,
    );
  });

  it("rejects deny-listed state field names via validate(template, state)", () => {
    const templates = loadFirstQueueTemplates(PKG_ROOT);
    const state = JSON.parse(
      readFileSync(join(NEG, "state-deny-listed.json"), "utf8"),
    );
    const result = validate(templates["retrieval.relevance"], state);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "state_field_denied")).toBe(
      true,
    );
  });
});
