/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Read-only structural inspector for Knowledge Contract `book-package/2`.
 *
 * Port of `check_package` from the pinned checker (Arcanada-one/knowledge-contract
 * e351df0c28f0b9965a580f45b48a297d1872c3ce, tools/check_book_package.py, blob 0221e4ad…). Refusal MESSAGES are the checker's own
 * strings wherever a check is ported 1:1, so a differential run can compare the two lists exactly; schema errors are compared by
 * location only because ajv and python-jsonschema word them differently. This module takes bytes in and returns data out: it does
 * not read the network or the file system, does not write, and never claims admission (`kc2_admission` is always `not_measured`).
 */
import { createHash } from "node:crypto";
import { PINS, recordErrors, SCHEMA_TAGS } from "./schema.js";
import { parseStrictJson, StrictJsonError } from "./strict-json.js";

type Rec = Record<string, any>;

export type RefusalCode =
  | "manifest_missing"
  | "manifest_unreadable"
  | "schema_violation"
  | "component_missing"
  | "component_digest_mismatch"
  | "asset_missing_or_digest_mismatch"
  | "input_digest_mismatch"
  | "component_path_collision"
  | "rights_conflict"
  | "integrity_observation_conflict"
  | "jsonl_unreadable"
  | "quality_unreadable"
  | "record_count_mismatch"
  | "duplicate_identity"
  | "relation_endpoint_unknown"
  | "relation_self_loop"
  | "package_identity_mismatch"
  | "anchor_mismatch"
  | "edit_conflict"
  | "unsupported_layers"
  | "ledger_mismatch"
  | "stale_not_propagated"
  | "quality_incoherent"
  | "review_binding_mismatch"
  | "status_incoherent";

export interface Refusal {
  code: RefusalCode;
  /** Where the problem was found: a file name, a record locator or a JSON pointer-like path. */
  where: string;
  /** The pinned checker's message for ported checks (schema errors: the ajv wording). */
  message: string;
}

export type PackageFiles =
  | ReadonlyMap<string, Uint8Array>
  | Readonly<Record<string, Uint8Array>>;

export interface ComponentObservation {
  name: string;
  path: string | null;
  declared_sha256: string | null;
  observed_sha256: string | null;
  observed_bytes: number | null;
  declared_count: number | null;
  /** `declared_missing`: the manifest itself declares the asset absent (state missing_asset); nothing to hash. */
  state: "verified" | "missing" | "digest_mismatch" | "declared_missing";
}

export interface AnchorRow {
  owner: "object" | "relation" | "edit";
  owner_id: string;
  anchor: Rec;
}

export interface BookPackageProjection {
  package_identity: {
    package_id: string;
    release_id: string;
    validation_profile: string;
    declared_package_status: string;
    derived_package_status: string;
    manifest_sha256: string;
    manifest_bytes: number;
  };
  work: Rec;
  edition: Rec;
  representation: Rec;
  rights: Rec;
  manifest: Rec;
  objects: Rec[];
  relations: Rec[];
  edits: Rec[];
  quality: Rec;
  anchors: AnchorRow[];
  provenance: {
    tooling: Rec[];
    document_md_tool: Rec | null;
    objects: {
      object_id: string;
      origin: string;
      presented_as_author: boolean;
      generated: boolean;
      status: string;
    }[];
    relations: {
      relation_id: string;
      origin: string;
      presented_as_author: boolean;
      generated: boolean;
      status: string;
    }[];
    review: {
      present: boolean;
      review_id: string | null;
      reviewer_type: string | null;
      reviewer_id: string | null;
      producer_id: string | null;
      declared_independent: boolean;
      result: string | null;
      semantics_status: string;
      binds_current_bytes: boolean;
    };
  };
  relation_endpoints: {
    relation_id: string;
    from: string;
    to: string;
    from_known: boolean;
    to_known: boolean;
  }[];
  damage: Rec | null;
  unlisted_files: string[];
}

export interface InspectionResult {
  schema: "ArcanadaBookPackageInspection/v1";
  profile: "book-package/2";
  verdict: "pass" | "refused";
  kc2_admission: "not_measured";
  pins: typeof PINS;
  refusals: Refusal[];
  components: ComponentObservation[];
  projection: BookPackageProjection | null;
  /** Statements that bound what a `pass` means. */
  limits: readonly string[];
}

const LIMITS = [
  "structure and cross-file coherence only; no extraction truth, no semantic correctness, no source admission",
  "kc2_admission is not_measured; knowledge_ready is a package-status derivation, not an admission decision",
  "no Muneral run, stream epoch or native event identity is provided or implied by a package",
] as const;

