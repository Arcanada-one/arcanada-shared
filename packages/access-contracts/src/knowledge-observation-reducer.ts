/**
 * Pure observation reducer and deterministic projection for `knowledge-collective-observation/v1`.
 *
 * `reduceKnowledgeObservation(state, input)` returns `{ state, commands, outcome }`. `commands` is always the empty tuple
 * in live, replay and fixture modes: this module performs no I/O and reads no clock (time arrives as `at`). Trusted
 * view binding, authorization, revocation, epoch resets and replay-interval coverage are premises supplied by the
 * external read adapter that verified them; nothing in a record payload can grant them.
 */
import {
  LOSSLESS_DECIMAL_EXTENSION,
  canonicalJson,
  compareDecimal,
  decodeObservationRecord,
  evaluateAcceptance,
  isCanonicalDecimal,
  nextDecimal,
  observeProducerBuild,
  parseKnowledgeObservationJson,
  PRODUCER_BUILD_NOT_MEASURED,
  type AcceptanceEvaluation,
  type AcceptancePolicy,
  type ArtifactRecord,
  type AttemptRecord,
  type CommandRecord,
  type Crosslink,
  type DeploymentRecord,
  type EventRecord,
  type Graph,
  type GraphKind,
  type GraphNode,
  type NativeState,
  type ObservationMode,
  type ObservationRecord,
  type ProducerBuildObservation,
  type QualifiedRef,
  type RunRecord,
  type SnapshotRecord,
  type ViewContext,
} from "./knowledge-observation-v1.js";
import { sha256Hex } from "./knowledge-observation-sha256.js";

const deepClone = <T>(value: T): T => structuredClone(value);

/* ------------------------------------------------------------------------------------------------------------------
 * Pure reducer. reduce(state, input) -> { state, commands, outcome }. It performs no I/O, reads no clock (time arrives as
 * `at` in the input) and returns a fresh state. `commands` is the empty tuple in live, replay and fixture modes: the
 * reducer observes; any reconciliation read or user control belongs to a separate, separately authorized adapter.
 * ---------------------------------------------------------------------------------------------------------------- */

export type Projection =
  | "unbound"
  | "awaiting_snapshot"
  | "current"
  | "reconciling"
  | "cleared";

export type HoldCode =
  | "INVALID_FRAME"
  | "PAGE_ASSEMBLY_INVALID"
  | "PAGE_ASSEMBLY_LIMIT_EXCEEDED"
  | "PAGE_SET_UNPROVEN"
  | "PAGE_SET_MISMATCH"
  | "GAP"
  | "IDENTITY_BODY_CONFLICT"
  | "CURSOR_BINDING_CONFLICT"
  | "BUFFER_LIMIT_EXCEEDED"
  | "BUFFER_EXPIRED"
  | "SCHEMA_INVALID"
  | "UNSUPPORTED_PROFILE"
  | "UNSUPPORTED_RECORD_KIND"
  | "UNSUPPORTED_REQUIRED_EXTENSION"
  | "NOT_AN_OBJECT"
  | "MALFORMED_JSON"
  | "UNTRUSTED_EPOCH_CHANGE"
  | "SNAPSHOT_CONTRADICTION"
  | "RESET_NOT_AUTHORIZED"
  | "RETENTION_LIMIT_EXCEEDED";

export interface BufferLimits {
  readonly maxRecords: number;
  readonly maxSerializedBytes: number;
  readonly maxAgeMs: number;
  /** Upper bound on pages held while a partial snapshot is being assembled. */
  readonly maxPages: number;
  /** Lifetime budget: event identities (and their cursor bindings) retained for duplicate/conflict detection. */
  readonly maxRetainedIdentities: number;
  /** Lifetime budget: canonical bytes of retained event identities plus retained ancillary records. */
  readonly maxRetainedBytes: number;
  /** Lifetime budget: ancillary records (attempt/artifact/command/deployment) retained. */
  readonly maxAncillaryRecords: number;
}

export const DEFAULT_BUFFER_LIMITS: BufferLimits = {
  maxRecords: 256,
  maxSerializedBytes: 1_048_576,
  maxAgeMs: 30_000,
  maxPages: 64,
  maxRetainedIdentities: 4096,
  maxRetainedBytes: 8_388_608,
  maxAncillaryRecords: 1024,
};
const MAX_DIAGNOSTICS = 256;
const MAX_HISTORY = 512;

interface BufferEntry {
  readonly recordId: string;
  readonly cursor: string;
  readonly identity: string;
  readonly receivedAt: number;
  readonly bytes: number;
  readonly record: EventRecord;
}

interface HistoryEntry {
  readonly kind: "native_state_observed" | "node_absent" | "record_withdrawn";
  readonly nodeKey: string;
  readonly value: string | null;
  readonly cursor: string | null;
  readonly sourceRecordId: string;
}

export interface EventLedgerEntry {
  readonly eventId: string;
  readonly recordId: string;
  readonly cursor: string;
  readonly producer: {
    readonly service: string;
    readonly instanceId: string;
    readonly producerEventId: string;
  };
  readonly sourceSequence: {
    readonly value: string | null;
    readonly scope: string;
    readonly scopeId: string;
    readonly partitionId: string | null;
    readonly contiguity: string;
  };
  readonly causationRef: string | null;
  readonly correlationRef: string | null;
  readonly planRevision: string | null;
  /** Producer time, view-side observation time and storage time stay separate and unnormalised. */
  readonly occurredAt: string;
  readonly observedAt: string;
  readonly recordedAt: string;
  /**
   * Optional and additive: the build the producer declared for this event. Absent on state retained before this field
   * existed; `projectView` presents absence as NOT_MEASURED and never infers it. It is not part of event identity or
   * of any existing digest input.
   */
  readonly producerBuild?: ProducerBuildObservation;
}

interface PageEntry {
  readonly index: number;
  readonly sha256: string;
  readonly byteSize: number;
  readonly record: SnapshotRecord;
}

interface PageAssembly {
  readonly watermark: string;
  readonly trustedSnapshotRef: string;
  readonly planRevision: string | null;
  readonly declaredKinds: string;
  /** Immutable page-set identity named by every page; proven only by a trusted adapter manifest. */
  readonly pageSetRef: string;
  readonly pageCount: number;
  /** Pages by canonical ordinal, each with its exact canonical digest and byte size. */
  readonly pages: readonly PageEntry[];
  readonly bytes: number;
  readonly firstAt: number;
}

/**
 * Sealed, ordered page-set manifest. It is supplied ONLY through the trusted `trusted_page_set_manifest` input by the
 * external read adapter that verified it against the producer; nothing in a page payload can grant it. A page set
 * becomes a current view only when every page 0..pageCount-1 is present exactly once and each page's canonical digest
 * and byte size equal the manifest entry (see `snapshotPageDigest`).
 */
export interface PageSetManifest {
  readonly pageSetRef: string;
  readonly viewContext: ViewContext;
  readonly trustedSnapshotRef: string;
  readonly watermark: string;
  readonly planRevision: string | null;
  readonly pageCount: number;
  readonly pages: readonly {
    readonly pageIndex: number;
    readonly sha256: string;
    readonly byteSize: number;
  }[];
  readonly totalBytes: number;
  readonly adapterRef: string;
}

const MAX_MANIFESTS = 8;
const SHA256_RE = /^[0-9a-f]{64}$/;

/** Canonical digest of one decoded snapshot page. Adapters use this same function to seal a manifest. */
export function snapshotPageDigest(
  page: unknown,
): { readonly sha256: string; readonly byteSize: number } | null {
  const decoded = decodeObservationRecord(page, {
    supportedExtensions: [LOSSLESS_DECIMAL_EXTENSION],
  });
  if (!decoded.ok || decoded.record.record_type !== "snapshot") return null;
  const canon = canonicalJson(decoded.record);
  return { sha256: sha256Hex(canon), byteSize: byteLength(canon) };
}

interface Diagnostic {
  readonly recordId: string | null;
  readonly code: string;
}

interface AttemptEntry {
  readonly record: AttemptRecord;
  readonly evaluation: AcceptanceEvaluation;
  readonly semanticConflict: boolean;
  readonly joinedByEvent: boolean;
}

export interface ReducerState {
  readonly schema: "observation-reducer-state/v1";
  readonly mode: ObservationMode;
  readonly extensions: readonly string[];
  readonly limits: BufferLimits;
  readonly binding: ViewContext | null;
  /** Opaque adapter-supplied principal/session reference the binding was authorized for (null when none supplied). */
  readonly bindingSession: string | null;
  /** Applied-event identities dropped by a compaction boundary; keeps `uniqueSourceEventsApplied` truthful. */
  readonly appliedEventsCompacted: number;
  readonly projection: Projection;
  readonly appliedCursor: string | null;
  readonly holds: readonly HoldCode[];
  readonly fullSnapshotRequired: boolean;
  readonly currentPlan: string | null;
  readonly planHistory: readonly string[];
  readonly view: StoredView | null;
  readonly buffer: readonly BufferEntry[];
  readonly eventIdentities: Readonly<
    Record<
      string,
      {
        readonly canon: string;
        readonly cursor: string;
        readonly status: "applied" | "buffered" | "covered";
      }
    >
  >;
  readonly cursorBindings: Readonly<Record<string, string>>;
  readonly rejected: readonly Diagnostic[];
  readonly quarantined: readonly Diagnostic[];
  readonly ignored: readonly Diagnostic[];
  readonly historicalOnly: readonly string[];
  readonly history: readonly HistoryEntry[];
  readonly snapshotHistory: readonly {
    readonly recordId: string;
    readonly watermark: string;
    readonly disposition: string;
  }[];
  readonly partialPages: number;
  readonly bindingDenials: number;
  readonly run: RunRecord["data"] | null;
  /** Transport connection. A disconnect freezes the last observation and marks it stale; it says nothing about workers. */
  readonly connection: "connected" | "disconnected" | "unconnected";
  readonly sawFixture: boolean;
  readonly sourceReconcile: readonly string[];
  readonly sourceSequences: readonly {
    readonly eventId: string;
    readonly scope: string;
    readonly scopeId: string;
    readonly value: string | null;
    readonly contiguity: string;
  }[];
  readonly unassociatedSubjects: readonly string[];
  readonly refusals: readonly {
    readonly recordId: string;
    readonly service: string;
    readonly state: string | null;
  }[];
  readonly eventLog: readonly string[];
  /** Applied events with producer-local sequence, causation and the three distinct times, verbatim (bounded). */
  readonly eventLedger: readonly EventLedgerEntry[];
  /** Pending partial-snapshot pages, bounded; never a current view until a declared-final page completes them. */
  readonly pages: PageAssembly | null;
  /** Trusted sealed manifests by page-set ref (bounded). Present only via the trusted input, never from a payload. */
  readonly pageSetManifests: Readonly<Record<string, PageSetManifest>>;
  readonly trustedReset: {
    readonly previousEpoch: string;
    readonly ref: string;
  } | null;
  readonly ancillary: {
    readonly seen: Readonly<Record<string, string>>;
    readonly attempts: Readonly<Record<string, AttemptEntry>>;
    readonly artifacts: Readonly<Record<string, ArtifactRecord>>;
    readonly commands: Readonly<Record<string, CommandRecord>>;
    readonly deployments: Readonly<Record<string, DeploymentRecord>>;
    readonly joined: readonly string[];
  };
  /** Always empty. Present so consumers and tests can assert the zero-command invariant on the state itself. */
  readonly commands: readonly never[];
}

