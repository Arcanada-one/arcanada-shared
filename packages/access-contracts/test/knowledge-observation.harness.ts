import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createReducerState,
  projectView,
  reduce,
  snapshotPageDigest,
  type ObservationMode,
  type PageSetManifest,
  type ProjectedView,
  type ReduceOutcome,
  type ReducerInput,
  type ReducerState,
  type ViewContext,
} from "./knowledge-observation.api.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(HERE, "fixtures", "knowledge-observation-v1");

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T;
}

export interface Step {
  action: string;
  record_id?: string;
  record_ids?: string[];
  view_context?: ViewContext;
  old_view_context?: ViewContext;
  new_view_context?: ViewContext;
  authorization_observation_ref?: string;
  from_cursor?: string;
  through_cursor?: string;
  coverage_ref?: string;
  max_records?: number;
  max_serialized_bytes?: number;
  max_age_ms?: number;
  body_ids?: string[];
  policy_assumption?: string;
}

export interface Case {
  case_id: string;
  title: string;
  schema_examples: { record_id: string; expected_valid: boolean }[];
  steps: Step[];
  expected_observations: Record<string, unknown>;
  expected_emitted_commands: unknown[];
}

export interface Body {
  bytes_utf8: string;
  digest: {
    algorithm: string;
    role: string;
    domain: string;
    byte_size: string;
    value: string;
  };
  synthetic?: boolean;
  note?: string;
  preimage_prefix_ascii?: string;
}

export const records = load<{
  records: Record<string, Record<string, unknown>>;
}>("fixture-records.json").records;
export const bodies = load<{
  bodies: Record<string, Body> & {
    complete_event_records: Record<string, Body>;
  };
}>("fixture-bodies.json").bodies;
const casesFile = load<{
  cases: Case[];
  default_view_context: ViewContext;
  default_limits: {
    max_records: number;
    max_serialized_bytes: number;
    max_age_ms: number;
  };
  required_supported_extensions: string[];
  mode_matrix: ObservationMode[];
  all_cases_require_zero_emitted_commands: boolean;
}>("reducer-cases.json");
export const cases = casesFile.cases;
export const caseMeta = casesFile;

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface Trace {
  step: Step;
  outcomes: { key: string; outcome: ReduceOutcome }[];
  state: ReducerState;
  view: ProjectedView;
}

export interface Run {
  trace: Trace[];
  state: ReducerState;
  view: ProjectedView;
  /** Union of every command the reducer returned across the whole run. */
  commands: unknown[];
  /** Out-of-reducer observations the harness made for steps that are classifiers rather than state transitions. */
  digestComparisons: { body_ids: string[]; result: string }[];
}

function must(key: string): Record<string, unknown> {
  const r = records[key];
  if (r === undefined) throw new Error(`unknown fixture record ${key}`);
  return r;
}

/** Execute one prepared case in the real reducer. mode selects live/replay/fixture presentation. */
export function runCase(c: Case, mode: ObservationMode = "fixture"): Run {
  let state = createReducerState({
    mode,
    extensions: caseMeta.required_supported_extensions,
  });
  const commands: unknown[] = [];
  const trace: Trace[] = [];
  const digestComparisons: Run["digestComparisons"] = [];
  const apply = (
    inputs: { key: string; input: ReducerInput }[],
  ): { key: string; outcome: ReduceOutcome }[] => {
    const outcomes: { key: string; outcome: ReduceOutcome }[] = [];
    for (const { key, input } of inputs) {
      const r = reduce(state, input);
      state = r.state;
      commands.push(...r.commands);
      outcomes.push({ key, outcome: r.outcome });
    }
    return outcomes;
  };
  const first = apply([
    {
      key: "bind",
      input: {
        kind: "bind_trusted_projection",
        viewContext: caseMeta.default_view_context,
      },
    },
  ]);
  void first;
  c.steps.forEach((step, i) => {
    let outcomes: { key: string; outcome: ReduceOutcome }[] = [];
    const at = i * 10;
    switch (step.action) {
      case "bind_trusted_projection":
        outcomes = apply([
          {
            key: "bind",
            input: {
              kind: "bind_trusted_projection",
              viewContext: step.view_context as ViewContext,
            },
          },
        ]);
        break;
      case "set_fixture_buffer_limits":
        outcomes = apply([
          {
            key: "limits",
            input: {
              kind: "set_buffer_limits",
              limits: {
                maxRecords: step.max_records as number,
                maxSerializedBytes: step.max_serialized_bytes as number,
                maxAgeMs: step.max_age_ms as number,
              },
            },
          },
        ]);
        break;
      case "receive":
        outcomes = apply([
          {
            key: step.record_id as string,
            input: {
              kind: "receive",
              record: must(step.record_id as string),
              at,
            },
          },
        ]);
        break;
      case "replay_same_records":
        outcomes = apply([
          { key: "mode", input: { kind: "set_mode", mode: "replay" } },
          ...(step.record_ids as string[]).map((id) => ({
            key: id,
            input: { kind: "receive", record: must(id), at } as ReducerInput,
          })),
        ]);
        break;
      case "trusted_replay_interval":
        outcomes = apply([
          {
            key: "interval",
            input: {
              kind: "trusted_replay_interval",
              fromCursor: step.from_cursor as string,
              throughCursor: step.through_cursor as string,
              records: (step.record_ids as string[]).map(must),
              coverageRef: step.coverage_ref as string,
              at,
            },
          },
        ]);
        break;
      case "trusted_epoch_reset":
        outcomes = apply([
          {
            key: "reset",
            input: {
              kind: "trusted_epoch_reset",
              oldViewContext: step.old_view_context as ViewContext,
              newViewContext: step.new_view_context as ViewContext,
              authorizationObservationRef:
                step.authorization_observation_ref as string,
            },
          },
        ]);
        break;
      case "trusted_authorization_revoked":
        outcomes = apply([
          {
            key: "revoke",
            input: {
              kind: "trusted_authorization_revoked",
              viewContext: step.view_context as ViewContext,
            },
          },
        ]);
        break;
      case "semantic_acceptance_evaluation":
        // The fixture policy text names fixture:all-listed-checks-mandatory.
        outcomes = apply([
          {
            key: step.record_id as string,
            input: {
              kind: "evaluate_acceptance",
              recordId: step.record_id as string,
              policy: { mandatoryChecks: "all-listed" },
            },
          },
        ]);
        break;
      case "classify_independent_native_shapes":
      case "compare_fixture_digest_domains":
        // Not reducer state transitions: asserted by the case-specific check through the exported pure functions.
        break;
      default:
        throw new Error(`unmapped step action ${step.action}`);
    }
    trace.push({ step, outcomes, state, view: projectView(state) });
  });
  return {
    trace,
    state,
    view: projectView(state),
    commands,
    digestComparisons,
  };
}