const RESTRICTED_LAYERS = new Set([
  "document_md",
  "readable_md",
  "assets",
  "knowledge",
  "quality",
]);
const ADMISSIBLE_OFFSET_KINDS = new Set(["spine_offset"]);
const FORMAT_ANCHORS: Record<string, Set<string>> = {
  pdf: new Set(["page_bbox"]),
  djvu: new Set(["page_bbox"]),
  ps: new Set(["page_bbox"]),
  epub: new Set(["spine_offset"]),
  html: new Set(["section_block"]),
  md: new Set(["section_block"]),
  txt: new Set(["section_block"]),
  tex: new Set(["section_block"]),
  xlsx: new Set(["sheet_range"]),
  json: new Set(["json_pointer"]),
  ppt: new Set(["slide_block"]),
  pptx: new Set(["slide_block"]),
  zip: new Set(),
  tar_gz: new Set(),
  sevenz: new Set(),
};

/** Raised where the checker raises PackageError: the whole verdict collapses to this single message. */
class PackageError extends Error {
  constructor(
    readonly code: RefusalCode,
    readonly where: string,
    message: string,
  ) {
    super(message);
  }
}

const sha256 = (b: Uint8Array): string =>
  createHash("sha256").update(b).digest("hex");

// Python str.strip() whitespace (not JS trim(): U+FEFF is not stripped there, U+001C..U+001F are).
const PY_WS =
  "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const pyStrip = (s: string): string =>
  s.replace(new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "gu"), "");

function normalise(files: PackageFiles): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const entries =
    files instanceof Map ? [...files.entries()] : Object.entries(files);
  for (const [k, v] of entries) out.set(k, v);
  return out;
}

/** Same rule as safe_file: a relative path without `..`; with bytes only there is no symlink to meet. */
function lookup(
  files: Map<string, Uint8Array>,
  rel: string,
): Uint8Array | null {
  if (rel.startsWith("/")) return null;
  const parts = rel.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.includes("..")) return null;
  return files.get(parts.join("/")) ?? null;
}

function decodeStrict(bytes: Uint8Array, name: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new PackageError(
      "jsonl_unreadable",
      name,
      `${name}: not valid UTF-8`,
    );
  }
}

function splitLines(text: string, name: string): string[] {
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  parts.forEach((line, idx) => {
    if (line.endsWith("\r")) {
      throw new PackageError(
        "jsonl_unreadable",
        name,
        `${name}:${idx + 1}: line ends with a carriage return`,
      );
    }
  });
  return parts;
}

function strictJson(text: string, name: string): unknown {
  try {
    return parseStrictJson(text);
  } catch (e) {
    if (e instanceof StrictJsonError) {
      if (e.kind === "syntax") throw new SyntaxError(e.message);
      throw new PackageError("jsonl_unreadable", name, `${name}: ${e.message}`);
    }
    throw e;
  }
}

function readJsonl(files: Map<string, Uint8Array>, rel: string): Rec[] {
  const name = rel.split("/").pop() as string;
  const bytes = lookup(files, rel) as Uint8Array;
  const records: Rec[] = [];
  splitLines(decodeStrict(bytes, name), name).forEach((line, idx) => {
    const n = idx + 1;
    if (new RegExp(`^[${PY_WS}]*$`, "u").test(line)) {
      throw new PackageError(
        "jsonl_unreadable",
        `${name}:${n}`,
        `${name}:${n}: blank line`,
      );
    }
    try {
      records.push(strictJson(line, `${name}:${n}`) as Rec);
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new PackageError(
          "jsonl_unreadable",
          `${name}:${n}`,
          `${name}:${n}: invalid JSON (${e.message})`,
        );
      }
      throw e;
    }
  });
  return records;
}

function anchorsOf(obj: Rec): Rec[] {
  if (obj.schema === "KCBookRelation/v2")
    return (obj.evidence ?? []).map((item: Rec) => item.anchor);
  if (obj.schema === "KCBookEdit/v2") return [obj.anchor];
  return [...(obj.evidence ?? [])];
}

function anchorsOverlap(a: Rec, b: Rec): boolean {
  if (
    a.representation_id !== b.representation_id ||
    a.source_sha256 !== b.source_sha256
  )
    return false;
  if (a.kind !== b.kind) return true;
  switch (a.kind) {
    case "section_block":
      return a.section_id === b.section_id && a.block_id === b.block_id;
    case "slide_block":
      return a.slide === b.slide && a.block_id === b.block_id;
    case "spine_offset":
      return (
        a.spine_item === b.spine_item &&
        Math.max(a.start, b.start) <= Math.min(a.end, b.end)
      );
    case "page_bbox": {
      if (a.page !== b.page) return false;
      if (a.bbox_origin !== b.bbox_origin || a.bbox_unit !== b.bbox_unit)
        return true;
      const [x0, y0, x1, y1] = a.bbox;
      const [u0, v0, u1, v1] = b.bbox;
      return (
        Math.max(x0, u0) < Math.min(x1, u1) &&
        Math.max(y0, v0) < Math.min(y1, v1)
      );
    }
    case "sheet_range":
      return a.sheet === b.sheet;
    case "json_pointer":
      return (
        a.pointer === b.pointer ||
        (a.pointer as string).startsWith(b.pointer + "/") ||
        (b.pointer as string).startsWith(a.pointer + "/")
      );
    default:
      return true;
  }
}