interface StoredView {
  readonly snapshotRecordId: string;
  readonly watermark: string;
  readonly planRevision: string | null;
  readonly sourceAtomicity: string;
  readonly declaredGraphKinds: readonly GraphKind[];
  readonly nativeState: NativeState | null;
  readonly acceptance: AcceptanceEvaluation;
  /** Raw source projection data kept so a same-watermark snapshot can be compared against the COMPLETE projection. */
  readonly acceptanceRecord: SnapshotRecord["data"]["acceptance"];
  readonly sourceRevisions: readonly unknown[];
  readonly allowedActions: readonly unknown[];
  readonly atomicityEvidenceRef: string | null;
  readonly graphs: readonly Graph[];
  readonly crosslinks: readonly Crosslink[];
  readonly withdrawn: readonly string[];
}

export type ReducerInput =
  | { readonly kind: "set_mode"; readonly mode: ObservationMode }
  | {
      readonly kind: "set_buffer_limits";
      readonly limits: Partial<BufferLimits>;
    }
  | {
      readonly kind: "bind_trusted_projection";
      readonly viewContext: ViewContext;
      /**
       * Opaque reference to the authenticated principal/session the adapter authorized this view for. The wire tuple has
       * no principal field, so an adapter that can change principal behind an unchanged tuple MUST supply it; a change
       * (including unset <-> set) is treated like a changed binding.
       */
      readonly sessionRef?: string;
    }
  | { readonly kind: "receive"; readonly record: unknown; readonly at?: number }
  | {
      readonly kind: "trusted_replay_interval";
      readonly fromCursor: string;
      readonly throughCursor: string;
      readonly records: readonly unknown[];
      readonly coverageRef: string;
      readonly at?: number;
    }
  | {
      readonly kind: "trusted_page_set_manifest";
      readonly manifest: PageSetManifest;
      readonly at?: number;
    }
  | {
      readonly kind: "trusted_epoch_reset";
      readonly oldViewContext: ViewContext;
      readonly newViewContext: ViewContext;
      readonly authorizationObservationRef: string;
    }
  | {
      readonly kind: "trusted_authorization_revoked";
      readonly viewContext: ViewContext;
    }
  | {
      readonly kind: "evaluate_acceptance";
      readonly recordId: string;
      readonly policy: AcceptancePolicy;
    }
  | { readonly kind: "transport_connected" }
  | { readonly kind: "transport_disconnected" }
  | { readonly kind: "tick"; readonly at: number };

export type Disposition =
  | "applied"
  | "buffered"
  | "ignored"
  | "rejected"
  | "quarantined"
  | "historical"
  | "stored"
  | "state_changed";

export interface ReduceOutcome {
  readonly disposition: Disposition;
  readonly code: string | null;
}

export interface ReduceResult {
  readonly state: ReducerState;
  /** Always the empty tuple. */
  readonly commands: readonly never[];
  readonly outcome: ReduceOutcome;
}

export interface ReducerOptions {
  readonly mode?: ObservationMode;
  readonly extensions?: readonly string[];
  readonly limits?: Partial<BufferLimits>;
}

export function createReducerState(options: ReducerOptions = {}): ReducerState {
  return {
    schema: "observation-reducer-state/v1",
    mode: options.mode ?? "live",
    extensions: options.extensions ?? [LOSSLESS_DECIMAL_EXTENSION],
    limits: { ...DEFAULT_BUFFER_LIMITS, ...options.limits },
    binding: null,
    bindingSession: null,
    appliedEventsCompacted: 0,
    projection: "unbound",
    appliedCursor: null,
    holds: [],
    fullSnapshotRequired: false,
    currentPlan: null,
    planHistory: [],
    view: null,
    buffer: [],
    eventIdentities: {},
    cursorBindings: {},
    rejected: [],
    quarantined: [],
    ignored: [],
    historicalOnly: [],
    history: [],
    snapshotHistory: [],
    partialPages: 0,
    bindingDenials: 0,
    run: null,
    connection: "unconnected",
    sawFixture: false,
    sourceReconcile: [],
    sourceSequences: [],
    unassociatedSubjects: [],
    refusals: [],
    eventLog: [],
    eventLedger: [],
    pages: null,
    pageSetManifests: {},
    trustedReset: null,
    ancillary: {
      seen: {},
      attempts: {},
      artifacts: {},
      commands: {},
      deployments: {},
      joined: [],
    },
    commands: [],
  };
}

/* ------------------------------------------------------------------------------------------------------------------ */

type MutableState = { -readonly [K in keyof ReducerState]: ReducerState[K] } & {
  holds: HoldCode[];
  buffer: BufferEntry[];
  rejected: Diagnostic[];
  quarantined: Diagnostic[];
  ignored: Diagnostic[];
  history: HistoryEntry[];
};

export function nodeKey(ref: QualifiedRef): string {
  return JSON.stringify([
    ref.graph_kind,
    ref.authority,
    ref.namespace,
    ref.local_id,
    ref.revision,
  ]);
}

function sameContext(a: ViewContext, b: ViewContext): boolean {
  return (
    a.project_id === b.project_id &&
    a.run_id === b.run_id &&
    a.authorized_view_scope === b.authorized_view_scope &&
    a.stream_epoch === b.stream_epoch
  );
}

function push<T>(list: T[], item: T): void {
  list.push(item);
  if (list.length > MAX_DIAGNOSTICS) list.shift();
}

function eventIdentity(rec: EventRecord): string {
  return JSON.stringify([
    rec.producer.service,
    rec.producer.instance_id,
    rec.data.producer_event_id,
  ]);
}

