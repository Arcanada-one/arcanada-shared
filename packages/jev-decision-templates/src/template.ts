import { z } from "zod";

export const slug = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const text = z.string().min(1);
const schemaId = z.enum([
  "task_dialogue",
  "kc_role",
  "kc_skill",
  "retrieval_prompt",
  "change_validation_retry",
  "model_orchestration",
  "action",
  "canon_research",
  "health_held",
]);
const base = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?$/),
    version: z.number().int().positive(),
    primitive: z.enum(["choice", "noul", "score"]),
    instructions: text,
    criteria: z.unknown(),
    params_schema: z.record(slug, z.enum(["candidate_id", "role_id"])),
    state_schema_ref: schemaId,
    allow_non_ascii: z
      .array(z.object({ string: text, reason: text }).strict())
      .max(32),
  })
  .strict();
export type Template = z.infer<typeof base>;

export function validateTemplate(value: unknown): Template | null {
  const parsed = base.safeParse(value);
  if (!parsed.success) return null;
  const template = parsed.data;
  let descriptions: string[];
  if (template.primitive === "score") {
    const result = z.array(text).min(2).max(10).safeParse(template.criteria);
    if (!result.success) return null;
    descriptions = result.data;
  } else {
    const result = z.record(z.string(), text).safeParse(template.criteria);
    if (!result.success) return null;
    const names = Object.keys(result.data);
    if (template.primitive === "noul") {
      if (
        names.length !== 2 ||
        !names.includes("true") ||
        !names.includes("false")
      )
        return null;
    } else if (
      names.length < 2 ||
      names.length > 255 ||
      !names.includes("other") ||
      names.some((name) => !slug.safeParse(name).success)
    )
      return null;
    descriptions = Object.values(result.data);
  }
  const literals = template.allow_non_ascii.map((entry) => entry.string);
  if (new Set(literals).size !== literals.length) return null;
  // Exceptions name a literal non-ASCII canonical identifier, never an entire
  // instruction/criterion or an ASCII wildcard. This does not prove authority.
  if (
    template.allow_non_ascii.some(
      (entry) =>
        !/[^\x00-\x7F]/.test(entry.string) ||
        !/^[\p{L}\p{N}_][\p{L}\p{N}_.:-]{0,127}$/u.test(entry.string) ||
        !ascii(entry.reason),
    )
  )
    return null;
  const fields = [template.instructions, ...descriptions];
  if (
    literals.some((literal) => !fields.some((field) => field.includes(literal)))
  )
    return null;
  if (
    fields.some(
      (field) =>
        !ascii(
          literals.reduce(
            (rest, literal) => rest.split(literal).join(""),
            field,
          ),
        ),
    )
  )
    return null;
  return template;
}

function ascii(value: string): boolean {
  return /^[\x20-\x7E\t\r\n]*$/.test(value);
}