function countOverlapping(text: string, part: string): number {
  let count = 0;
  let start = text.indexOf(part);
  while (start !== -1) {
    count += 1;
    start = text.indexOf(part, start + 1);
  }
  return count;
}

const replaceFirst = (text: string, before: string, after: string): string => {
  const at = text.indexOf(before);
  return at === -1
    ? text
    : text.slice(0, at) + after + text.slice(at + before.length);
};

const sameSet = (a: Iterable<string>, b: Iterable<string>): boolean => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};

function reviewIsIndependent(review: Rec): boolean {
  return (
    (review.reviewer_type === "human" ||
      review.reviewer_type === "blind_agent") &&
    review.reviewer_id !== review.producer_id &&
    pyStrip(review.independence_basis ?? "") !== ""
  );
}

function completeSupportedReview(
  quality: Rec,
  objects: Rec[],
  relations: Rec[],
): boolean {
  const sem = quality.semantics;
  const review: Rec = sem.review ?? {};
  return (
    sem.status === "reviewed" &&
    objects.length > 0 &&
    review.result === "supported" &&
    reviewIsIndependent(review) &&
    sameSet(
      review.object_ids ?? [],
      objects.map((o) => o.object_id),
    ) &&
    sameSet(
      review.relation_ids ?? [],
      relations.map((r) => r.relation_id),
    ) &&
    review.sample_size === objects.length &&
    objects.every((o) => o.status === "reviewed") &&
    relations.every((r) => r.status === "reviewed")
  );
}

export function derivePackageStatus(
  manifest: Rec,
  quality: Rec,
  objects: Rec[],
  relations: Rec[],
): string {
  const rep = manifest.representation;
  const sem = quality.semantics;
  const ext = quality.extraction;
  if (rep.integrity === "mismatch") return "blocked_integrity";
  if (rep.completeness === "bibliography_only") return "bibliography_only";
  if (!("document_md" in manifest.components)) return "adapter_required";
  if (
    (sem.status === "not_built" || sem.status === "not_measured") &&
    objects.length === 0 &&
    relations.length === 0
  ) {
    return "structure_only";
  }
  const checks: Rec[] = ext.checks;
  if (
    rep.integrity === "verified" &&
    rep.completeness === "full" &&
    ext.status === "pass" &&
    (quality.damage ?? { status: "none" }).status === "none" &&
    checks.length > 0 &&
    checks.every((c) => c.result === "pass" || c.result === "not_applicable") &&
    checks.some((c) => c.result === "pass") &&
    completeSupportedReview(quality, objects, relations)
  ) {
    return "knowledge_ready";
  }
  return "partial_pilot";
}

const schemaProblems = (record: unknown, where: string): Refusal[] =>
  recordErrors(record).map((m) => ({
    code: "schema_violation" as const,
    where,
    message: `${where}: ${m}`,
  }));

function componentTable(
  manifest: Rec | null,
  files: Map<string, Uint8Array>,
): ComponentObservation[] {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    typeof manifest.components !== "object" ||
    manifest.components === null
  ) {
    return [];
  }
  const rows: ComponentObservation[] = [];
  const observe = (name: string, meta: Rec | undefined): void => {
    if (!meta || typeof meta !== "object" || typeof meta.path !== "string")
      return;
    const bytes = lookup(files, meta.path);
    const observed = bytes ? sha256(bytes) : null;
    rows.push({
      name,
      path: meta.path,
      declared_sha256: typeof meta.sha256 === "string" ? meta.sha256 : null,
      observed_sha256: observed,
      observed_bytes: bytes ? bytes.length : null,
      declared_count: typeof meta.count === "number" ? meta.count : null,
      state: !bytes
        ? "missing"
        : observed === meta.sha256
          ? "verified"
          : "digest_mismatch",
    });
  };
  for (const name of [
    "document_md",
    "readable_md",
    "edits",
    "objects",
    "relations",
    "quality",
  ]) {
    observe(name, manifest.components[name]);
  }
  if (Array.isArray(manifest.components.assets)) {
    for (const asset of manifest.components.assets) {
      if (asset && asset.state === "present")
        observe(`asset:${String(asset.asset_id)}`, asset);
      else if (asset) {
        rows.push({
          name: `asset:${String(asset.asset_id)}`,
          path: null,
          declared_sha256: null,
          observed_sha256: null,
          observed_bytes: null,
          declared_count: null,
          state: "declared_missing",
        });
      }
    }
  }
  return rows;
}

interface Checked {
  problems: Refusal[];
  manifest?: Rec;
  objects?: Rec[];
  relations?: Rec[];
  edits?: Rec[];
  quality?: Rec;
  derived?: string;
}