/** The decoder has already validated `producer.build` against the pinned schema; a failure here is not reachable. */
function declaredProducerBuild(rec: EventRecord): ProducerBuildObservation {
  const r = observeProducerBuild(rec.producer.build);
  return r.ok ? r.build : PRODUCER_BUILD_NOT_MEASURED;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function addHold(s: MutableState, code: HoldCode): void {
  if (!s.holds.includes(code)) s.holds.push(code);
}

function addHistory(s: MutableState, entry: HistoryEntry): void {
  s.history.push(entry);
  if (s.history.length > MAX_HISTORY) s.history.shift();
}

function findNode(
  s: MutableState,
  ref: QualifiedRef,
): { graph: Graph; index: number } | null {
  if (s.view === null) return null;
  const key = nodeKey(ref);
  for (const graph of s.view.graphs) {
    if (graph.graph_kind !== ref.graph_kind) continue;
    const index = graph.nodes.findIndex((n) => nodeKey(n.ref) === key);
    if (index >= 0) return { graph, index };
  }
  return null;
}

function setNode(
  s: MutableState,
  ref: QualifiedRef,
  patch: {
    native_state?: NativeState | null;
    native_versions?: Readonly<Record<string, string>>;
  },
): boolean {
  const found = findNode(s, ref);
  if (found === null || s.view === null) return false;
  const node = found.graph.nodes[found.index];
  if (node === undefined) return false;
  const updated = { ...node, ...patch };
  const nodes = found.graph.nodes.map((n, i) =>
    i === found.index ? updated : n,
  );
  const graphs = s.view.graphs.map((g) =>
    g === found.graph ? { ...g, nodes } : g,
  );
  s.view = { ...s.view, graphs };
  return true;
}

/* -- event application ---------------------------------------------------------------------------------------------- */

function applyEvent(
  s: MutableState,
  rec: EventRecord,
): "applied" | "historical" {
  const d = rec.data;
  s.appliedCursor = d.cursor;
  const id = eventIdentity(rec);
  const known = s.eventIdentities[id];
  s.eventIdentities = {
    ...s.eventIdentities,
    [id]: {
      canon: known?.canon ?? canonicalJson(rec),
      cursor: d.cursor,
      status: "applied",
    },
  };
  s.eventLog = [...s.eventLog, d.event_id].slice(-MAX_HISTORY);
  s.eventLedger = [
    ...s.eventLedger,
    {
      eventId: d.event_id,
      recordId: rec.record_id,
      cursor: d.cursor,
      producer: {
        service: rec.producer.service,
        instanceId: rec.producer.instance_id,
        producerEventId: d.producer_event_id,
      },
      sourceSequence: {
        value: d.source_sequence.value,
        scope: d.source_sequence.scope,
        scopeId: d.source_sequence.scope_id,
        partitionId: d.source_sequence.partition_id,
        contiguity: d.source_sequence.contiguity,
      },
      causationRef: d.causation_ref,
      correlationRef: d.correlation_ref,
      planRevision: d.plan_revision,
      occurredAt: d.occurred_at,
      observedAt: rec.observed_at,
      recordedAt: rec.recorded_at,
      producerBuild: declaredProducerBuild(rec),
    },
  ].slice(-MAX_HISTORY);
  trackSourceSequence(s, rec);
  s.sourceSequences = [
    ...s.sourceSequences,
    {
      eventId: d.event_id,
      scope: d.source_sequence.scope,
      scopeId: d.source_sequence.scope_id,
      value: d.source_sequence.value,
      contiguity: d.source_sequence.contiguity,
    },
  ].slice(-MAX_HISTORY);
  for (const related of d.related_record_ids) {
    if (!s.ancillary.joined.includes(related))
      s.ancillary = {
        ...s.ancillary,
        joined: [...s.ancillary.joined, related].slice(-MAX_HISTORY),
      };
  }
  if (d.kind === "plan_observed" && d.plan_revision !== null) {
    if (s.currentPlan !== null && s.currentPlan !== d.plan_revision)
      s.planHistory = [...s.planHistory, s.currentPlan].slice(-MAX_HISTORY);
    s.currentPlan = d.plan_revision;
    return "applied";
  }
  if (
    d.plan_revision !== null &&
    s.currentPlan !== null &&
    d.plan_revision !== s.currentPlan
  ) {
    // Superseded plan: retained as historical evidence; the transport cursor may advance, current nodes may not.
    s.historicalOnly = [...s.historicalOnly, d.event_id].slice(-MAX_HISTORY);
    return "historical";
  }
  if (d.kind === "native_state_observed") {
    for (const ref of d.subject_refs) {
      if (
        setNode(s, ref, {
          native_state: d.native_state,
          native_versions: d.native_versions,
        })
      ) {
        addHistory(s, {
          kind: "native_state_observed",
          nodeKey: nodeKey(ref),
          value: d.native_state?.value ?? null,
          cursor: d.cursor,
          sourceRecordId: rec.record_id,
        });
      } else {
        const k = nodeKey(ref);
        if (!s.unassociatedSubjects.includes(k))
          s.unassociatedSubjects = [...s.unassociatedSubjects, k].slice(
            -MAX_HISTORY,
          );
      }
    }
  } else if (d.kind === "record_withdrawn") {
    // Absence applies only to the exact source record covered by the read evidence. Correlated chains stay.
    for (const ref of d.subject_refs) {
      const found = findNode(s, ref);
      const prior =
        found?.graph.nodes[found.index]?.native_state?.value ?? null;
      if (found !== null && s.view !== null) {
        const graphs = s.view.graphs.map((g) =>
          g === found.graph
            ? { ...g, nodes: g.nodes.filter((_, i) => i !== found.index) }
            : g,
        );
        s.view = {
          ...s.view,
          graphs,
          withdrawn: [...s.view.withdrawn, nodeKey(ref)],
        };
      }
      addHistory(s, {
        kind: "record_withdrawn",
        nodeKey: nodeKey(ref),
        value: prior,
        cursor: d.cursor,
        sourceRecordId: rec.record_id,
      });
    }
  } else if (d.kind === "refusal_observed") {
    // An ARAS refusal is an ARAS execution observation. It never overwrites a Muneral task state.
    s.refusals = [
      ...s.refusals,
      {
        recordId: rec.record_id,
        service: rec.producer.service,
        state: d.native_state?.value ?? null,
      },
    ].slice(-MAX_HISTORY);
  }
  return "applied";
}

function trackSourceSequence(s: MutableState, rec: EventRecord): void {
  const q = rec.data.source_sequence;
  if (
    q.value === null ||
    q.contiguity !== "declared_contiguous" ||
    !isCanonicalDecimal(q.value)
  )
    return;
  const key = JSON.stringify([
    rec.producer.service,
    rec.producer.instance_id,
    q.scope,
    q.scope_id,
    q.partition_id,
  ]);
  const marker = `${key}#${q.value}`;
  const prev = [...s.sourceReconcile]
    .reverse()
    .find((m) => m.startsWith(`${key}#last:`));
  if (prev !== undefined) {
    const last = prev.slice(key.length + "#last:".length);
    if (compareDecimal(q.value, nextDecimal(last)) > 0)
      s.sourceReconcile = [...s.sourceReconcile, `${marker}:gap`];
  }
  s.sourceReconcile = [
    ...s.sourceReconcile.filter((m) => !m.startsWith(`${key}#last:`)),
    `${key}#last:${q.value}`,
  ].slice(-MAX_HISTORY);
}

function settle(s: MutableState): void {
  if (s.appliedCursor !== null) {
    // Entries covered by the applied watermark are history, not pending work.
    const covered = s.buffer.filter(
      (b) => compareDecimal(b.cursor, s.appliedCursor as string) <= 0,
    );
    for (const c of covered) markIdentity(s, c.identity, "covered");
    s.buffer = s.buffer.filter(
      (b) => compareDecimal(b.cursor, s.appliedCursor as string) > 0,
    );
    s.buffer.sort((a, b) => compareDecimal(a.cursor, b.cursor));
    while (s.holds.length === 0) {
      const next = s.buffer[0];
      if (next === undefined || next.cursor !== nextDecimal(s.appliedCursor))
        break;
      s.buffer.shift();
      applyEvent(s, next.record);
    }
    if (s.buffer.length > 0 && s.holds.length === 0) addHold(s, "GAP");
  }
  if (s.binding === null)
    s.projection = s.projection === "cleared" ? "cleared" : "unbound";
  else if (s.appliedCursor === null) s.projection = "awaiting_snapshot";
  else s.projection = s.holds.length > 0 ? "reconciling" : "current";
}

function markIdentity(
  s: MutableState,
  id: string,
  status: "applied" | "buffered" | "covered",
): void {
  const known = s.eventIdentities[id];
  if (known !== undefined)
    s.eventIdentities = { ...s.eventIdentities, [id]: { ...known, status } };
}

/* -- record handling ------------------------------------------------------------------------------------------------ */

function reject(
  s: MutableState,
  recordId: string | null,
  code: string,
): ReduceOutcome {
  push(s.rejected, { recordId, code });
  return { disposition: "rejected", code };
}

function overflowCheck(s: MutableState, at: number | undefined): boolean {
  const bytes = s.buffer.reduce((n, b) => n + b.bytes, 0);
  const oldest = s.buffer.reduce(
    (m, b) => Math.min(m, b.receivedAt),
    Number.POSITIVE_INFINITY,
  );
  const overCount = s.buffer.length > s.limits.maxRecords;
  const overBytes = bytes > s.limits.maxSerializedBytes;
  const overAge =
    at !== undefined &&
    Number.isFinite(oldest) &&
    at - oldest > s.limits.maxAgeMs;
  if (!overCount && !overBytes && !overAge) return false;
  for (const b of s.buffer) markIdentity(s, b.identity, "covered");
  s.buffer = [];
  addHold(
    s,
    overAge && !overCount && !overBytes
      ? "BUFFER_EXPIRED"
      : "BUFFER_LIMIT_EXCEEDED",
  );
  s.fullSnapshotRequired = true;
  return true;
}

/* -- lifetime retention budget (R2) ---------------------------------------------------------------------------------- */

/** Bytes of canonical text retained for duplicate/conflict detection: event identities plus ancillary records. */
function retainedBytes(s: MutableState): number {
  const texts = [
    ...Object.values(s.eventIdentities).map((e) => e.canon),
    ...Object.values(s.ancillary.seen),
  ];
  const units = texts.reduce((n, c) => n + c.length, 0);
  // UTF-8 needs at most three bytes per UTF-16 unit, so only count exactly when the cheap bound could be exceeded.
  if (units * 3 <= s.limits.maxRetainedBytes) return units * 3;
  return texts.reduce((n, c) => n + byteLength(c), 0);
}

/** True when admitting `addIdentities` new identities, `addAncillary` new ancillary records and `addBytes` would pass a budget. */
function retentionBlocked(
  s: MutableState,
  addIdentities: number,
  addAncillary: number,
  addBytes: number,
): boolean {
  return (
    Object.keys(s.eventIdentities).length + addIdentities >
      s.limits.maxRetainedIdentities ||
    Object.keys(s.ancillary.seen).length + addAncillary >
      s.limits.maxAncillaryRecords ||
    retainedBytes(s) + addBytes > s.limits.maxRetainedBytes
  );
}

/**
 * Retention exhausted: refuse the record, keep the last trusted view, and require a trusted full snapshot. Nothing is
 * evicted, so no later record can be accepted as "fresh" against a forgotten identity.
 */
function retentionRefused(
  s: MutableState,
  recordId: string | null,
): ReduceOutcome {
  push(s.quarantined, { recordId, code: "RETENTION_LIMIT_EXCEEDED" });
  addHold(s, "RETENTION_LIMIT_EXCEEDED");
  s.fullSnapshotRequired = true;
  settle(s);
  return { disposition: "quarantined", code: "RETENTION_LIMIT_EXCEEDED" };
}

/**
 * Compaction boundary, run only when a trusted full snapshot recovers a retention-exhausted state. Identities and cursor
 * bindings at or below the snapshot watermark are covered by it (such an event can never be applied again, identical or
 * conflicting), so they are dropped; identities above it are kept, so duplicate/conflict handling continues there.
 * Ancillary catalogs are not carried by snapshots: they are dropped and the read side re-delivers what it authorizes.
 */
function compactRetention(s: MutableState, watermark: string): void {
  const identities: Record<string, (typeof s.eventIdentities)[string]> = {};
  const droppedCursors = new Set<string>();
  for (const [id, e] of Object.entries(s.eventIdentities)) {
    if (compareDecimal(e.cursor, watermark) <= 0) {
      if (e.status === "applied") s.appliedEventsCompacted += 1;
      droppedCursors.add(e.cursor);
    } else identities[id] = e;
  }
  s.eventIdentities = identities;
  s.cursorBindings = Object.fromEntries(
    Object.entries(s.cursorBindings).filter(
      ([cursor]) =>
        !droppedCursors.has(cursor) && compareDecimal(cursor, watermark) > 0,
    ),
  );
  s.ancillary = {
    seen: {},
    attempts: {},
    artifacts: {},
    commands: {},
    deployments: {},
    joined: [],
  };
}

function receiveEvent(
  s: MutableState,
  rec: EventRecord,
  at: number | undefined,
): ReduceOutcome {
  const d = rec.data;
  const id = eventIdentity(rec);
  const canon = canonicalJson(rec);
  const known = s.eventIdentities[id];
  if (known !== undefined) {
    if (known.canon === canon) {
      push(s.ignored, {
        recordId: rec.record_id,
        code: "DUPLICATE_SAME_IDENTITY_AND_BODY",
      });
      return {
        disposition: "ignored",
        code: "DUPLICATE_SAME_IDENTITY_AND_BODY",
      };
    }
    push(s.quarantined, {
      recordId: rec.record_id,
      code: "IDENTITY_BODY_CONFLICT",
    });
    addHold(s, "IDENTITY_BODY_CONFLICT");
    settle(s);
    return { disposition: "quarantined", code: "IDENTITY_BODY_CONFLICT" };
  }
  const boundIdentity = s.cursorBindings[d.cursor];
  if (boundIdentity !== undefined && boundIdentity !== id) {
    push(s.quarantined, {
      recordId: rec.record_id,
      code: "CURSOR_BINDING_CONFLICT",
    });
    addHold(s, "CURSOR_BINDING_CONFLICT");
    settle(s);
    return { disposition: "quarantined", code: "CURSOR_BINDING_CONFLICT" };
  }
  if (retentionBlocked(s, 1, 0, byteLength(canon)))
    return retentionRefused(s, rec.record_id);
  s.cursorBindings = { ...s.cursorBindings, [d.cursor]: id };

  if (
    s.appliedCursor !== null &&
    compareDecimal(d.cursor, s.appliedCursor) <= 0
  ) {
    // Already covered by the applied watermark; nothing to apply and no coverage change.
    s.eventIdentities = {
      ...s.eventIdentities,
      [id]: { canon, cursor: d.cursor, status: "covered" },
    };
    push(s.ignored, { recordId: rec.record_id, code: "COVERED_BY_WATERMARK" });
    return { disposition: "ignored", code: "COVERED_BY_WATERMARK" };
  }

  if (
    s.appliedCursor !== null &&
    s.holds.length === 0 &&
    d.cursor === nextDecimal(s.appliedCursor)
  ) {
    s.eventIdentities = {
      ...s.eventIdentities,
      [id]: { canon, cursor: d.cursor, status: "applied" },
    };
    const result = applyEvent(s, rec);
    settle(s);
    return { disposition: result, code: null };
  }

  // Not the exact next cursor, or coverage is already in doubt: buffer within bounds and freeze at the last trusted state.
  s.eventIdentities = {
    ...s.eventIdentities,
    [id]: { canon, cursor: d.cursor, status: "buffered" },
  };
  s.buffer.push({
    recordId: rec.record_id,
    cursor: d.cursor,
    identity: id,
    receivedAt: at ?? 0,
    bytes: byteLength(canon),
    record: rec,
  });
  if (s.appliedCursor !== null && s.holds.length === 0) addHold(s, "GAP");
  if (overflowCheck(s, at)) {
    settle(s);
    return {
      disposition: "quarantined",
      code: s.holds.includes("BUFFER_EXPIRED")
        ? "BUFFER_EXPIRED"
        : "BUFFER_LIMIT_EXCEEDED",
    };
  }
  settle(s);
  return {
    disposition: "buffered",
    code:
      s.appliedCursor === null
        ? "AWAITING_SNAPSHOT"
        : s.holds.includes("GAP")
          ? "GAP"
          : null,
  };
}

/** The complete authorized projection, normalised for comparison. Capture metadata (record id, producer build, capture and
 * storage times, trusted snapshot ref, paging fields) is deliberately excluded; everything a viewer could be shown is in. */
interface ProjectionParts {
  readonly plan: string | null;
  readonly nativeState: NativeState | null;
  readonly acceptance: unknown;
  readonly sourceAtomicity: string;
  readonly atomicityEvidenceRef: string | null;
  readonly declaredGraphKinds: readonly GraphKind[];
  readonly sourceRevisions: readonly unknown[];
  readonly allowedActions: readonly unknown[];
  readonly graphs: readonly Graph[];
  readonly crosslinks: readonly Crosslink[];
}

function sortedBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function completeProjectionCanon(p: ProjectionParts): string {
  return canonicalJson({
    plan: p.plan,
    native_state: p.nativeState,
    acceptance: p.acceptance,
    source_atomicity: p.sourceAtomicity,
    atomicity_evidence_ref: p.atomicityEvidenceRef,
    declared_graph_kinds: [...p.declaredGraphKinds].sort(),
    source_revisions: sortedBy(p.sourceRevisions, canonicalJson),
    allowed_actions: sortedBy(p.allowedActions, canonicalJson),
    graphs: sortedBy(
      p.graphs,
      (g) => `${g.graph_kind}\u0000${g.authority}`,
    ).map((g) => ({
      graph_kind: g.graph_kind,
      authority: g.authority,
      graph_revision: g.graph_revision,
      nodes: sortedBy(g.nodes, (n) => nodeKey(n.ref)),
      edges: sortedBy(g.edges, (e) => e.edge_id),
    })),
    crosslinks: sortedBy(p.crosslinks, (l) => l.link_id),
  });
}

function snapshotProjectionParts(d: SnapshotRecord["data"]): ProjectionParts {
  return {
    plan: d.plan_revision,
    nativeState: d.native_state,
    acceptance: d.acceptance,
    sourceAtomicity: d.source_atomicity,
    atomicityEvidenceRef:
      (d as { atomicity_evidence_ref?: string | null })
        .atomicity_evidence_ref ?? null,
    declaredGraphKinds: d.coverage.declared_graph_kinds,
    sourceRevisions: d.source_revisions,
    allowedActions: d.allowed_actions_observation,
    graphs: d.graphs,
    crosslinks: d.crosslinks,
  };
}

/**
 * Same-watermark equality compares the COMPLETE normalised projection: plan, native state, acceptance, source
 * revisions and atomicity, allowed actions, graph kinds, and node, edge and crosslink membership with their contents.
 * Anything not proven equal is a contradiction (the caller quarantines it); there is no partial-overlap shortcut.
 */
function snapshotConsistent(s: MutableState, snap: SnapshotRecord): boolean {
  const v = s.view;
  if (v === null) return true;
  const current = completeProjectionCanon({
    plan: s.currentPlan,
    nativeState: v.nativeState,
    acceptance: v.acceptanceRecord,
    sourceAtomicity: v.sourceAtomicity,
    atomicityEvidenceRef: v.atomicityEvidenceRef,
    declaredGraphKinds: v.declaredGraphKinds,
    sourceRevisions: v.sourceRevisions,
    allowedActions: v.allowedActions,
    graphs: v.graphs,
    crosslinks: v.crosslinks,
  });
  return (
    current === completeProjectionCanon(snapshotProjectionParts(snap.data))
  );
}

function installSnapshot(s: MutableState, snap: SnapshotRecord): void {
  const d = snap.data;
  if (s.holds.includes("RETENTION_LIMIT_EXCEEDED"))
    compactRetention(s, d.watermark);
  if (s.view !== null) {
    const incoming = new Set(
      d.graphs.flatMap((g) => g.nodes.map((n) => nodeKey(n.ref))),
    );
    for (const g of s.view.graphs) {
      for (const n of g.nodes) {
        const k = nodeKey(n.ref);
        if (!incoming.has(k))
          addHistory(s, {
            kind: "node_absent",
            nodeKey: k,
            value: n.native_state?.value ?? null,
            cursor: d.watermark,
            sourceRecordId: snap.record_id,
          });
      }
    }
  }
  for (const g of d.graphs) {
    for (const n of g.nodes) {
      addHistory(s, {
        kind: "native_state_observed",
        nodeKey: nodeKey(n.ref),
        value: n.native_state?.value ?? null,
        cursor: d.watermark,
        sourceRecordId: snap.record_id,
      });
    }
  }
  if (s.currentPlan !== null && s.currentPlan !== d.plan_revision)
    s.planHistory = [...s.planHistory, s.currentPlan].slice(-MAX_HISTORY);
  s.currentPlan = d.plan_revision;
  s.view = {
    snapshotRecordId: snap.record_id,
    watermark: d.watermark,
    planRevision: d.plan_revision,
    sourceAtomicity: d.source_atomicity,
    declaredGraphKinds: d.coverage.declared_graph_kinds,
    nativeState: d.native_state,
    acceptance: evaluateAcceptance(d.acceptance),
    acceptanceRecord: deepClone(d.acceptance),
    sourceRevisions: deepClone(d.source_revisions),
    allowedActions: deepClone(d.allowed_actions_observation),
    atomicityEvidenceRef:
      (d as { atomicity_evidence_ref?: string | null })
        .atomicity_evidence_ref ?? null,
    graphs: deepClone(d.graphs),
    crosslinks: deepClone(d.crosslinks),
    withdrawn: [],
  };
  s.appliedCursor = d.watermark;
  s.holds = [];
  s.fullSnapshotRequired = false;
  s.trustedReset = null;
  s.pages = null;
}

function discardPages(s: MutableState, code: HoldCode): ReduceOutcome {
  s.pages = null;
  if (s.appliedCursor !== null) addHold(s, code);
  s.fullSnapshotRequired = true;
  settle(s);
  push(s.rejected, { recordId: null, code });
  return { disposition: "rejected", code };
}

/** Union of pages that all describe one watermark; null when pages disagree or a declared graph kind is missing. */
function mergePages(pages: readonly SnapshotRecord[]): SnapshotRecord | null {
  const last = pages[pages.length - 1];
  if (last === undefined) return null;
  const first = pages[0] as SnapshotRecord;
  const sameTop = (pick: (p: SnapshotRecord) => unknown): boolean =>
    pages.every((p) => canonicalJson(pick(p)) === canonicalJson(pick(first)));
  if (
    !sameTop((p) => p.producer) ||
    !sameTop((p) => p.view_context) ||
    !sameTop((p) => p.data.native_state) ||
    !sameTop((p) => p.data.acceptance) ||
    !sameTop((p) => p.data.source_atomicity) ||
    !sameTop((p) => p.data.reset) ||
    !sameTop((p) => p.data.allowed_actions_observation) ||
    !sameTop((p) => p.data.source_revisions) ||
    !sameTop((p) => p.data.coverage.declared_graph_kinds)
  ) {
    return null;
  }
  const kinds = last.data.coverage.declared_graph_kinds;
  const graphs: Graph[] = [];
  for (const kind of kinds) {
    const present = pages.flatMap((p) =>
      p.data.graphs.filter((g) => g.graph_kind === kind),
    );
    const head = present[0];
    if (head === undefined) return null; // a declared graph kind never arrived: not complete
    if (
      present.some(
        (g) =>
          g.authority !== head.authority ||
          g.graph_revision !== head.graph_revision,
      )
    )
      return null;
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, Graph["edges"][number]>();
    for (const g of present) {
      for (const n of g.nodes) {
        const k = nodeKey(n.ref);
        const prior = nodes.get(k);
        if (prior !== undefined && canonicalJson(prior) !== canonicalJson(n))
          return null;
        nodes.set(k, n);
      }
      for (const e of g.edges) {
        const prior = edges.get(e.edge_id);
        if (prior !== undefined && canonicalJson(prior) !== canonicalJson(e))
          return null;
        edges.set(e.edge_id, e);
      }
    }
    graphs.push({
      graph_kind: kind,
      authority: head.authority,
      graph_revision: head.graph_revision,
      nodes: [...nodes.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([, v]) => v),
      edges: [...edges.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([, v]) => v),
    });
  }
  const links = new Map<string, Crosslink>();
  for (const p of pages) {
    for (const l of p.data.crosslinks) {
      const prior = links.get(l.link_id);
      if (prior !== undefined && canonicalJson(prior) !== canonicalJson(l))
        return null;
      links.set(l.link_id, l);
    }
  }
  const merged: SnapshotRecord = {
    ...last,
    record_id: `${last.record_id}.assembled`,
    data: {
      ...last.data,
      snapshot_kind: "full",
      coverage: (() => {
        const { page_set: _pageSet, ...rest } = last.data.coverage;
        void _pageSet;
        return { ...rest, complete: true, next_page_token: null };
      })(),
      graphs,
      crosslinks: [...links.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([, v]) => v),
    },
  };
  // The assembled snapshot must itself be a valid v1 full snapshot, otherwise it is not installed.
  return decodeObservationRecord(merged, {
    supportedExtensions: [LOSSLESS_DECIMAL_EXTENSION],
  }).ok
    ? merged
    : null;
}

const NON_INTERVAL_RECOVERABLE = (h: HoldCode): boolean =>
  h !== "GAP" && h !== "PAGE_SET_UNPROVEN";

function manifestFor(s: MutableState, ref: string): PageSetManifest | null {
  return s.pageSetManifests[ref] ?? null;
}

/** True when a page (or a whole assembly entry) disagrees with the sealed manifest: foreign, altered or miscounted. */
function pageViolatesManifest(
  m: PageSetManifest,
  a: Pick<
    PageAssembly,
    "watermark" | "trustedSnapshotRef" | "planRevision" | "pageCount"
  >,
  entry: PageEntry,
): boolean {
  const expected = m.pages.find((p) => p.pageIndex === entry.index);
  return (
    m.watermark !== a.watermark ||
    m.trustedSnapshotRef !== a.trustedSnapshotRef ||
    m.planRevision !== a.planRevision ||
    m.pageCount !== a.pageCount ||
    expected === undefined ||
    expected.sha256 !== entry.sha256 ||
    expected.byteSize !== entry.byteSize
  );
}

/**
 * The ONE page-age predicate. A pending assembly is expired when strictly more than `maxAgeMs` separate its first page
 * from `at` (exactly `maxAgeMs` is still live). The reducer reads no clock: without `at` no age can be judged. A trusted
 * manifest never refreshes the age. Every path that could install or extend an assembly (page, manifest, tick, and
 * completion itself) calls this first; an expired assembly is discarded with a hold and a full-snapshot requirement.
 */
function ageExceeded(
  firstAt: number,
  at: number | undefined,
  maxAgeMs: number,
): boolean {
  return at !== undefined && at - firstAt > maxAgeMs;
}

function pagesExpired(s: MutableState, at: number | undefined): boolean {
  return (
    s.pages !== null && ageExceeded(s.pages.firstAt, at, s.limits.maxAgeMs)
  );
}

function expirePages(s: MutableState, at: number | undefined): boolean {
  if (!pagesExpired(s, at)) return false;
  discardPages(s, "PAGE_ASSEMBLY_LIMIT_EXCEEDED");
  return true;
}

/**
 * Complete a pending page set when, and only when, it is PROVEN complete: every ordinal 0..pageCount-1 is present
 * exactly once AND a trusted sealed manifest binds the set (same scope and epoch, snapshot ref, plan, watermark, count)
 * and every page's canonical digest and byte size equal their manifest entries. A declared-final page, a payload flag
 * or the presence of every graph kind is NOT proof. Without proof the set stays pending and nothing becomes current.
 */
function completePageSet(
  s: MutableState,
  at: number | undefined,
): ReduceOutcome | null {
  if (s.pages === null) return null;
  // Final guard: no completion path may install an assembly older than the limit.
  if (expirePages(s, at))
    return { disposition: "rejected", code: "PAGE_ASSEMBLY_LIMIT_EXCEEDED" };
  const a = s.pages;
  if (a === null) return null;
  const lastRecord = a.pages[a.pages.length - 1]?.record;
  const record = (disposition: string): void => {
    s.snapshotHistory = [
      ...s.snapshotHistory,
      {
        recordId: lastRecord?.record_id ?? a.pageSetRef,
        watermark: a.watermark,
        disposition,
      },
    ].slice(-MAX_HISTORY);
  };
  if (a.pages.length < a.pageCount) {
    record("partial_page_pending");
    return { disposition: "ignored", code: "PARTIAL_PAGE_PENDING" };
  }
  const m = manifestFor(s, a.pageSetRef);
  if (m === null) {
    record("page_set_manifest_pending");
    return { disposition: "ignored", code: "PAGE_SET_MANIFEST_PENDING" };
  }
  // The sum of the sealed entries already equals `m.totalBytes` (checked in `validManifest`), and every received page
  // is compared with its own entry, so no separate total comparison can disagree.
  if (a.pages.some((e) => pageViolatesManifest(m, a, e))) {
    record("page_set_manifest_mismatch");
    return discardPages(s, "PAGE_SET_MISMATCH");
  }
  const ordered = [...a.pages]
    .sort((x, y) => x.index - y.index)
    .map((e) => e.record);
  const merged = mergePages(ordered);
  if (merged === null) {
    record("page_assembly_inconsistent");
    return discardPages(s, "PAGE_ASSEMBLY_INVALID");
  }
  s.pages = null;
  record("pages_assembled");
  const outcome = receiveSnapshot(s, merged, at, true);
  return outcome.disposition === "applied"
    ? { disposition: "applied", code: "PAGES_ASSEMBLED" }
    : outcome;
}

/**
 * Bounded assembly of partial snapshot pages under ONE watermark, trusted snapshot ref, plan, declared projection and
 * page-set identity. A page set never moves the watermark or replaces a view until it is proven complete by
 * `completePageSet`. A page carrying no `coverage.page_set` cannot be assembled at all (unproven). Count, byte and age
 * bounds apply while pending. A duplicate ordinal with identical bytes is idempotent; with different bytes it is a
 * conflict; a page the manifest does not recognise is foreign.
 */
function receivePage(
  s: MutableState,
  page: SnapshotRecord,
  at: number | undefined,
  record: (disposition: string) => void,
): ReduceOutcome {
  const d = page.data;
  s.partialPages += 1;
  // A verified contiguous same-view replay interval can still recover a GAP, so a gap alone does not demand a full
  // snapshot. Expiry, overflow, reset, revocation and conflicts already set the flag where they occur.
  if (s.appliedCursor !== null && s.holds.some(NON_INTERVAL_RECOVERABLE))
    s.fullSnapshotRequired = true;
  const set = d.coverage.page_set;
  if (set === undefined) {
    record("page_set_proof_missing");
    push(s.quarantined, {
      recordId: page.record_id,
      code: "PAGE_SET_PROOF_MISSING",
    });
    if (s.appliedCursor !== null) addHold(s, "PAGE_SET_UNPROVEN");
    settle(s);
    return { disposition: "quarantined", code: "PAGE_SET_PROOF_MISSING" };
  }
  const index = Number(set.page_index);
  const count = Number(set.page_count);
  const lastOrdinal = index === count - 1;
  const incoherent =
    // An unsafe `index` is always >= a safe `count`, or `count` is itself unsafe and refused here.
    !Number.isSafeInteger(count) ||
    index >= count ||
    lastOrdinal !== (d.coverage.next_page_token === null) ||
    d.coverage.complete !== lastOrdinal;
  if (incoherent) {
    record("page_ordinal_invalid");
    return discardPages(s, "PAGE_ASSEMBLY_INVALID");
  }
  if (count > s.limits.maxPages) {
    // A set larger than the page bound can never be assembled within it.
    record("page_assembly_limit_exceeded");
    return discardPages(s, "PAGE_ASSEMBLY_LIMIT_EXCEEDED");
  }
  const canon = canonicalJson(page);
  const entry: PageEntry = {
    index,
    sha256: sha256Hex(canon),
    byteSize: byteLength(canon),
    record: page,
  };
  const prior = s.pages;
  const declared = canonicalJson(d.coverage.declared_graph_kinds);
  if (
    prior !== null &&
    (prior.watermark !== d.watermark ||
      prior.trustedSnapshotRef !== d.trusted_snapshot_ref ||
      prior.planRevision !== d.plan_revision ||
      prior.declaredKinds !== declared ||
      prior.pageSetRef !== set.page_set_ref ||
      prior.pageCount !== count)
  ) {
    record("page_assembly_inconsistent");
    return discardPages(s, "PAGE_ASSEMBLY_INVALID");
  }
  const dup = prior?.pages.find((e) => e.index === index);
  if (dup !== undefined) {
    if (dup.sha256 === entry.sha256) {
      record("page_duplicate_identical");
      return { disposition: "ignored", code: "PAGE_DUPLICATE_IDENTICAL" };
    }
    record("page_duplicate_conflict");
    return discardPages(s, "PAGE_ASSEMBLY_INVALID");
  }
  const base = {
    watermark: d.watermark,
    trustedSnapshotRef: d.trusted_snapshot_ref,
    planRevision: d.plan_revision,
    pageCount: count,
  };
  const manifest = manifestFor(s, set.page_set_ref);
  if (manifest !== null && pageViolatesManifest(manifest, base, entry)) {
    record("page_foreign_to_manifest");
    return discardPages(s, "PAGE_SET_MISMATCH");
  }
  const pages = [...(prior?.pages ?? []), entry];
  const bytes = (prior?.bytes ?? 0) + entry.byteSize;
  const firstAt = prior?.firstAt ?? at ?? 0;
  if (
    bytes > s.limits.maxSerializedBytes ||
    ageExceeded(firstAt, at, s.limits.maxAgeMs)
  ) {
    record("page_assembly_limit_exceeded");
    return discardPages(s, "PAGE_ASSEMBLY_LIMIT_EXCEEDED");
  }
  s.pages = {
    ...base,
    declaredKinds: declared,
    pageSetRef: set.page_set_ref,
    pages,
    bytes,
    firstAt,
  };
  const outcome = completePageSet(s, at);
  if (outcome === null) return { disposition: "ignored", code: null };
  // completePageSet already wrote its own history line; drop the pending marker the caller would add twice.
  return outcome;
}

function validManifest(
  s: MutableState,
  m: PageSetManifest,
): m is PageSetManifest {
  if (s.binding === null || typeof m !== "object" || m === null) return false;
  // Runtime shape guards: the manifest may come from an adapter boundary, so nothing nested is trusted to match its type.
  if (typeof m.viewContext !== "object" || m.viewContext === null) return false;
  if (!sameContext(m.viewContext, s.binding)) return false;
  const ref = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
  const isRef = (v: unknown): boolean => typeof v === "string" && ref.test(v);
  if (
    !isRef(m.pageSetRef) ||
    !isRef(m.trustedSnapshotRef) ||
    !isRef(m.adapterRef) ||
    !isCanonicalDecimal(m.watermark) ||
    m.pageCount < 1 ||
    m.pageCount > s.limits.maxPages ||
    !Array.isArray(m.pages) ||
    m.pages.length !== m.pageCount
  )
    return false;
  const seen = new Set<number>();
  let total = 0;
  for (const p of m.pages) {
    if (
      typeof p !== "object" ||
      p === null ||
      !Number.isSafeInteger(p.pageIndex) ||
      p.pageIndex < 0 ||
      p.pageIndex >= m.pageCount ||
      seen.has(p.pageIndex) ||
      typeof p.sha256 !== "string" ||
      !SHA256_RE.test(p.sha256) ||
      !Number.isSafeInteger(p.byteSize) ||
      p.byteSize < 1
    )
      return false;
    seen.add(p.pageIndex);
    total += p.byteSize;
  }
  return total === m.totalBytes;
}

function receivePageSetManifest(
  s: MutableState,
  m: PageSetManifest,
  at: number | undefined,
): ReduceOutcome {
  if (!validManifest(s, m)) return reject(s, null, "INVALID_PAGE_SET_MANIFEST");
  const existing = s.pageSetManifests[m.pageSetRef];
  if (existing !== undefined && canonicalJson(existing) !== canonicalJson(m)) {
    // A sealed set is immutable: a different manifest for the same ref is a conflict, never last-writer-wins.
    push(s.quarantined, { recordId: null, code: "PAGE_SET_MANIFEST_CONFLICT" });
    if (s.appliedCursor !== null) addHold(s, "PAGE_SET_MISMATCH");
    settle(s);
    return { disposition: "quarantined", code: "PAGE_SET_MANIFEST_CONFLICT" };
  }
  const keep = Object.entries({
    ...s.pageSetManifests,
    [m.pageSetRef]: deepClone(m),
  }).slice(-MAX_MANIFESTS);
  s.pageSetManifests = Object.fromEntries(keep);
  if (s.pages !== null && s.pages.pageSetRef === m.pageSetRef) {
    const outcome = completePageSet(s, at);
    if (outcome !== null) return outcome;
  }
  return { disposition: "state_changed", code: null };
}

function receiveSnapshot(
  s: MutableState,
  snap: SnapshotRecord,
  at: number | undefined,
  assembled = false,
): ReduceOutcome {
  const d = snap.data;
  const record = (disposition: string): void => {
    s.snapshotHistory = [
      ...s.snapshotHistory,
      { recordId: snap.record_id, watermark: d.watermark, disposition },
    ].slice(-MAX_HISTORY);
  };
  if (!assembled && (d.snapshot_kind === "partial" || !d.coverage.complete)) {
    return receivePage(s, snap, at, record);
  }
  if (d.reset !== null) {
    if (
      s.trustedReset === null ||
      s.trustedReset.ref !== d.reset.authorization_observation_ref ||
      s.trustedReset.previousEpoch !== d.reset.previous_epoch
    ) {
      addHold(s, "RESET_NOT_AUTHORIZED");
      return reject(s, snap.record_id, "RESET_NOT_AUTHORIZED");
    }
  }
  if (s.appliedCursor !== null) {
    const order = compareDecimal(d.watermark, s.appliedCursor);
    if (order < 0) {
      record("older_history_only");
      push(s.ignored, {
        recordId: snap.record_id,
        code: "OLDER_SNAPSHOT_HISTORY_ONLY",
      });
      return { disposition: "historical", code: "OLDER_SNAPSHOT_HISTORY_ONLY" };
    }
    if (order === 0) {
      if (!snapshotConsistent(s, snap)) {
        record("contradiction_quarantined");
        push(s.quarantined, {
          recordId: snap.record_id,
          code: "SNAPSHOT_CONTRADICTION",
        });
        addHold(s, "SNAPSHOT_CONTRADICTION");
        settle(s);
        return { disposition: "quarantined", code: "SNAPSHOT_CONTRADICTION" };
      }
      // A consistent snapshot at the applied watermark is also a safe compaction boundary, but only when retention
      // exhaustion is the sole reason the state is held.
      if (s.holds.length === 1 && s.holds[0] === "RETENTION_LIMIT_EXCEEDED") {
        installSnapshot(s, snap);
        record("installed_retention_compaction");
        settle(s);
        return { disposition: "applied", code: "RETENTION_COMPACTED" };
      }
      record("same_watermark_consistent");
      return { disposition: "ignored", code: "SAME_WATERMARK_CONSISTENT" };
    }
  }
  installSnapshot(s, snap);
  record("installed");
  settle(s);
  return { disposition: "applied", code: null };
}

function storeAncillary(
  s: MutableState,
  rec: AttemptRecord | ArtifactRecord | CommandRecord | DeploymentRecord,
): ReduceOutcome {
  const canon = canonicalJson(rec);
  const seenKey = `${rec.record_type}:${rec.record_id}`;
  const prior = s.ancillary.seen[seenKey];
  if (prior !== undefined) {
    if (prior === canon) {
      push(s.ignored, { recordId: rec.record_id, code: "DUPLICATE_RECORD" });
      return { disposition: "ignored", code: "DUPLICATE_RECORD" };
    }
    push(s.quarantined, {
      recordId: rec.record_id,
      code: "RECORD_ID_CONFLICT",
    });
    return { disposition: "quarantined", code: "RECORD_ID_CONFLICT" };
  }
  if (retentionBlocked(s, 0, 1, byteLength(canon)))
    return retentionRefused(s, rec.record_id);
  const seen = { ...s.ancillary.seen, [seenKey]: canon };
  switch (rec.record_type) {
    case "attempt": {
      const evaluation = evaluateAcceptance(rec.data.acceptance);
      s.ancillary = {
        ...s.ancillary,
        seen,
        attempts: {
          ...s.ancillary.attempts,
          [rec.record_id]: {
            record: rec,
            evaluation,
            semanticConflict: false,
            joinedByEvent: false,
          },
        },
      };
      break;
    }
    case "artifact":
      s.ancillary = {
        ...s.ancillary,
        seen,
        artifacts: { ...s.ancillary.artifacts, [rec.record_id]: rec },
      };
      break;
    case "command":
      s.ancillary = {
        ...s.ancillary,
        seen,
        commands: { ...s.ancillary.commands, [rec.record_id]: rec },
      };
      break;
    case "deployment":
      s.ancillary = {
        ...s.ancillary,
        seen,
        deployments: { ...s.ancillary.deployments, [rec.record_id]: rec },
      };
      break;
  }
  return { disposition: "stored", code: null };
}

function receive(
  s: MutableState,
  raw: unknown,
  at: number | undefined,
): ReduceOutcome {
  if (at !== undefined) {
    // An age bound can only be enforced when the caller supplies time; the reducer never reads a clock.
    if (s.buffer.length > 0 && overflowCheck(s, at)) settle(s);
  }
  const rawId =
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as { record_id?: unknown }).record_id === "string"
      ? (raw as { record_id: string }).record_id
      : null;
  // Check the trusted view binding before inspecting or exposing record details.
  const claimedContext =
    typeof raw === "object" && raw !== null
      ? (raw as { view_context?: unknown }).view_context
      : undefined;
  if (s.binding === null) {
    return reject(s, null, "NO_TRUSTED_VIEW_BINDING");
  }
  if (typeof claimedContext === "object" && claimedContext !== null) {
    const c = claimedContext as Partial<ViewContext>;
    const full =
      c.project_id !== undefined &&
      c.run_id !== undefined &&
      c.authorized_view_scope !== undefined &&
      c.stream_epoch !== undefined;
    if (full && !sameContext(c as ViewContext, s.binding)) {
      const b = s.binding;
      const onlyEpoch =
        c.project_id === b.project_id &&
        c.run_id === b.run_id &&
        c.authorized_view_scope === b.authorized_view_scope;
      s.bindingDenials += 1;
      if (onlyEpoch) {
        addHold(s, "UNTRUSTED_EPOCH_CHANGE");
        settle(s);
        return { disposition: "rejected", code: "UNTRUSTED_EPOCH_CHANGE" };
      }
      // Opaque denial: nothing of the record (id, existence, payload) is retained.
      return { disposition: "rejected", code: "OPAQUE_VIEW_BINDING_MISMATCH" };
    }
  }

  const decoded =
    raw instanceof Uint8Array
      ? parseKnowledgeObservationJson(raw, {
          supportedExtensions: s.extensions,
        })
      : decodeObservationRecord(raw, { supportedExtensions: s.extensions });
  if (!decoded.ok) {
    if (s.appliedCursor !== null) addHold(s, decoded.code);
    settle(s);
    return reject(s, rawId, decoded.code);
  }
  const rec: ObservationRecord = decoded.record;
  if (!sameContext(rec.view_context, s.binding)) {
    s.bindingDenials += 1;
    return { disposition: "rejected", code: "OPAQUE_VIEW_BINDING_MISMATCH" };
  }
  if (rec.mode === "fixture") s.sawFixture = true;
  switch (rec.record_type) {
    case "run": {
      s.run = rec.data;
      if (s.connection === "unconnected") s.connection = rec.data.connection;
      settle(s);
      return {
        disposition: "stored",
        code: "RUN_INFORMATIONAL_CURSOR_NOT_A_WATERMARK",
      };
    }
    case "event":
      return receiveEvent(s, rec, at);
    case "snapshot":
      return receiveSnapshot(s, rec, at);
    default:
      return storeAncillary(s, rec);
  }
}

