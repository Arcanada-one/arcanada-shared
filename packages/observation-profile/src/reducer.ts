import {
  evaluateAcceptance,
  type AcceptanceEvaluation,
  type AcceptancePolicy,
} from "./acceptance.js";
import { canonicalJson, deepClone } from "./canonical.js";
import { compareDecimal, isCanonicalDecimal, nextDecimal } from "./decimal.js";
import { decodeObservationRecord } from "./decoder.js";
import {
  LOSSLESS_DECIMAL_EXTENSION,
  type ArtifactRecord,
  type AttemptRecord,
  type CommandRecord,
  type Crosslink,
  type DeploymentRecord,
  type EventRecord,
  type Graph,
  type GraphKind,
  type NativeState,
  type ObservationMode,
  type ObservationRecord,
  type QualifiedRef,
  type RunRecord,
  type SnapshotRecord,
  type ViewContext,
} from "./types.js";

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
  | "RESET_NOT_AUTHORIZED";

export interface BufferLimits {
  readonly maxRecords: number;
  readonly maxSerializedBytes: number;
  readonly maxAgeMs: number;
}

export const DEFAULT_BUFFER_LIMITS: BufferLimits = {
  maxRecords: 256,
  maxSerializedBytes: 1_048_576,
  maxAgeMs: 30_000,
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
  s.eventLog = [...s.eventLog, d.event_id];
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
  ];
  for (const related of d.related_record_ids) {
    if (!s.ancillary.joined.includes(related))
      s.ancillary = {
        ...s.ancillary,
        joined: [...s.ancillary.joined, related],
      };
  }
  if (d.kind === "plan_observed" && d.plan_revision !== null) {
    if (s.currentPlan !== null && s.currentPlan !== d.plan_revision)
      s.planHistory = [...s.planHistory, s.currentPlan];
    s.currentPlan = d.plan_revision;
    return "applied";
  }
  if (
    d.plan_revision !== null &&
    s.currentPlan !== null &&
    d.plan_revision !== s.currentPlan
  ) {
    // Superseded plan: retained as historical evidence; the transport cursor may advance, current nodes may not.
    s.historicalOnly = [...s.historicalOnly, d.event_id];
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
          s.unassociatedSubjects = [...s.unassociatedSubjects, k];
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
    ];
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
  ];
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

function snapshotConsistent(s: MutableState, snap: SnapshotRecord): boolean {
  if (s.view === null) return true;
  const incoming = new Map<string, string | null>();
  for (const g of snap.data.graphs)
    for (const n of g.nodes)
      incoming.set(nodeKey(n.ref), n.native_state?.value ?? null);
  for (const g of s.view.graphs) {
    for (const n of g.nodes) {
      const k = nodeKey(n.ref);
      if (
        incoming.has(k) &&
        incoming.get(k) !== (n.native_state?.value ?? null)
      )
        return false;
    }
  }
  return true;
}

function installSnapshot(s: MutableState, snap: SnapshotRecord): void {
  const d = snap.data;
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
    s.planHistory = [...s.planHistory, s.currentPlan];
  s.currentPlan = d.plan_revision;
  s.view = {
    snapshotRecordId: snap.record_id,
    watermark: d.watermark,
    planRevision: d.plan_revision,
    sourceAtomicity: d.source_atomicity,
    declaredGraphKinds: d.coverage.declared_graph_kinds,
    nativeState: d.native_state,
    acceptance: evaluateAcceptance(d.acceptance),
    graphs: deepClone(d.graphs),
    crosslinks: deepClone(d.crosslinks),
    withdrawn: [],
  };
  s.appliedCursor = d.watermark;
  s.holds = [];
  s.fullSnapshotRequired = false;
  s.trustedReset = null;
}

function receiveSnapshot(s: MutableState, snap: SnapshotRecord): ReduceOutcome {
  const d = snap.data;
  const record = (disposition: string): void => {
    s.snapshotHistory = [
      ...s.snapshotHistory,
      { recordId: snap.record_id, watermark: d.watermark, disposition },
    ];
  };
  if (d.snapshot_kind === "partial" || !d.coverage.complete) {
    // Partial pages may be assembled but never move the watermark or replace a current view.
    s.partialPages += 1;
    if (s.appliedCursor !== null && s.holds.length > 0)
      s.fullSnapshotRequired = true;
    record("partial_retained_for_assembly");
    return {
      disposition: "ignored",
      code: "PARTIAL_SNAPSHOT_NOT_AUTHORITATIVE",
    };
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

  const decoded = decodeObservationRecord(raw, {
    supportedExtensions: s.extensions,
  });
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
      return receiveSnapshot(s, rec);
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
    case "bind_trusted_projection":
      s.binding = input.viewContext;
      if (s.projection === "unbound" || s.projection === "cleared")
        s.projection = "awaiting_snapshot";
      settle(s);
      outcome = { disposition: "state_changed", code: null };
      break;
    case "receive":
      outcome = receive(s, input.record, input.at);
      break;
    case "trusted_replay_interval":
      outcome = replayInterval(s, input);
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
