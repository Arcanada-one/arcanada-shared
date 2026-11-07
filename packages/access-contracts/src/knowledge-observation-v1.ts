/**
 * Knowledge Collective Live Lab observation profile `knowledge-collective-observation/v1`:
 * types, strict versioned decoding and the pure helpers the shared reducer builds on.
 *
 * Placement: additive at the existing `@arcanada/access-contracts` boundary. Dependency-free: the vendored JSON Schema
 * (`knowledge-observation-v1.amendment-1.schema.json`, derived from the pinned v1 file by the reviewed workspace
 * amendment-1 and sha256-pinned; the unmodified v1 file is kept as a test fixture for the compatibility check) is
 * interpreted by a small total validator below instead of a schema library. Frames are bounded by `parseBoundedJson` (1..65532 bytes, depth 16);
 * this module introduces no second parser. Authenticity of identities, grants, watermarks and acceptance decisions is
 * NOT established here: the caller (the external read adapter) supplies verified context.
 */
import { parseBoundedJson } from "./bounded-json.js";
import schemaJson from "./knowledge-observation-v1.amendment-1.schema.json" with { type: "json" };

/* ---- types ---- */
/** Hand-written types for the fields the decoder and reducer read. The JSON Schema stays the structural authority. */

export const PROFILE_ID = "knowledge-collective-observation/v1" as const;
export const LOSSLESS_DECIMAL_EXTENSION =
  "lossless-decimal-counters/v1" as const;

export type GraphKind =
  | "processing_execution"
  | "contract_receipt_chain"
  | "knowledge"
  | "work";
export type ObservationMode = "live" | "replay" | "fixture";
export type RecordType =
  | "run"
  | "event"
  | "snapshot"
  | "attempt"
  | "artifact"
  | "command"
  | "deployment";

export interface ViewContext {
  readonly project_id: string;
  readonly run_id: string;
  readonly authorized_view_scope: string;
  readonly stream_epoch: string;
}

export interface QualifiedRef {
  readonly graph_kind: GraphKind;
  readonly authority: string;
  readonly namespace: string;
  readonly local_id: string;
  readonly revision: string | null;
}

export interface NativeState {
  readonly authority: string;
  readonly value: string;
  readonly reason: string | null;
}

export interface Digest {
  readonly algorithm: string;
  readonly role: string;
  readonly domain: string;
  readonly preimage: string;
  readonly representation: string;
  readonly byte_size: string | null;
  readonly value: string;
}

export interface Checker {
  readonly checker_id: string;
  readonly verdict: "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";
  readonly [key: string]: unknown;
}

export interface Acceptance {
  readonly verdict: "PASS" | "FAIL" | "NOT_MEASURED";
  readonly claim_ids: readonly string[];
  readonly scope_ref: string;
  readonly checks: readonly Checker[];
  readonly reason: string | null;
  readonly decision_evidence_ref: string | null;
  readonly decision_policy_ref: string | null;
  readonly [key: string]: unknown;
}

export interface SourceSequence {
  readonly value: string | null;
  readonly scope: string;
  readonly scope_id: string;
  readonly partition_id: string | null;
  readonly contiguity: "declared_contiguous" | "not_contiguous" | "unknown";
  readonly declaration_ref: string | null;
}

export interface Producer {
  readonly service: string;
  readonly instance_id: string;
  readonly build: {
    readonly repository: string;
    readonly commit: string;
    readonly adapter_revision: string;
  };
}