function replayInterval(
  s: MutableState,
  input: Extract<ReducerInput, { kind: "trusted_replay_interval" }>,
): ReduceOutcome {
  if (s.binding === null || s.appliedCursor === null)
    return reject(s, null, "INVALID_REPLAY_INTERVAL");
  if (
    !isCanonicalDecimal(input.fromCursor) ||
    !isCanonicalDecimal(input.throughCursor) ||
    input.coverageRef.length === 0
  ) {
    return reject(s, null, "INVALID_REPLAY_INTERVAL");
  }
  const events: EventRecord[] = [];
  for (const raw of input.records) {
    const decoded = decodeObservationRecord(raw, {
      supportedExtensions: s.extensions,
    });
    if (
      !decoded.ok ||
      decoded.record.record_type !== "event" ||
      !sameContext(decoded.record.view_context, s.binding)
    ) {
      return reject(s, null, "INVALID_REPLAY_INTERVAL");
    }
    events.push(decoded.record);
  }
  events.sort((a, b) => compareDecimal(a.data.cursor, b.data.cursor));
  let expect = input.fromCursor;
  for (const e of events) {
    if (e.data.cursor !== expect)
      return reject(s, null, "INVALID_REPLAY_INTERVAL");
    expect = nextDecimal(expect);
  }
  if (
    events.length === 0 ||
    nextDecimal(events[events.length - 1]?.data.cursor ?? "0") !==
      nextDecimal(input.throughCursor)
  ) {
    return reject(s, null, "INVALID_REPLAY_INTERVAL");
  }
  if (compareDecimal(input.fromCursor, nextDecimal(s.appliedCursor)) > 0)
    return reject(s, null, "INVALID_REPLAY_INTERVAL");

  const unseen = events.filter(
    (e) => s.eventIdentities[eventIdentity(e)] === undefined,
  );
  if (
    unseen.length > 0 &&
    retentionBlocked(
      s,
      unseen.length,
      0,
      unseen.reduce((n, e) => n + byteLength(canonicalJson(e)), 0),
    )
  )
    return retentionRefused(s, null);

  // The interval is proven contiguous for this view and epoch: admit its events into the buffer (verifying identities),
  // lift only the GAP hold and let the settle step apply them in cursor order.
  for (const e of events) {
    const id = eventIdentity(e);
    const canon = canonicalJson(e);
    const known = s.eventIdentities[id];
    if (known !== undefined && known.canon !== canon) {
      push(s.quarantined, {
        recordId: e.record_id,
        code: "IDENTITY_BODY_CONFLICT",
      });
      addHold(s, "IDENTITY_BODY_CONFLICT");
      return { disposition: "quarantined", code: "IDENTITY_BODY_CONFLICT" };
    }
    if (known === undefined || known.status === "covered") {
      if (!s.buffer.some((b) => b.identity === id)) {
        s.buffer.push({
          recordId: e.record_id,
          cursor: e.data.cursor,
          identity: id,
          receivedAt: input.at ?? 0,
          bytes: byteLength(canon),
          record: e,
        });
      }
      s.cursorBindings = { ...s.cursorBindings, [e.data.cursor]: id };
      s.eventIdentities = {
        ...s.eventIdentities,
        [id]: { canon, cursor: e.data.cursor, status: "buffered" },
      };
    }
  }
  s.holds = s.holds.filter((h) => h !== "GAP");
  settle(s);
  return { disposition: "applied", code: "REPLAY_INTERVAL_APPLIED" };
}