function checkPackage(files: Map<string, Uint8Array>): Checked {
  const problems: Refusal[] = [];
  const add = (code: RefusalCode, where: string, message: string): void => {
    problems.push({ code, where, message });
  };

  const manifestBytes = lookup(files, "manifest.json");
  if (manifestBytes === null) {
    return {
      problems: [
        {
          code: "manifest_missing",
          where: "manifest.json",
          message: "manifest.json: missing, not a regular file, or a symlink",
        },
      ],
    };
  }
  let manifest: Rec;
  try {
    manifest = strictJson(
      decodeStrict(manifestBytes, "manifest.json"),
      "manifest.json",
    ) as Rec;
  } catch (e) {
    const detail =
      e instanceof PackageError
        ? `PackageError: ${e.message}`
        : e instanceof SyntaxError
          ? "JSONDecodeError"
          : "Error";
    return {
      problems: [
        {
          code: "manifest_unreadable",
          where: "manifest.json",
          message: `manifest.json: unreadable (${detail})`,
        },
      ],
    };
  }
  const manifestErrors = schemaProblems(manifest, "manifest.json");
  if (manifestErrors.length > 0) return { problems: manifestErrors };

  const comps: Rec = manifest.components;
  const rep: Rec = manifest.representation;

  for (const name of [
    "document_md",
    "readable_md",
    "edits",
    "objects",
    "relations",
    "quality",
  ]) {
    const meta: Rec | undefined = comps[name];
    if (!meta) continue;
    const bytes = lookup(files, meta.path);
    if (bytes === null) {
      add(
        "component_missing",
        name,
        `${name}: file ${meta.path} is missing, not a regular file, or a symlink`,
      );
    } else if (sha256(bytes) !== meta.sha256) {
      add(
        "component_digest_mismatch",
        name,
        `${name}: sha256 of ${meta.path} differs from the manifest`,
      );
    }
  }
  for (const asset of comps.assets ?? []) {
    if (asset.state === "present") {
      const bytes = lookup(files, asset.path);
      if (bytes === null || sha256(bytes) !== asset.sha256) {
        add(
          "asset_missing_or_digest_mismatch",
          `asset ${asset.asset_id}`,
          `asset ${asset.asset_id}: missing or digest differs`,
        );
      }
    }
  }
  if (problems.length > 0) return { problems, manifest };

  try {
    if (
      "document_md" in comps &&
      comps.document_md.input_sha256 !== rep.source_sha256
    ) {
      add(
        "input_digest_mismatch",
        "document_md",
        "document_md.input_sha256 must equal the source representation sha256",
      );
    }
    if (
      "document_md" in comps &&
      comps.document_md.path === comps.readable_md.path
    ) {
      add(
        "component_path_collision",
        "document_md",
        "document_md and readable_md must be different files",
      );
    }

    const rights: Rec = manifest.rights;
    const openClass =
      rights.license_class === "author_open" ||
      rights.license_class === "public_domain";
    if (
      !openClass &&
      (rights.publishable_layers as string[]).some((l) =>
        RESTRICTED_LAYERS.has(l),
      )
    ) {
      add(
        "rights_conflict",
        "rights",
        "a work that is neither author_open nor public_domain may not publish any package layer",
      );
    }
    if (!openClass && "license" in rights) {
      add(
        "rights_conflict",
        "rights",
        "a work that is neither author_open nor public_domain may not declare a publication license",
      );
    }
    if (
      rights.license_class === "public_domain" &&
      (rights.publishable_layers as string[]).some(
        (l) => l === "knowledge" || l === "quality",
      ) &&
      !("own_layers_license" in rights.public_domain)
    ) {
      add(
        "rights_conflict",
        "rights",
        "a public_domain package publishes the knowledge or quality layer only under public_domain.own_layers_license",
      );
    }
    const integrityCheck: Rec | undefined = rep.integrity_check;
    if (integrityCheck) {
      if (integrityCheck.observed_sha256 !== rep.source_sha256) {
        add(
          "integrity_observation_conflict",
          "representation",
          "integrity_check.observed_sha256 differs from the source representation digest",
        );
      }
      const equal =
        integrityCheck.expected_sha256 === integrityCheck.observed_sha256;
      if (rep.integrity === "verified" && !equal) {
        add(
          "integrity_observation_conflict",
          "representation",
          "verified integrity requires equal expected and observed source digests",
        );
      }
      if (rep.integrity === "mismatch" && equal) {
        add(
          "integrity_observation_conflict",
          "representation",
          "mismatch integrity requires different expected and observed source digests",
        );
      }
    }

    const objects = readJsonl(files, comps.objects.path);
    const relations = readJsonl(files, comps.relations.path);
    const edits = readJsonl(files, comps.edits.path);
    let quality: Rec;
    try {
      quality = strictJson(
        decodeStrict(
          lookup(files, comps.quality.path) as Uint8Array,
          "quality.json",
        ),
        "quality.json",
      ) as Rec;
    } catch (e) {
      if (e instanceof SyntaxError) {
        return {
          problems: [
            {
              code: "quality_unreadable",
              where: "quality",
              message: `quality: invalid JSON (${e.message})`,
            },
          ],
        };
      }
      throw e;
    }

    for (const [label, records, expected] of [
      ["objects", objects, comps.objects.count],
      ["relations", relations, comps.relations.count],
      ["edits", edits, comps.edits.count],
    ] as [string, Rec[], number][]) {
      if (records.length !== expected) {
        add(
          "record_count_mismatch",
          label,
          `${label}: manifest count ${expected} differs from ${records.length} records`,
        );
      }
      records.forEach((record, idx) => {
        for (const m of recordErrors(record)) {
          add(
            "schema_violation",
            `${label}:${idx + 1}`,
            `${label}:${idx + 1}: ${m}`,
          );
        }
      });
    }
    for (const m of recordErrors(quality))
      add("schema_violation", "quality", `quality: ${m}`);
    if (problems.length > 0) return { problems, manifest };

    const ids = objects.map((o) => o.object_id);
    if (new Set(ids).size !== ids.length)
      add("duplicate_identity", "objects", "objects: duplicate object_id");
    const relIds = relations.map((r) => r.relation_id);
    if (new Set(relIds).size !== relIds.length)
      add(
        "duplicate_identity",
        "relations",
        "relations: duplicate relation_id",
      );
    if (new Set(edits.map((e) => e.edit_id)).size !== edits.length)
      add("duplicate_identity", "edits", "edits: duplicate edit_id");
    const assetIds = (comps.assets ?? []).map((a: Rec) => a.asset_id);
    if (new Set(assetIds).size !== assetIds.length)
      add("duplicate_identity", "assets", "assets: duplicate asset_id");
    const known = new Set<string>(ids);
    for (const rel of relations) {
      for (const end of ["from", "to"]) {
        if (!known.has(rel[end])) {
          add(
            "relation_endpoint_unknown",
            `relation ${rel.relation_id}`,
            `relation ${rel.relation_id}: ${end} endpoint ${rel[end]} is not an object of this package`,
          );
        }
      }
      if (rel.from === rel.to) {
        add(
          "relation_self_loop",
          `relation ${rel.relation_id}`,
          `relation ${rel.relation_id}: a relation may not connect an object to itself`,
        );
      }
    }

    for (const record of [...objects, ...relations, ...edits]) {
      if (record.package_id !== manifest.package_id) {
        add(
          "package_identity_mismatch",
          record.schema,
          `${record.schema}: package_id differs from the manifest`,
        );
      }
      if (
        record.schema === "KCBookObject/v2" &&
        (record.work_id !== manifest.work.work_id ||
          record.edition_id !== manifest.edition.edition_id)
      ) {
        add(
          "package_identity_mismatch",
          `object ${record.object_id}`,
          `object ${record.object_id}: work_id/edition_id differ from the manifest`,
        );
      }
      for (const anchor of anchorsOf(record)) {
        if (
          anchor.representation_id !== rep.representation_id ||
          anchor.source_sha256 !== rep.source_sha256
        ) {
          add(
            "anchor_mismatch",
            record.schema,
            `${record.schema}: an evidence anchor names another representation or source hash`,
          );
        }
        if (!FORMAT_ANCHORS[rep.format]!.has(anchor.kind)) {
          add(
            "anchor_mismatch",
            record.schema,
            `${record.schema}: anchor kind ${anchor.kind} does not fit source format ${rep.format}`,
          );
        }
        if (
          ADMISSIBLE_OFFSET_KINDS.has(anchor.kind) &&
          anchor.end < anchor.start
        ) {
          add(
            "anchor_mismatch",
            record.schema,
            `${record.schema}: anchor end precedes start`,
          );
        }
        if (anchor.kind === "page_bbox") {
          const [x0, y0, x1, y1] = anchor.bbox;
          if (x1 <= x0 || y1 <= y0)
            add(
              "anchor_mismatch",
              record.schema,
              `${record.schema}: bbox has no area`,
            );
        }
      }
    }
    for (const edit of edits) {
      if (
        edit.status === "accepted" &&
        edit.original_text === edit.replacement_text
      ) {
        add(
          "edit_conflict",
          `edit ${edit.edit_id}`,
          `edit ${edit.edit_id}: accepted edit changes nothing`,
        );
      }
      for (const dep of edit.depends_on_objects) {
        if (!known.has(dep))
          add(
            "edit_conflict",
            `edit ${edit.edit_id}`,
            `edit ${edit.edit_id}: depends on unknown object ${dep}`,
          );
      }
    }

    if (!("document_md" in comps)) {
      if (edits.some((e) => e.status === "accepted")) {
        add(
          "unsupported_layers",
          "edits",
          "accepted edits require document_md and readable_md",
        );
      }
      if (objects.length > 0 || relations.length > 0) {
        add(
          "unsupported_layers",
          "objects",
          "a package without converter output cannot contain a built semantic layer",
        );
      }
    }
    if (
      FORMAT_ANCHORS[rep.format]!.size === 0 &&
      ("document_md" in comps ||
        objects.length > 0 ||
        relations.length > 0 ||
        edits.length > 0)
    ) {
      add(
        "unsupported_layers",
        "representation",
        "archive formats have no member-path anchor profile; converter and semantic layers are unsupported",
      );
    }

    // Ledger: the readable edition is exactly the replay of the accepted edits over document.md, and digests chain.
    if ("document_md" in comps) {
      const original = decodeStrict(
        lookup(files, comps.document_md.path) as Uint8Array,
        comps.document_md.path,
      );
      let current = original;
      const applied: Rec[] = [];
      let chain: string = comps.document_md.sha256;
      for (const edit of edits.filter(
        (e) => e.status === "accepted" && e.target === "readable_md",
      )) {
        if (edit.input_sha256 !== chain) {
          add(
            "ledger_mismatch",
            `edit ${edit.edit_id}`,
            `edit ${edit.edit_id}: input_sha256 is not the digest of the text it was applied to`,
          );
        }
        const before: string = edit.original_text;
        const after: string = edit.replacement_text;
        if (!before || !after) {
          add(
            "ledger_mismatch",
            `edit ${edit.edit_id}`,
            `edit ${edit.edit_id}: original_text and replacement_text must not be empty (an insertion or deletion has no search-reversible form)`,
          );
          continue;
        }
        if (!current.includes(before)) {
          add(
            "ledger_mismatch",
            `edit ${edit.edit_id}`,
            `edit ${edit.edit_id}: original_text does not occur in the text it edits`,
          );
          continue;
        }
        if (countOverlapping(current, before) !== 1) {
          add(
            "ledger_mismatch",
            `edit ${edit.edit_id}`,
            `edit ${edit.edit_id}: original_text occurs ${countOverlapping(current, before)} times (overlapping counted) in the text it edits; it must be unique so the edit is positional`,
          );
          continue;
        }
        current = replaceFirst(current, before, after);
        if (countOverlapping(current, after) !== 1) {
          add(
            "ledger_mismatch",
            `edit ${edit.edit_id}`,
            `edit ${edit.edit_id}: replacement_text must occur exactly once in the text it produced, or the edit cannot be reversed`,
          );
          continue;
        }
        applied.push(edit);
        chain = sha256(new TextEncoder().encode(current));
        if (edit.output_sha256 !== chain) {
          add(
            "ledger_mismatch",
            `edit ${edit.edit_id}`,
            `edit ${edit.edit_id}: output_sha256 is not the digest of the text it produced`,
          );
        }
      }
      let undone = current;
      for (const edit of [...applied].reverse())
        undone = replaceFirst(
          undone,
          edit.replacement_text,
          edit.original_text,
        );
      if (undone !== original)
        add(
          "ledger_mismatch",
          "edits",
          "the accepted edits do not reverse to document_md exactly",
        );
      const readable = decodeStrict(
        lookup(files, comps.readable_md.path) as Uint8Array,
        comps.readable_md.path,
      );
      if (readable !== current)
        add(
          "ledger_mismatch",
          "readable_md",
          "readable_md is not the replay of the accepted edits over document_md",
        );
    }

    // Staleness
    const review: Rec = quality.semantics.review ?? {};
    const editsById = new Map<string, Rec>(edits.map((e) => [e.edit_id, e]));
    const staleEditObjs = new Set<string>();
    for (const obj of objects) {
      const reviewedEdits = new Set<string>(obj.reviewed_edit_ids ?? []);
      if (
        [...reviewedEdits].some(
          (eid) =>
            !editsById.has(eid) || editsById.get(eid)!.status !== "accepted",
        )
      ) {
        add(
          "stale_not_propagated",
          `object ${obj.object_id}`,
          `object ${obj.object_id}: reviewed_edit_ids must name accepted edits of this package`,
        );
      }
      for (const edit of edits) {
        if (edit.status !== "accepted" && edit.status !== "stale") continue;
        const affected =
          (edit.depends_on_objects as string[]).includes(obj.object_id) ||
          (obj.evidence as Rec[]).some((a) => anchorsOverlap(a, edit.anchor));
        const reconsidered =
          edit.status === "accepted" &&
          reviewedEdits.has(edit.edit_id) &&
          ((review.object_ids ?? []) as string[]).includes(obj.object_id) &&
          review.result === "supported" &&
          reviewIsIndependent(review) &&
          obj.status === "reviewed";
        if (affected && !reconsidered) {
          staleEditObjs.add(obj.object_id);
          if (obj.status !== "stale" && obj.status !== "rejected") {
            add(
              "stale_not_propagated",
              `object ${obj.object_id}`,
              `object ${obj.object_id}: depends on a stale edit or an unreassessed accepted correction but is ${obj.status}`,
            );
          }
        }
      }
    }
    const staleObjs = new Set<string>([
      ...objects
        .filter((o) => o.status === "stale" || o.status === "rejected")
        .map((o) => o.object_id),
      ...staleEditObjs,
    ]);
    for (const rel of relations) {
      if (
        (staleObjs.has(rel.from) || staleObjs.has(rel.to)) &&
        rel.status !== "stale" &&
        rel.status !== "rejected"
      ) {
        add(
          "stale_not_propagated",
          `relation ${rel.relation_id}`,
          `relation ${rel.relation_id}: touches a stale or rejected object but is ${rel.status}`,
        );
      }
    }

    // Quality
    const sem: Rec = quality.semantics;
    const damage: Rec | undefined = quality.damage;
    if (
      damage !== undefined &&
      damage.places !==
        (damage.declarations as Rec[]).reduce((s, d) => s + d.count, 0)
    ) {
      add(
        "quality_incoherent",
        "quality",
        "quality.damage.places differs from the sum of the declaration counts; a declared place is counted once",
      );
    }
    if (
      sem.objects_count !== objects.length ||
      sem.relations_count !== relations.length
    ) {
      add(
        "quality_incoherent",
        "quality",
        "quality.semantics counts differ from the object and relation files",
      );
    }
    if (quality.package_id !== manifest.package_id)
      add(
        "quality_incoherent",
        "quality",
        "quality: package_id differs from the manifest",
      );
    const ext: Rec = quality.extraction;
    const checks: Rec[] = ext.checks;
    if (
      "units_expected" in ext &&
      "units_seen" in ext &&
      ext.status === "pass" &&
      ext.units_seen !== ext.units_expected
    ) {
      add(
        "quality_incoherent",
        "quality.extraction",
        "quality.extraction: status pass with units_seen different from units_expected",
      );
    }
    if (ext.status === "pass") {
      if (checks.length === 0 || !checks.some((c) => c.result === "pass")) {
        add(
          "quality_incoherent",
          "quality.extraction",
          "quality.extraction: status pass requires at least one applicable passing check",
        );
      }
      if (checks.some((c) => c.result === "fail"))
        add(
          "quality_incoherent",
          "quality.extraction",
          "quality.extraction: status pass with a failed check",
        );
      if (checks.some((c) => c.result === "unknown"))
        add(
          "quality_incoherent",
          "quality.extraction",
          "quality.extraction: status pass with an unknown check",
        );
    }
    if (new Set(checks.map((c) => c.check_id)).size !== checks.length) {
      add(
        "quality_incoherent",
        "quality.extraction",
        "quality.extraction: duplicate check_id",
      );
    }
    if ("document_md" in comps && ext.status === "adapter_required") {
      add(
        "quality_incoherent",
        "quality.extraction",
        "quality.extraction adapter_required contradicts available converter output",
      );
    }
    if (
      !("document_md" in comps) &&
      (ext.status === "pass" || ext.status === "partial")
    ) {
      add(
        "quality_incoherent",
        "quality.extraction",
        "quality.extraction pass/partial requires converter output",
      );
    }
    if (Object.keys(review).length > 0) {
      if (review.sample_size !== (review.object_ids as string[]).length) {
        add(
          "review_binding_mismatch",
          "quality.semantics.review",
          "semantic review sample_size differs from its distinct object_ids",
        );
      }
      const relSet = new Set<string>(relIds);
      if (
        !(review.object_ids as string[]).every((o) => known.has(o)) ||
        !(review.relation_ids as string[]).every((r) => relSet.has(r))
      ) {
        add(
          "review_binding_mismatch",
          "quality.semantics.review",
          "semantic review names an unknown object or relation",
        );
      }
      for (const key of ["objects", "relations", "readable_md"]) {
        const field =
          key === "readable_md" ? "readable_sha256" : `${key}_sha256`;
        if (!(key in comps) || review[field] !== comps[key].sha256) {
          add(
            "review_binding_mismatch",
            "quality.semantics.review",
            `semantic review ${field} is not bound to the current package bytes`,
          );
        }
      }
      for (const obj of objects) {
        if ((review.object_ids as string[]).includes(obj.object_id)) {
          const refs: Rec = obj.semantic_facets.assessment_refs;
          if (
            refs.state !== "known" ||
            !(refs.value as string[]).includes(review.review_id)
          ) {
            add(
              "review_binding_mismatch",
              `object ${obj.object_id}`,
              `object ${obj.object_id}: assessment_refs omit the package review that names it`,
            );
          }
        }
      }
    }
    const derived = derivePackageStatus(manifest, quality, objects, relations);
    if (manifest.package_status !== derived) {
      add(
        "status_incoherent",
        "manifest.package_status",
        `package_status ${manifest.package_status} differs from derived ${derived}; knowledge_ready requires a complete independent supported review, full verified source and extraction pass; structure_only requires an unbuilt semantic layer`,
      );
    }
    if (
      (sem.status === "not_built" || sem.status === "not_measured") &&
      (objects.length > 0 || relations.length > 0)
    ) {
      add(
        "status_incoherent",
        "quality.semantics",
        "semantics not_built/not_measured but the semantic files are not empty",
      );
    }
    return { problems, manifest, objects, relations, edits, quality, derived };
  } catch (e) {
    // The pinned checker lets PackageError escape check_package; main() then prints that one message and nothing else.
    if (e instanceof PackageError)
      return {
        problems: [{ code: e.code, where: e.where, message: e.message }],
        manifest,
      };
    throw e;
  }
}