export interface GraphNode {
  readonly ref: QualifiedRef;
  readonly node_type: string;
  readonly native_state: NativeState | null;
  readonly native_versions: Readonly<Record<string, string>>;
  readonly acceptance: Acceptance;
  readonly evidence_refs: readonly string[];
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface GraphEdge {
  readonly edge_id: string;
  readonly kind: string;
  readonly from: QualifiedRef;
  readonly to: QualifiedRef;
  readonly evidence_refs: readonly string[];
}

export interface Graph {
  readonly graph_kind: GraphKind;
  readonly authority: string;
  readonly graph_revision: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export interface Crosslink {
  readonly link_id: string;
  readonly kind: string;
  readonly from: QualifiedRef;
  readonly to: QualifiedRef;
  readonly association_ref: string;
  readonly evidence_refs: readonly string[];
}

export interface SnapshotData {
  readonly watermark: string;
  readonly snapshot_kind: "full" | "partial";
  readonly trusted_snapshot_ref: string;
  readonly plan_revision: string | null;
  readonly coverage: {
    readonly extent: string;
    readonly declared_graph_kinds: readonly GraphKind[];
    readonly complete: boolean;
    readonly next_page_token: string | null;
    /** Amendment 1: names the immutable page set this page belongs to. A claim, proven only by a trusted manifest. */
    readonly page_set?: {
      readonly page_set_ref: string;
      readonly page_index: string;
      readonly page_count: string;
    };
  };
  readonly source_atomicity:
    | "not_established"
    | "source_asserted_with_evidence";
  readonly graphs: readonly Graph[];
  readonly crosslinks: readonly Crosslink[];
  readonly reset: {
    readonly previous_epoch: string;
    readonly reason: string;
    readonly authorization_observation_ref: string;
  } | null;
  readonly source_revisions: readonly unknown[];
  readonly allowed_actions_observation: readonly unknown[];
  readonly native_state: NativeState | null;
  readonly acceptance: Acceptance;
}

export interface EventData {
  readonly event_id: string;
  readonly cursor: string;
  readonly producer_event_id: string;
  readonly source_sequence: SourceSequence;
  readonly kind: string;
  readonly plan_revision: string | null;
  readonly subject_refs: readonly QualifiedRef[];
  readonly occurred_at: string;
  readonly causation_ref: string | null;
  readonly correlation_ref: string | null;
  readonly native_state: NativeState | null;
  readonly native_versions: Readonly<Record<string, string>>;
  readonly evidence_refs: readonly string[];
  readonly body: { readonly evidence_ref: string; readonly digest: Digest };
  readonly related_record_ids: readonly string[];
}

export interface RunData {
  readonly kind: "knowledge" | "agent";
  readonly root_task: QualifiedRef | null;
  readonly current_cursor: string | null;
  readonly connection: "connected" | "disconnected" | "unconnected";
  readonly freshness: {
    readonly state: string;
    readonly as_of: string | null;
    readonly reason: string | null;
  };
  readonly native_state: NativeState | null;
  readonly acceptance: Acceptance;
  readonly [key: string]: unknown;
}

export interface AttemptData {
  readonly attempt_ref: QualifiedRef;
  readonly task_or_stage_ref: QualifiedRef;
  readonly ordinal: string;
  readonly plan_revision: string | null;
  readonly native_state: NativeState | null;
  readonly evidence_coverage: "exact_attempt" | "unbounded_slice" | "unknown";
  readonly outputs: readonly unknown[];
  readonly acceptance: Acceptance;
  readonly [key: string]: unknown;
}

export interface ArtifactKey {
  readonly authority: string;
  readonly namespace: string;
  readonly artifact_id: string;
  readonly revision: string;
}

export interface ArtifactData {
  readonly artifact: ArtifactKey;
  readonly profile: string;
  readonly kind: string;
  readonly byte_size: string | null;
  readonly digests: readonly Digest[];
  readonly locator: unknown;
  readonly storage_identity: "immutable" | "versioned" | "mutable" | "unknown";
  readonly availability:
    | "retained"
    | "missing"
    | "collected"
    | "quarantined"
    | "unknown";
  readonly access: "allowed" | "denied" | "unknown";
  readonly supersedes: ArtifactKey | null;
  readonly acceptance: Acceptance;
  readonly [key: string]: unknown;
}

export interface CommandData {
  readonly command_id: string;
  readonly operation: string;
  readonly journal_status:
    | "intent_observed"
    | "accepted_observed"
    | "rejected_observed"
    | "unknown";
  readonly reason: string | null;
  readonly canonical_run_id: string | null;
  readonly canonical_task_ref: QualifiedRef | null;
  readonly canonical_attempt_ref: QualifiedRef | null;
  readonly acceptance: Acceptance;
  readonly [key: string]: unknown;
}

export interface DeploymentData {
  readonly service_alias: string;
  readonly environment: string;
  readonly actual_build: unknown;
  readonly capabilities: readonly {
    readonly name: string;
    readonly status: string;
  }[];
  readonly acceptance: Acceptance;
  readonly [key: string]: unknown;
}

interface Envelope<T extends RecordType, D> {
  readonly profile: typeof PROFILE_ID;
  readonly record_type: T;
  readonly record_id: string;
  readonly mode: ObservationMode;
  readonly view_context: ViewContext;
  readonly producer: Producer;
  readonly observed_at: string;
  readonly recorded_at: string;
  readonly evidence_basis: string;
  readonly data: D;
  readonly required_extensions: readonly string[];
}

export type RunRecord = Envelope<"run", RunData>;
export type EventRecord = Envelope<"event", EventData>;
export type SnapshotRecord = Envelope<"snapshot", SnapshotData>;
export type AttemptRecord = Envelope<"attempt", AttemptData>;
export type ArtifactRecord = Envelope<"artifact", ArtifactData>;
export type CommandRecord = Envelope<"command", CommandData>;
export type DeploymentRecord = Envelope<"deployment", DeploymentData>;

export type ObservationRecord =
  | RunRecord
  | EventRecord
  | SnapshotRecord
  | AttemptRecord
  | ArtifactRecord
  | CommandRecord
  | DeploymentRecord;

/* ---- decimal counters ---- */
const DECIMAL = /^(0|[1-9][0-9]*)$/;

/** True for a canonical nonnegative decimal string (no sign, no leading zeros, no JSON number). */
export function isCanonicalDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL.test(value);
}

/** Arbitrary-precision comparison of canonical decimal strings: length first, then lexical order. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  if (!isCanonicalDecimal(a) || !isCanonicalDecimal(b)) {
    throw new RangeError(
      "compareDecimal requires canonical nonnegative decimal strings",
    );
  }
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Exact successor of a canonical decimal string. */
export function nextDecimal(a: string): string {
  if (!isCanonicalDecimal(a))
    throw new RangeError("nextDecimal requires a canonical decimal string");
  const digits = a.split("");
  let i = digits.length - 1;
  while (i >= 0) {
    if (digits[i] === "9") {
      digits[i] = "0";
      i -= 1;
    } else {
      digits[i] = String(Number(digits[i]) + 1);
      return digits.join("");
    }
  }
  return `1${digits.join("")}`;
}

/* ---- canonical JSON ---- */
/** Deterministic JSON serialisation with sorted object keys. Used to compare complete immutable record bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value))
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function deepClone<T>(value: T): T {
  return structuredClone(value);
}

/* ---- digests ---- */

export type DigestComparison = "EQUAL" | "DIFFERENT" | "INCOMPARABLE_DOMAINS";

/** Digests are comparable only inside one algorithm, role, domain, preimage and representation. */
export function compareDigests(a: Digest, b: Digest): DigestComparison {
  if (
    a.algorithm !== b.algorithm ||
    a.role !== b.role ||
    a.domain !== b.domain ||
    a.preimage !== b.preimage ||
    a.representation !== b.representation
  ) {
    return "INCOMPARABLE_DOMAINS";
  }
  return a.value === b.value ? "EQUAL" : "DIFFERENT";
}

/** Only an exact_content digest names content. A fingerprint or domain identity never does. */
export function isExactContentAddress(d: Digest): boolean {
  return d.role === "exact_content" && d.domain === "raw-bytes";
}

/* ---- acceptance ---- */

export type AcceptanceIssueCode =
  | "EMPTY_CHECKER_PASS"
  | "ACCEPTANCE_DECISION_MISSING"
  | "ACCEPTANCE_POLICY_CONFLICT"
  | "FAIL_WITHOUT_FAILING_CHECK";

export interface AcceptancePolicy {
  /** Check ids the policy declares mandatory, or "all-listed" when every listed check is mandatory. */
  readonly mandatoryChecks: readonly string[] | "all-listed";
}

export interface AcceptanceEvaluation {
  readonly sourceVerdict: Acceptance["verdict"];
  /**
   * What the consumer may show as current independent acceptance. This reducer never promotes a source PASS: that needs
   * a separately verified, authentic acceptance decision (KCLIVE-22), which a pure projection cannot supply.
   */
  readonly effectiveVerdict: "NOT_MEASURED" | "FAIL";
  /**
   * Why `effectiveVerdict` has its value. `source_fail_unverified` is a raw source FAIL that carries an actual failing
   * checker observation: it is retained and fails closed, but it is NOT independently verified, because the pure
   * reducer cannot authenticate the checker or bind it to the current subject (KCLIVE-22). `none` is NOT_MEASURED.
   */
  readonly basis: "none" | "source_fail_unverified";
  /** Always false here: independent acceptance needs authenticated checker binding that a pure projection cannot supply. */
  readonly independentlyVerified: false;
  readonly issues: readonly AcceptanceIssueCode[];
  /** Executed checkers whose own verdict is UNKNOWN or NOT_APPLICABLE; they differ from checks=[] (no observation). */
  readonly executedUndecided: readonly string[];
  readonly checkersObserved: boolean;
}

export function evaluateAcceptance(
  acceptance: Acceptance,
  policy?: AcceptancePolicy,
): AcceptanceEvaluation {
  const issues: AcceptanceIssueCode[] = [];
  const checks = acceptance.checks;
  const executedUndecided = checks
    .filter((c) => c.verdict === "UNKNOWN" || c.verdict === "NOT_APPLICABLE")
    .map((c) => c.checker_id);
  if (acceptance.verdict === "PASS") {
    if (checks.length === 0) issues.push("EMPTY_CHECKER_PASS");
    if (
      acceptance.decision_evidence_ref === null ||
      acceptance.decision_policy_ref === null
    ) {
      issues.push("ACCEPTANCE_DECISION_MISSING");
    }
    if (policy !== undefined) {
      const mandatory =
        policy.mandatoryChecks === "all-listed"
          ? checks
          : checks.filter((c) => policy.mandatoryChecks.includes(c.checker_id));
      if (mandatory.some((c) => c.verdict !== "PASS"))
        issues.push("ACCEPTANCE_POLICY_CONFLICT");
    }
  }
  let effective: "NOT_MEASURED" | "FAIL" = "NOT_MEASURED";
  if (acceptance.verdict === "FAIL") {
    if (checks.some((c) => c.verdict === "FAIL")) effective = "FAIL";
    else issues.push("FAIL_WITHOUT_FAILING_CHECK");
  }
  return {
    sourceVerdict: acceptance.verdict,
    effectiveVerdict: effective,
    basis: effective === "FAIL" ? "source_fail_unverified" : "none",
    independentlyVerified: false,
    issues,
    executedUndecided,
    checkersObserved: checks.length > 0,
  };
}

/* ---- Doclab native shape ---- */
export type DoclabNativeShape =
  | "b2_finished_converted_text"
  | "ordinary"
  | "unrecognized";

export interface DoclabNativeClassification {
  readonly shape: DoclabNativeShape;
  readonly workerStageNodes: number;
  readonly workerExecutionObserved: boolean;
}

interface NativeRead {
  readonly run?: { readonly profile?: unknown; readonly status?: unknown };
  readonly events?: readonly { readonly event_type?: unknown }[];
  readonly stage_tasks?: readonly unknown[];
  readonly stage_attempts?: readonly unknown[];
}

/**
 * Classify a Doclab native read taken from ONE database snapshot. The B2 finished shape needs all four conditions; the
 * profile name alone is insufficient. Absence of stage rows is scoped to this read and says nothing about other upstream
 * converters.
 */
export function classifyDoclabNativeShape(
  read: unknown,
): DoclabNativeClassification {
  if (typeof read !== "object" || read === null)
    return {
      shape: "unrecognized",
      workerStageNodes: 0,
      workerExecutionObserved: false,
    };
  const r = read as NativeRead;
  const stages = Array.isArray(r.stage_tasks) ? r.stage_tasks.length : 0;
  const attempts = Array.isArray(r.stage_attempts)
    ? r.stage_attempts.length
    : 0;
  if (r.run === undefined || !Array.isArray(r.stage_tasks))
    return {
      shape: "unrecognized",
      workerStageNodes: stages,
      workerExecutionObserved: false,
    };
  const finishedEvent = (r.events ?? []).some(
    (e) => e.event_type === "run_inserted_finished",
  );
  const b2 =
    r.run.profile === "converted-text" &&
    r.run.status === "SUCCEEDED" &&
    finishedEvent &&
    stages === 0;
  return {
    shape: b2 ? "b2_finished_converted_text" : "ordinary",
    workerStageNodes: stages,
    workerExecutionObserved: !b2 && (stages > 0 || attempts > 0),
  };
}

/* ---- strict schema interpreter (vendored schema keywords only; unsupported keywords fail closed) ---- */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type SchemaNode = { [key: string]: unknown };

const ANNOTATION_KEYWORDS = new Set([
  "$schema",
  "$id",
  "title",
  "description",
  "$defs",
]);
const SUPPORTED_KEYWORDS = new Set([
  ...ANNOTATION_KEYWORDS,
  "oneOf",
  "allOf",
  "if",
  "then",
  "else",
  "$ref",
  "type",
  "const",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "pattern",
  "format",
]);

const ROOT_SCHEMA = schemaJson as unknown as SchemaNode;
const DEFS = (ROOT_SCHEMA["$defs"] ?? {}) as Record<string, SchemaNode>;
const REGEX_CACHE = new Map<string, RegExp>();

function assertSupported(node: unknown, mapOfSchemas = false): void {
  if (Array.isArray(node)) {
    for (const n of node) assertSupported(n);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  if (mapOfSchemas) {
    for (const v of Object.values(node)) assertSupported(v);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (!SUPPORTED_KEYWORDS.has(key))
      throw new Error(
        `knowledge-observation schema uses unsupported keyword ${key}`,
      );
    if (key === "properties" || key === "$defs") assertSupported(value, true);
    else if (
      key === "const" ||
      key === "enum" ||
      key === "required" ||
      key === "pattern" ||
      key === "type"
    )
      continue;
    else assertSupported(value);
  }
}
assertSupported(ROOT_SCHEMA);

function regexFor(pattern: string): RegExp {
  let re = REGEX_CACHE.get(pattern);
  if (re === undefined) {
    re = new RegExp(pattern, "u");
    REGEX_CACHE.set(pattern, re);
  }
  return re;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2)
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** RFC 3339 `date-time` with calendar validation. Offsets and fractional seconds are preserved by the caller, not here. */
export function isRfc3339DateTime(value: string): boolean {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (m === null) return false;
  const [year, month, day, hour, minute, second] = [
    m[1],
    m[2],
    m[3],
    m[4],
    m[5],
    m[6],
  ].map(Number) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month))
    return false;
  if (hour > 23 || minute > 59 || second > 60) return false;
  let offsetMinutes = 0;
  if (m[8] !== undefined && m[8] !== "Z" && m[8] !== "z") {
    const oh = Number(m[9]);
    const om = Number(m[10]);
    if (oh > 23 || om > 59) return false;
    offsetMinutes = (m[8].startsWith("-") ? -1 : 1) * (oh * 60 + om);
  }
  if (second === 60) {
    // A leap second only exists at 23:59:60 UTC.
    const utcMinutes =
      (((hour * 60 + minute - offsetMinutes) % 1440) + 1440) % 1440;
    if (utcMinutes !== 23 * 60 + 59) return false;
  }
  return true;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function matches(node: SchemaNode, value: unknown): boolean {
  const ref = node["$ref"];
  if (typeof ref === "string") {
    const target = DEFS[ref.replace("#/$defs/", "")];
    if (target === undefined || !matches(target, value)) return false;
  }
  if ("const" in node && !jsonEqual(node["const"], value)) return false;
  if (
    "enum" in node &&
    !(node["enum"] as unknown[]).some((e) => jsonEqual(e, value))
  )
    return false;
  const type = node["type"];
  if (typeof type === "string") {
    const ok =
      type === "object"
        ? isPlainObject(value)
        : type === "array"
          ? Array.isArray(value)
          : type === "string"
            ? typeof value === "string"
            : type === "boolean"
              ? typeof value === "boolean"
              : type === "null"
                ? value === null
                : type === "integer"
                  ? typeof value === "number" && Number.isInteger(value)
                  : type === "number"
                    ? typeof value === "number" && Number.isFinite(value)
                    : false;
    if (!ok) return false;
  }
  if (typeof value === "string") {
    const len = Array.from(value).length;
    if (typeof node["minLength"] === "number" && len < node["minLength"])
      return false;
    if (typeof node["maxLength"] === "number" && len > node["maxLength"])
      return false;
    if (
      typeof node["pattern"] === "string" &&
      !regexFor(node["pattern"]).test(value)
    )
      return false;
    if (node["format"] === "date-time" && !isRfc3339DateTime(value))
      return false;
  }
  if (Array.isArray(value)) {
    if (typeof node["minItems"] === "number" && value.length < node["minItems"])
      return false;
    if (typeof node["maxItems"] === "number" && value.length > node["maxItems"])
      return false;
    if (
      node["uniqueItems"] === true &&
      new Set(value.map((v) => canonicalJson(v))).size !== value.length
    )
      return false;
    const items = node["items"];
    if (
      isPlainObject(items) &&
      !value.every((v) => matches(items as SchemaNode, v))
    )
      return false;
  }
  if (isPlainObject(value)) {
    const props = (node["properties"] ?? {}) as Record<string, SchemaNode>;
    for (const key of (node["required"] ?? []) as string[])
      if (!Object.hasOwn(value, key)) return false;
    for (const [key, sub] of Object.entries(props))
      if (Object.hasOwn(value, key) && !matches(sub, value[key])) return false;
    if (node["additionalProperties"] === false) {
      for (const key of Object.keys(value))
        if (!Object.hasOwn(props, key)) return false;
    }
  }
  const oneOf = node["oneOf"];
  if (
    Array.isArray(oneOf) &&
    oneOf.filter((s) => matches(s as SchemaNode, value)).length !== 1
  )
    return false;
  const allOf = node["allOf"];
  if (
    Array.isArray(allOf) &&
    !allOf.every((s) => matches(s as SchemaNode, value))
  )
    return false;
  if (isPlainObject(node["if"])) {
    const cond = matches(node["if"] as SchemaNode, value);
    if (
      cond &&
      isPlainObject(node["then"]) &&
      !matches(node["then"] as SchemaNode, value)
    )
      return false;
    if (
      !cond &&
      isPlainObject(node["else"]) &&
      !matches(node["else"] as SchemaNode, value)
    )
      return false;
  }
  return true;
}

/** Structural validity against the vendored schema. Exported for differential testing and diagnostics only. */
export function isStructurallyValidKnowledgeObservation(
  value: unknown,
): boolean {
  return matches(ROOT_SCHEMA, value);
}

/**
 * Capture own enumerable data properties once (no getters, no symbols, no exotic prototypes, no sparse arrays), so the
 * value that is validated is the value that is returned, within the 16-level wire depth.
 */
function ownDataCopy(
  value: unknown,
  depth = 0,
): { ok: true; value: Json } | { ok: false } {
  if (depth > 16) return { ok: false };
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return { ok: true, value };
  if (typeof value === "number")
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  if (typeof value !== "object") return { ok: false };
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return { ok: false };
    const out: Json[] = [];
    const lengthDesc = Object.getOwnPropertyDescriptor(value, "length");
    if (lengthDesc === undefined || typeof lengthDesc.value !== "number")
      return { ok: false };
    if (Reflect.ownKeys(value).length !== lengthDesc.value + 1)
      return { ok: false };
    for (let i = 0; i < lengthDesc.value; i += 1) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (d === undefined || !Object.hasOwn(d, "value") || !d.enumerable)
        return { ok: false };
      const c = ownDataCopy(d.value, depth + 1);
      if (!c.ok) return c;
      out.push(c.value);
    }
    return { ok: true, value: out };
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return { ok: false };
  const out: { [key: string]: Json } = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return { ok: false };
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (d === undefined || !d.enumerable || !Object.hasOwn(d, "value"))
      return { ok: false };
    const c = ownDataCopy(d.value, depth + 1);
    if (!c.ok) return c;
    Object.defineProperty(out, key, {
      value: c.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { ok: true, value: out };
}

/* ---- decoder ---- */

export type DecodeFailureCode =
  | "INVALID_FRAME"
  | "NOT_AN_OBJECT"
  | "UNSUPPORTED_PROFILE"
  | "UNSUPPORTED_RECORD_KIND"
  | "UNSUPPORTED_REQUIRED_EXTENSION"
  | "SCHEMA_INVALID";

export type DecodeResult =
  | { readonly ok: true; readonly record: ObservationRecord }
  | {
      readonly ok: false;
      readonly code: DecodeFailureCode;
      readonly detail: string;
    };

export interface DecodeOptions {
  /** Required extensions the consumer has negotiated. Default: the lossless decimal counter extension. */
  readonly supportedExtensions?: readonly string[];
}

const KNOWN_KINDS: readonly RecordType[] = [
  "run",
  "event",
  "snapshot",
  "attempt",
  "artifact",
  "command",
  "deployment",
];

/**
 * Strictly decode one already-parsed observation record. Unknown schema versions, unsupported record kinds and
 * unsupported required extensions fail explicitly; nothing is skipped silently and no value is coerced. The returned
 * record is an own-data copy, so a later mutation or getter on the caller's object cannot change what was validated.
 */
export function decodeObservationRecord(
  input: unknown,
  options: DecodeOptions = {},
): DecodeResult {
  const copy = ownDataCopy(input);
  if (!copy.ok)
    return {
      ok: false,
      code: "NOT_AN_OBJECT",
      detail: "record is not plain bounded JSON data",
    };
  const obj = copy.value;
  if (!isPlainObject(obj))
    return {
      ok: false,
      code: "NOT_AN_OBJECT",
      detail: "record must be a JSON object",
    };
  if (typeof obj["profile"] !== "string")
    return {
      ok: false,
      code: "SCHEMA_INVALID",
      detail: "profile is missing or not a string",
    };
  if (obj["profile"] !== PROFILE_ID) {
    return {
      ok: false,
      code: "UNSUPPORTED_PROFILE",
      detail: `unsupported profile ${JSON.stringify(obj["profile"])}`,
    };
  }
  const supported = options.supportedExtensions ?? [LOSSLESS_DECIMAL_EXTENSION];
  const exts = obj["required_extensions"];
  if (!Array.isArray(exts))
    return {
      ok: false,
      code: "SCHEMA_INVALID",
      detail: "required_extensions must be an array",
    };
  for (const ext of exts) {
    if (typeof ext !== "string" || !supported.includes(ext)) {
      return {
        ok: false,
        code: "UNSUPPORTED_REQUIRED_EXTENSION",
        detail: `required extension ${JSON.stringify(ext)} is not negotiated`,
      };
    }
  }
  if (!KNOWN_KINDS.includes(obj["record_type"] as RecordType)) {
    return {
      ok: false,
      code: "UNSUPPORTED_RECORD_KIND",
      detail: "record_type is not a supported kind",
    };
  }
  if (!matches(ROOT_SCHEMA, obj))
    return {
      ok: false,
      code: "SCHEMA_INVALID",
      detail: "record does not match the v1 schema",
    };
  return { ok: true, record: obj as unknown as ObservationRecord };
}

export type ParseResult =
  | {
      readonly ok: true;
      readonly record: ObservationRecord;
      readonly bytes: Uint8Array;
    }
  | {
      readonly ok: false;
      readonly code: DecodeFailureCode;
      readonly detail: string;
    };

/**
 * Parse one wire frame: `parseBoundedJson` (1..65532 UTF-8 bytes, depth 16, decoded duplicate keys and lone surrogates
 * rejected) and then `decodeObservationRecord`. The returned `bytes` are an owned copy of the exact input, kept for
 * callers that must retain the complete frame; counters travel as decimal strings, never as JSON numbers.
 */
export function parseKnowledgeObservationJson(
  raw: Uint8Array,
  options: DecodeOptions = {},
): ParseResult {
  let parsed: unknown;
  try {
    parsed = parseBoundedJson(raw);
  } catch {
    return {
      ok: false,
      code: "INVALID_FRAME",
      detail: "frame is not bounded strict JSON (1..65532 bytes, depth 16)",
    };
  }
  const decoded = decodeObservationRecord(parsed, options);
  if (!decoded.ok) return decoded;
  return { ok: true, record: decoded.record, bytes: new Uint8Array(raw) };
}