export function reduce(
  previous: ReducerState,
  input: ReducerInput,
): ReduceResult {
  const s = deepClone(previous) as MutableState;
  let outcome: ReduceOutcome;
  switch (input.kind) {
    case "set_mode":
      s.mode = input.mode;
      outcome = { disposition: "state_changed", code: null };
      break;
    case "set_buffer_limits":
      s.limits = { ...s.limits, ...input.limits };
      outcome = { disposition: "state_changed", code: null };
      break;
    case "bind_trusted_projection": {
      const next = input.viewContext;
      const session = input.sessionRef ?? null;
      if (s.binding === null) {
        s.binding = next;
        s.bindingSession = session;
      } else if (sameContext(next, s.binding) && session === s.bindingSession) {
        // Same binding, same session: idempotent. Nothing private is touched.
      } else if (
        !sameContext(next, s.binding) &&
        next.project_id === s.binding.project_id &&
        next.run_id === s.binding.run_id &&
        next.authorized_view_scope === s.binding.authorized_view_scope
      ) {
        // Same scope, different epoch: only the trusted epoch-reset protocol may cross an epoch.
        outcome = reject(s, null, "REBIND_REQUIRES_TRUSTED_EPOCH_RESET");
        break;
      } else {
        // A different project/run/scope, or a different authenticated session: the previous private projection must not
        // be relabelled as current. Clear every private field atomically and require a fresh authorized full snapshot.
        const connection = s.connection;
        const fresh = createReducerState({
          mode: s.mode,
          extensions: s.extensions,
          limits: s.limits,
        });
        Object.assign(s, fresh);
        s.connection = connection;
        s.binding = next;
        s.bindingSession = session;
        s.fullSnapshotRequired = true;
        settle(s);
        outcome = {
          disposition: "state_changed",
          code: "BINDING_CHANGED_STATE_CLEARED",
        };
        break;
      }
      if (s.projection === "unbound" || s.projection === "cleared")
        s.projection = "awaiting_snapshot";
      settle(s);
      outcome = { disposition: "state_changed", code: null };
      break;
    }
    case "receive":
      outcome = receive(s, input.record, input.at);
      break;
    case "trusted_replay_interval":
      outcome = replayInterval(s, input);
      break;
    case "trusted_page_set_manifest":
      outcome = receivePageSetManifest(s, input.manifest, input.at);
      break;
    case "trusted_epoch_reset": {
      const o = input.oldViewContext;
      const n = input.newViewContext;
      const ok =
        s.binding !== null &&
        sameContext(o, s.binding) &&
        n.project_id === o.project_id &&
        n.run_id === o.run_id &&
        n.authorized_view_scope === o.authorized_view_scope &&
        n.stream_epoch !== o.stream_epoch &&
        input.authorizationObservationRef.length > 0;
      if (!ok) {
        outcome = reject(s, null, "INVALID_EPOCH_RESET");
        break;
      }
      // Old-epoch pending state is discarded; the replacement full snapshot must follow.
      s.binding = n;
      s.view = null;
      s.appliedCursor = null;
      s.buffer = [];
      s.holds = [];
      s.eventIdentities = {};
      s.cursorBindings = {};
      s.currentPlan = null;
      s.fullSnapshotRequired = true;
      s.pages = null;
      s.pageSetManifests = {};
      // Old-epoch ancillary catalogs and histories carry no epoch provenance in the projection, so none is kept: the new
      // epoch starts from a clean private store and the read side re-delivers what it still authorizes.
      s.ancillary = {
        seen: {},
        attempts: {},
        artifacts: {},
        commands: {},
        deployments: {},
        joined: [],
      };
      s.history = [];
      s.snapshotHistory = [];
      s.planHistory = [];
      s.historicalOnly = [];
      s.eventLog = [];
      s.eventLedger = [];
      s.sourceSequences = [];
      s.sourceReconcile = [];
      s.unassociatedSubjects = [];
      s.refusals = [];
      s.appliedEventsCompacted = 0;
      s.run = null;
      s.trustedReset = {
        previousEpoch: o.stream_epoch,
        ref: input.authorizationObservationRef,
      };
      settle(s);
      outcome = { disposition: "state_changed", code: "EPOCH_RESET_TRUSTED" };
      break;
    }
    case "trusted_authorization_revoked": {
      if (s.binding === null || !sameContext(input.viewContext, s.binding)) {
        outcome = reject(s, null, "REVOCATION_BINDING_MISMATCH");
        break;
      }
      // Private projection, buffer, previews and file caches are cleared; a new authorized full snapshot is required.
      const fresh = createReducerState({
        mode: s.mode,
        extensions: s.extensions,
        limits: s.limits,
      });
      Object.assign(s, fresh);
      s.projection = "cleared";
      s.fullSnapshotRequired = true;
      outcome = { disposition: "state_changed", code: "AUTHORIZATION_REVOKED" };
      break;
    }
    case "evaluate_acceptance": {
      const entry = s.ancillary.attempts[input.recordId];
      if (entry === undefined) {
        outcome = reject(s, input.recordId, "UNKNOWN_RECORD");
        break;
      }
      const evaluation = evaluateAcceptance(
        entry.record.data.acceptance,
        input.policy,
      );
      const conflict = evaluation.issues.includes("ACCEPTANCE_POLICY_CONFLICT");
      s.ancillary = {
        ...s.ancillary,
        attempts: {
          ...s.ancillary.attempts,
          [input.recordId]: {
            ...entry,
            evaluation,
            semanticConflict: conflict,
          },
        },
      };
      outcome = conflict
        ? { disposition: "quarantined", code: "ACCEPTANCE_POLICY_CONFLICT" }
        : { disposition: "state_changed", code: null };
      break;
    }
    case "transport_connected":
      s.connection = "connected";
      outcome = { disposition: "state_changed", code: null };
      break;
    case "transport_disconnected":
      s.connection = "disconnected";
      outcome = { disposition: "state_changed", code: "STALE_DISCONNECTED" };
      break;
    case "tick":
      if (s.buffer.length > 0) overflowCheck(s, input.at);
      expirePages(s, input.at);
      settle(s);
      outcome = { disposition: "state_changed", code: null };
      break;
  }
  return { state: s, commands: [], outcome };
}