/** Records a case-level expectation key as asserted; the suite compares this against the oracle's own key list. */
export const asserted = new Map<string, Set<string>>();
export function mark(caseId: string, key: string): void {
  let set = asserted.get(caseId);
  if (set === undefined) {
    set = new Set();
    asserted.set(caseId, set);
  }
  set.add(key);
}

/* ---- amendment-1 helpers: paged snapshots with a sealed manifest ---- */

/**
 * Split a fixture full snapshot into `n` partial pages of ONE immutable page set: graphs distributed round-robin, every
 * crosslink on the last page, `coverage.page_set` naming the set and the canonical ordinal, tokens/complete coherent.
 */
export function splitPages(
  id: string,
  n = 2,
  setRef = `${id}-set`,
): Record<string, unknown>[] {
  const full = structuredClone(records[id]) as Record<string, unknown>;
  const data = full["data"] as {
    graphs: unknown[];
    crosslinks: unknown[];
    coverage: Record<string, unknown>;
    snapshot_kind: string;
  };
  return Array.from({ length: n }, (_, i) => {
    const page = structuredClone(full) as Record<string, unknown>;
    page["record_id"] = `${id}-page-${i + 1}`;
    const d = page["data"] as typeof data;
    const last = i === n - 1;
    d.snapshot_kind = "partial";
    d.graphs = data.graphs.filter((_g, gi) => gi % n === i);
    d.crosslinks = last ? data.crosslinks : [];
    d.coverage = {
      ...data.coverage,
      complete: last,
      next_page_token: last ? null : `page-${i + 2}`,
      page_set: {
        page_set_ref: setRef,
        page_index: String(i),
        page_count: String(n),
      },
    };
    return page;
  });
}

/** Seal what a trusted adapter would: canonical digest and byte size of each page, in canonical ordinal order. */
export function sealManifest(
  pages: Record<string, unknown>[],
  overrides: Partial<PageSetManifest> = {},
): PageSetManifest {
  const first = pages[0] as {
    data: {
      watermark: string;
      trusted_snapshot_ref: string;
      plan_revision: string | null;
      coverage: { page_set: { page_set_ref: string } };
    };
  };
  const sealed = pages.map((page, pageIndex) => {
    const digest = snapshotPageDigest(page);
    if (digest === null) throw new Error("page does not decode");
    return { pageIndex, ...digest };
  });
  return {
    pageSetRef: first.data.coverage.page_set.page_set_ref,
    viewContext: caseMeta.default_view_context,
    trustedSnapshotRef: first.data.trusted_snapshot_ref,
    watermark: first.data.watermark,
    planRevision: first.data.plan_revision,
    pageCount: pages.length,
    pages: sealed.map((p) => ({
      pageIndex: p.pageIndex,
      sha256: p.sha256,
      byteSize: p.byteSize,
    })),
    totalBytes: sealed.reduce((n, p) => n + p.byteSize, 0),
    adapterRef: "adapter:test-fixture",
    ...overrides,
  };
}