function project(
  files: Map<string, Uint8Array>,
  c: Required<Checked>,
  manifestBytes: Uint8Array,
): BookPackageProjection {
  const { manifest, objects, relations, edits, quality } = c;
  const review: Rec = quality.semantics.review ?? {};
  const known = new Set<string>(objects.map((o) => o.object_id));
  const anchors: AnchorRow[] = [
    ...objects.flatMap((o) =>
      anchorsOf(o).map((anchor) => ({
        owner: "object" as const,
        owner_id: o.object_id as string,
        anchor,
      })),
    ),
    ...relations.flatMap((r) =>
      anchorsOf(r).map((anchor) => ({
        owner: "relation" as const,
        owner_id: r.relation_id as string,
        anchor,
      })),
    ),
    ...edits.flatMap((e) =>
      anchorsOf(e).map((anchor) => ({
        owner: "edit" as const,
        owner_id: e.edit_id as string,
        anchor,
      })),
    ),
  ];
  const listed = new Set<string>(["manifest.json"]);
  for (const [name, meta] of Object.entries(manifest.components as Rec)) {
    if (name === "assets") {
      for (const a of meta) if (a.state === "present") listed.add(a.path);
    } else {
      listed.add((meta as Rec).path);
    }
  }
  const canon = (p: string): string =>
    p
      .split("/")
      .filter((s) => s !== "" && s !== ".")
      .join("/");
  const listedCanon = new Set([...listed].map(canon));
  const provenanceRow = (r: Rec, idKey: string) => ({
    [idKey]: r[idKey] as string,
    origin: r.origin as string,
    presented_as_author: r.presented_as_author as boolean,
    generated: "generation" in r,
    status: r.status as string,
  });
  return {
    package_identity: {
      package_id: manifest.package_id,
      release_id: manifest.release_id,
      validation_profile: manifest.validation_profile,
      declared_package_status: manifest.package_status,
      derived_package_status: c.derived,
      manifest_sha256: sha256(manifestBytes),
      manifest_bytes: manifestBytes.length,
    },
    work: manifest.work,
    edition: manifest.edition,
    representation: manifest.representation,
    rights: manifest.rights,
    manifest,
    objects,
    relations,
    edits,
    quality,
    anchors,
    provenance: {
      tooling: manifest.tooling,
      document_md_tool: manifest.components.document_md
        ? {
            tool: manifest.components.document_md.tool,
            tool_version: manifest.components.document_md.tool_version,
          }
        : null,
      objects: objects.map((o) => provenanceRow(o, "object_id")) as any,
      relations: relations.map((r) => provenanceRow(r, "relation_id")) as any,
      review: {
        present: Object.keys(review).length > 0,
        review_id: review.review_id ?? null,
        reviewer_type: review.reviewer_type ?? null,
        reviewer_id: review.reviewer_id ?? null,
        producer_id: review.producer_id ?? null,
        declared_independent:
          Object.keys(review).length > 0 && reviewIsIndependent(review),
        result: review.result ?? null,
        semantics_status: quality.semantics.status,
        binds_current_bytes:
          Object.keys(review).length > 0 &&
          review.objects_sha256 === manifest.components.objects.sha256 &&
          review.relations_sha256 === manifest.components.relations.sha256 &&
          review.readable_sha256 === manifest.components.readable_md?.sha256,
      },
    },
    relation_endpoints: relations.map((r) => ({
      relation_id: r.relation_id,
      from: r.from,
      to: r.to,
      from_known: known.has(r.from),
      to_known: known.has(r.to),
    })),
    damage: quality.damage ?? null,
    unlisted_files: [...files.keys()].filter((k) => !listedCanon.has(k)).sort(),
  };
}

/** Inspect one book-package/2 directory given as relative-path → bytes. Never throws for package content. */
export function inspectBookPackage(input: PackageFiles): InspectionResult {
  const files = normalise(input);
  let checked: Checked;
  try {
    checked = checkPackage(files);
  } catch (e) {
    checked = {
      problems: [
        {
          code: "manifest_unreadable",
          where: "package",
          message: `inspector fault: ${(e as Error).name}`,
        },
      ],
    };
  }
  const manifestBytes = lookup(files, "manifest.json");
  const ok = checked.problems.length === 0;
  return {
    schema: "ArcanadaBookPackageInspection/v1",
    profile: "book-package/2",
    verdict: ok ? "pass" : "refused",
    kc2_admission: "not_measured",
    pins: PINS,
    refusals: checked.problems,
    components: componentTable(checked.manifest ?? null, files),
    projection:
      ok && manifestBytes
        ? project(files, checked as Required<Checked>, manifestBytes)
        : null,
    limits: LIMITS,
  };
}

/** Schema-only verdict for one record (manifest, object, relation, edit or quality), as the checker's `schema_errors`. */
export function inspectRecord(record: unknown): Refusal[] {
  return schemaProblems(record, "<record>");
}

export { SCHEMA_TAGS };