/** Fold a list of inputs. Convenience for tests and replay tooling; still pure. */
export function reduceAll(
  initial: ReducerState,
  inputs: readonly ReducerInput[],
): {
  state: ReducerState;
  outcomes: ReduceOutcome[];
  commands: readonly never[];
} {
  let state = initial;
  const outcomes: ReduceOutcome[] = [];
  for (const input of inputs) {
    const r = reduce(state, input);
    state = r.state;
    outcomes.push(r.outcome);
  }
  return { state, outcomes, commands: [] };
}

/* ---- projection ---- */

export type ViewKind = "unconnected" | "fixture" | "replay" | "live";

export interface ProjectedNode {
  readonly key: string;
  readonly graphKind: GraphKind;
  readonly authority: string;
  readonly namespace: string;
  readonly localId: string;
  readonly revision: string | null;
  readonly nodeType: string;
  readonly nativeState: string | null;
  readonly nativeVersions: Readonly<Record<string, string>>;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface ProjectedView {
  readonly viewKind: ViewKind;
  readonly projection: ReducerState["projection"];
  readonly stale: boolean;
  readonly appliedCursor: string | null;
  readonly holds: readonly string[];
  readonly fullSnapshotRequired: boolean;
  readonly currentPlan: string | null;
  /** Connection, freshness, native state and independent acceptance are four separate dimensions. */
  readonly dimensions: {
    readonly connection: string;
    readonly freshness: ReducerState["projection"];
    readonly nativeState: string | null;
    /** Case-reporting token. `FAIL` here is a fail-closed source observation; see `acceptanceBasis`. */
    readonly independentAcceptance: "NOT_MEASURED" | "FAIL";
    /** `source_fail_unverified`: a raw source FAIL with an actual failing checker, retained but not authenticated. */
    readonly acceptanceBasis: AcceptanceEvaluation["basis"];
    /** Always false: the pure reducer never supplies authentic checker binding (KCLIVE-22 does). */
    readonly independentlyVerified: false;
  };
  readonly declaredGraphKinds: readonly GraphKind[];
  readonly nodes: readonly ProjectedNode[];
  readonly crosslinks: readonly {
    readonly linkId: string;
    readonly kind: string;
    readonly from: string;
    readonly to: string;
    readonly associationRef: string;
  }[];
  readonly implicitJoins: 0;
  readonly workerStageNodes: number;
  readonly buffered: readonly string[];
  readonly rejected: readonly {
    readonly recordId: string | null;
    readonly code: string;
  }[];
  readonly quarantined: readonly {
    readonly recordId: string | null;
    readonly code: string;
  }[];
  readonly ignored: readonly {
    readonly recordId: string | null;
    readonly code: string;
  }[];
  readonly historicalOnly: readonly string[];
  readonly uniqueSourceEventsApplied: number;
  readonly history: ReducerState["history"];
  readonly unassociatedSubjects: readonly string[];
  readonly refusals: ReducerState["refusals"];
  readonly attempts: readonly {
    readonly recordId: string;
    readonly attemptKey: string;
    readonly nativeState: string | null;
    readonly acceptance: "NOT_MEASURED" | "FAIL";
    readonly acceptanceBasis: AcceptanceEvaluation["basis"];
    readonly sourceAcceptance: string;
    readonly issues: readonly string[];
    readonly semanticConflict: boolean;
    readonly executedUndecided: readonly string[];
    readonly checkersObserved: boolean;
    readonly exactEvidenceCoverage: boolean;
    readonly joinedByEvent: boolean;
  }[];
  readonly artifacts: readonly {
    readonly recordId: string;
    readonly artifactKey: string;
    readonly availability: string;
    readonly access: string;
    readonly storageIdentity: string;
    readonly locator: unknown;
    readonly digests: readonly unknown[];
    readonly open: {
      readonly enabled: false;
      readonly requires: "CURRENT_AUTHORIZATION_AND_BYTE_CHECK";
    };
    readonly acceptance: "NOT_MEASURED" | "FAIL";
  }[];
  readonly immutableCaptureRevisions: readonly string[];
  readonly commands: readonly {
    readonly commandId: string;
    readonly journalStatus: string;
    readonly reason: string | null;
    readonly canonicalRunId: string | null;
    readonly canonicalAttemptRef: unknown;
  }[];
  readonly deployments: readonly {
    readonly recordId: string;
    readonly observedBuild: unknown;
    readonly capabilities: readonly {
      readonly name: string;
      readonly status: string;
    }[];
  }[];
  readonly eventLedger: readonly (EventLedgerEntry & {
    readonly producerBuild: ProducerBuildObservation;
  })[];
  readonly sourceSequences: ReducerState["sourceSequences"];
  readonly sourceReconcile: readonly string[];
  readonly snapshotAtomicity: string;
  readonly globalCompletenessAsserted: false;
  readonly crossSourceAtomicityAsserted: false;
  readonly emittedCommands: readonly never[];
}

const journalRank: Record<string, number> = {
  unknown: 0,
  intent_observed: 1,
  accepted_observed: 2,
  rejected_observed: 2,
};

function projectNode(n: GraphNode): ProjectedNode {
  return {
    key: nodeKey(n.ref),
    graphKind: n.ref.graph_kind,
    authority: n.ref.authority,
    namespace: n.ref.namespace,
    localId: n.ref.local_id,
    revision: n.ref.revision,
    nodeType: n.node_type,
    nativeState: n.native_state?.value ?? null,
    nativeVersions: n.native_versions,
    attributes: n.attributes,
  };
}

/** Deterministic, ordering-stable projection of reducer state for the shared inspector. Pure. */
export function projectView(state: ReducerState): ProjectedView {
  const v = state.view;
  const nodes =
    v === null
      ? []
      : v.graphs
          .flatMap((g) => g.nodes.map(projectNode))
          .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const attempts = Object.values(state.ancillary.attempts)
    .map((e) => ({
      recordId: e.record.record_id,
      attemptKey: nodeKey(e.record.data.attempt_ref),
      nativeState: e.record.data.native_state?.value ?? null,
      acceptance: e.evaluation.effectiveVerdict,
      acceptanceBasis: e.evaluation.basis,
      sourceAcceptance: e.record.data.acceptance.verdict,
      issues: e.evaluation.issues,
      semanticConflict: e.semanticConflict,
      executedUndecided: e.evaluation.executedUndecided,
      checkersObserved: e.evaluation.checkersObserved,
      exactEvidenceCoverage:
        e.record.data.evidence_coverage === "exact_attempt",
      joinedByEvent: state.ancillary.joined.includes(e.record.record_id),
    }))
    .sort((a, b) => (a.recordId < b.recordId ? -1 : 1));
  const artifacts = Object.values(state.ancillary.artifacts)
    .map((a) => {
      const denied = a.data.access === "denied";
      return {
        recordId: a.record_id,
        artifactKey: JSON.stringify([
          a.data.artifact.authority,
          a.data.artifact.namespace,
          a.data.artifact.artifact_id,
          a.data.artifact.revision,
        ]),
        // On denial nothing locating or fingerprinting the content is exposed.
        availability: denied ? "unknown" : a.data.availability,
        access: a.data.access,
        storageIdentity: a.data.storage_identity,
        locator: denied ? null : a.data.locator,
        digests: denied ? [] : a.data.digests,
        open: {
          enabled: false as const,
          requires: "CURRENT_AUTHORIZATION_AND_BYTE_CHECK" as const,
        },
        acceptance: evaluateAcceptance(a.data.acceptance).effectiveVerdict,
      };
    })
    .sort((a, b) => (a.recordId < b.recordId ? -1 : 1));
  const commandById = new Map<
    string,
    ReducerState["ancillary"]["commands"][string]
  >();
  for (const c of Object.values(state.ancillary.commands)) {
    const prior = commandById.get(c.data.command_id);
    if (
      prior === undefined ||
      (journalRank[c.data.journal_status] ?? 0) >=
        (journalRank[prior.data.journal_status] ?? 0)
    ) {
      commandById.set(c.data.command_id, c);
    }
  }
  const nativeTop = v?.nativeState?.value ?? null;
  return {
    viewKind:
      v === null ? "unconnected" : state.sawFixture ? "fixture" : state.mode,
    projection: state.projection,
    stale:
      state.projection !== "current" || state.connection === "disconnected",
    appliedCursor: state.appliedCursor,
    holds: state.holds,
    fullSnapshotRequired: state.fullSnapshotRequired,
    currentPlan: state.currentPlan,
    dimensions: {
      connection: state.connection,
      freshness: state.projection,
      nativeState: nativeTop,
      independentAcceptance: v?.acceptance.effectiveVerdict ?? "NOT_MEASURED",
      acceptanceBasis: v?.acceptance.basis ?? "none",
      independentlyVerified: false,
    },
    declaredGraphKinds: v?.declaredGraphKinds ?? [],
    nodes,
    crosslinks: (v?.crosslinks ?? []).map((c) => ({
      linkId: c.link_id,
      kind: c.kind,
      from: nodeKey(c.from),
      to: nodeKey(c.to),
      associationRef: c.association_ref,
    })),
    implicitJoins: 0,
    workerStageNodes: nodes.filter(
      (n) =>
        n.graphKind === "processing_execution" && n.nodeType === "stage_task",
    ).length,
    buffered: state.buffer.map((b) => b.recordId),
    rejected: state.rejected,
    quarantined: state.quarantined,
    ignored: state.ignored,
    historicalOnly: state.historicalOnly,
    uniqueSourceEventsApplied:
      Object.values(state.eventIdentities).filter((e) => e.status === "applied")
        .length + state.appliedEventsCompacted,
    history: state.history,
    unassociatedSubjects: state.unassociatedSubjects,
    refusals: state.refusals,
    attempts,
    artifacts,
    immutableCaptureRevisions: Object.values(state.ancillary.artifacts)
      .filter((a) => a.data.storage_identity === "immutable")
      .map((a) => a.data.artifact.revision)
      .sort(),
    commands: [...commandById.values()]
      .map((c) => ({
        commandId: c.data.command_id,
        journalStatus: c.data.journal_status,
        reason: c.data.reason,
        canonicalRunId: c.data.canonical_run_id,
        canonicalAttemptRef: c.data.canonical_attempt_ref,
      }))
      .sort((a, b) => (a.commandId < b.commandId ? -1 : 1)),
    deployments: Object.values(state.ancillary.deployments)
      .map((d) => ({
        recordId: d.record_id,
        observedBuild: d.data.actual_build,
        capabilities: d.data.capabilities,
      }))
      .sort((a, b) => (a.recordId < b.recordId ? -1 : 1)),
    eventLedger: state.eventLedger.map((e) => ({
      ...e,
      producerBuild: e.producerBuild ?? PRODUCER_BUILD_NOT_MEASURED,
    })),
    sourceSequences: state.sourceSequences,
    sourceReconcile: state.sourceReconcile,
    snapshotAtomicity: v?.sourceAtomicity ?? "not_established",
    globalCompletenessAsserted: false,
    crossSourceAtomicityAsserted: false,
    emittedCommands: [],
  };
}

/** The part of the view that must be identical when the same recorded events are reduced in any admissible order. */
export function stableViewDigestInput(state: ReducerState): string {
  const view = projectView(state);
  return canonicalJson({
    projection: view.projection,
    appliedCursor: view.appliedCursor,
    currentPlan: view.currentPlan,
    nodes: view.nodes,
    crosslinks: view.crosslinks,
    attempts: view.attempts,
    artifacts: view.artifacts,
    commands: view.commands,
  });
}

/* ---- graph presentation projection (KCLIVE-01 slice 6) ---- */

/** A fully qualified node reference as shown to a consumer; never a bare local id. */
export interface PresentedRef {
  readonly key: string;
  readonly graphKind: GraphKind;
  readonly authority: string;
  readonly namespace: string;
  readonly localId: string;
  readonly revision: string | null;
}

/** Source acceptance is reported as observed; independent acceptance is kept apart and is never promoted from it. */
export interface PresentedAcceptance {
  /** The raw verdict the source asserted. A source PASS is only that, never an independent PASS. */
  readonly sourceVerdict: "PASS" | "FAIL" | "NOT_MEASURED";
  readonly independentVerdict: "NOT_MEASURED" | "FAIL";
  readonly independentBasis: AcceptanceEvaluation["basis"];
  readonly independentlyVerified: false;
  readonly issues: readonly string[];
}

export interface PresentedGraph {
  readonly graphKind: GraphKind;
  readonly authority: string;
  readonly graphRevision: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

export interface PresentedNode extends PresentedRef {
  readonly nodeType: string;
  readonly nativeState: string | null;
  readonly acceptance: PresentedAcceptance;
  readonly evidenceRefs: readonly string[];
}

export interface PresentedEdge {
  /** `[graphKind, edgeId]`: edge ids are only unique within their graph, so the graph is part of the identity. */
  readonly edgeKey: string;
  readonly edgeId: string;
  readonly graphKind: GraphKind;
  readonly graphAuthority: string;
  readonly graphRevision: string;
  readonly kind: string;
  readonly from: PresentedRef;
  readonly to: PresentedRef;
  readonly evidenceRefs: readonly string[];
}

export interface PresentedCrosslink {
  readonly linkId: string;
  readonly kind: string;
  readonly from: PresentedRef;
  readonly to: PresentedRef;
  readonly associationRef: string;
  readonly evidenceRefs: readonly string[];
}

export interface GraphPresentation {
  readonly viewKind: ViewKind;
  readonly projection: ReducerState["projection"];
  readonly stale: boolean;
  readonly appliedCursor: string | null;
  readonly currentPlan: string | null;
  /** Authority revisions of the source projection, as observed (canonical order); never interpreted or merged. */
  readonly sourceRevisions: readonly unknown[];
  readonly topAcceptance: PresentedAcceptance | null;
  readonly graphs: readonly PresentedGraph[];
  readonly nodes: readonly PresentedNode[];
  readonly edges: readonly PresentedEdge[];
  readonly crosslinks: readonly PresentedCrosslink[];
  readonly implicitJoins: 0;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function presentedRef(r: QualifiedRef): PresentedRef {
  return {
    key: nodeKey(r),
    graphKind: r.graph_kind,
    authority: r.authority,
    namespace: r.namespace,
    localId: r.local_id,
    revision: r.revision,
  };
}

function presentedAcceptance(a: GraphNode["acceptance"]): PresentedAcceptance {
  const e = evaluateAcceptance(a);
  return {
    sourceVerdict: a.verdict,
    independentVerdict: e.effectiveVerdict,
    independentBasis: e.basis,
    independentlyVerified: false,
    issues: e.issues,
  };
}

/**
 * The one shared graph presentation for site mounts: qualified typed ordinary edges, graph identity and revision, and
 * the evidence associations of nodes, edges and links, with source acceptance kept apart from independent acceptance.
 * Pure and derived 1:1 from the retained view: it adds no join, no cross product and no local reconstruction, so its size
 * is bounded by the already-bounded view. Revocation, epoch reset and context clearing empty `view`, which empties it.
 */
export function projectGraphPresentation(
  state: ReducerState,
): GraphPresentation {
  const v = state.view;
  const graphs = v?.graphs ?? [];
  const base = projectView(state);
  return {
    viewKind: base.viewKind,
    projection: base.projection,
    stale: base.stale,
    appliedCursor: base.appliedCursor,
    currentPlan: base.currentPlan,
    sourceRevisions: deepClone(
      sortedBy(v?.sourceRevisions ?? [], canonicalJson),
    ),
    topAcceptance: v === null ? null : presentedAcceptance(v.acceptanceRecord),
    graphs: graphs
      .map((g) => ({
        graphKind: g.graph_kind,
        authority: g.authority,
        graphRevision: g.graph_revision,
        nodeCount: g.nodes.length,
        edgeCount: g.edges.length,
      }))
      .sort((a, b) => cmp(a.graphKind, b.graphKind)),
    nodes: graphs
      .flatMap((g) =>
        g.nodes.map((n) => ({
          ...presentedRef(n.ref),
          nodeType: n.node_type,
          nativeState: n.native_state?.value ?? null,
          acceptance: presentedAcceptance(n.acceptance),
          evidenceRefs: [...n.evidence_refs].sort(cmp),
        })),
      )
      .sort((a, b) => cmp(a.key, b.key)),
    edges: graphs
      .flatMap((g) =>
        g.edges.map((e) => ({
          edgeKey: JSON.stringify([g.graph_kind, e.edge_id]),
          edgeId: e.edge_id,
          graphKind: g.graph_kind,
          graphAuthority: g.authority,
          graphRevision: g.graph_revision,
          kind: e.kind,
          from: presentedRef(e.from),
          to: presentedRef(e.to),
          evidenceRefs: [...e.evidence_refs].sort(cmp),
        })),
      )
      .sort((a, b) => cmp(a.edgeKey, b.edgeKey)),
    crosslinks: (v?.crosslinks ?? [])
      .map((c) => ({
        linkId: c.link_id,
        kind: c.kind,
        from: presentedRef(c.from),
        to: presentedRef(c.to),
        associationRef: c.association_ref,
        evidenceRefs: [...c.evidence_refs].sort(cmp),
      }))
      .sort((a, b) => cmp(a.linkId, b.linkId)),
    implicitJoins: 0,
  };
}

/**
 * Order-stable comparison input for the presentation. It extends the existing stable view input with the pieces that
 * input omits (edges, graph revision, source revisions, node/edge/link evidence, source acceptance), so an edge-only or evidence-only
 * difference changes it. `stableViewDigestInput` itself is unchanged.
 */
export function graphPresentationDigestInput(state: ReducerState): string {
  const p = projectGraphPresentation(state);
  return canonicalJson({
    stable: JSON.parse(stableViewDigestInput(state)) as unknown,
    graphs: p.graphs,
    nodes: p.nodes,
    edges: p.edges,
    crosslinks: p.crosslinks,
    topAcceptance: p.topAcceptance,
    sourceRevisions: p.sourceRevisions,
  });
}
