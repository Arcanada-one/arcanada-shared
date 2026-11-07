/**
 * KCLIVE-01 round 5: Agent-Brain consumer-boundary review of merged PR #111 (comment 6704714043), findings R1-R3.
 * Every case below is written against the reducer at main 4cd39f51 first (red-before) and then against the repair
 * (green-after). Fixture values are synthetic; no live adapter is involved. The reducer exports zero commands throughout.
 *
 *  R1  a changed trusted binding (or authenticated session) must not keep the previous private projection.
 *  R2  the lifetime state the reducer retains (identities, cursor bindings, ancillary catalogs, histories) is bounded.
 *  R3  one page-age predicate applies before every page-set completion path (page, manifest, tick).
 */
import { describe, expect, it } from "vitest";
import {
  createReducerState,
  projectView,
  reduce,
  type PageSetManifest,
  type ReduceOutcome,
  type ReducerInput,
  type ReducerState,
  type ViewContext,
} from "./knowledge-observation.api.js";
import {
  caseMeta,
  records,
  sealManifest,
  splitPages,
} from "./knowledge-observation.harness.js";

const CTX = caseMeta.default_view_context as ViewContext;
const CTX_B: ViewContext = { ...CTX, authorized_view_scope: "opaque-view-B" };
const CTX_PROJECT_B: ViewContext = { ...CTX, project_id: "other-project" };
const CTX_EPOCH_B: ViewContext = { ...CTX, stream_epoch: "epoch-B" };
const BASE = BigInt("9007199254740992");

const rec = (id: string): Record<string, unknown> =>
  structuredClone(records[id]) as Record<string, unknown>;
const recv = (record: unknown, at?: number): ReducerInput =>
  at === undefined
    ? { kind: "receive", record }
    : { kind: "receive", record, at };
const bind = (viewContext: ViewContext, sessionRef?: string): ReducerInput =>
  sessionRef === undefined
    ? { kind: "bind_trusted_projection", viewContext }
    : ({
        kind: "bind_trusted_projection",
        viewContext,
        sessionRef,
      } as ReducerInput);
const manifestIn = (manifest: PageSetManifest, at?: number): ReducerInput =>
  at === undefined
    ? { kind: "trusted_page_set_manifest", manifest }
    : { kind: "trusted_page_set_manifest", manifest, at };

/** A distinct, valid same-view event whose cursor is BASE + n (n = 1 is the fixture's own `event-1`). */
function evt(n: number, state = "in_progress"): Record<string, unknown> {
  const r = rec("event-1");
  r["record_id"] = `ev-${n}`;
  const d = r["data"] as Record<string, unknown> & {
    source_sequence: { value: string };
    native_state: { value: string };
  };
  d["event_id"] = `ev-${n}`;
  d["cursor"] = String(BASE + BigInt(n));
  d["producer_event_id"] = `p-${n}`;
  d.source_sequence.value = String(100 + n);
  d.native_state.value = state;
  return r;
}
/** A valid ancillary artifact record with a distinct record id. */
function art(n: number): Record<string, unknown> {
  const r = rec("artifact-collected");
  r["record_id"] = `art-${n}`;
  return r;
}
/** A full snapshot of the same view that advances the watermark by `by`. */
function snapshotAt(by: number, id = `snapshot-at-${by}`): unknown {
  const r = rec("snapshot-A");
  r["record_id"] = id;
  (r["data"] as { watermark: string }).watermark = String(BASE + BigInt(by));
  return r;
}

function fold(
  initial: ReducerState,
  inputs: ReducerInput[],
): { state: ReducerState; outcomes: ReduceOutcome[] } {
  let state = initial;
  const outcomes: ReduceOutcome[] = [];
  for (const input of inputs) {
    const r = reduce(state, input);
    expect(r.commands).toEqual([]);
    state = r.state;
    outcomes.push(r.outcome);
  }
  return { state, outcomes };
}
const play = (
  inputs: ReducerInput[],
  options: Parameters<typeof createReducerState>[0] = { mode: "fixture" },
): { state: ReducerState; outcomes: ReduceOutcome[] } =>
  fold(createReducerState(options), [bind(CTX), ...inputs]);

const nodeState = (state: ReducerState): (string | null)[] =>
  projectView(state).nodes.map((n) => n.nativeState);

/** Everything private that a viewer or a consumer could read from the state, named by what it is. */
function privateFields(state: ReducerState): Record<string, unknown> {
  const v = projectView(state);
  return {
    nodes: v.nodes,
    crosslinks: v.crosslinks,
    attempts: v.attempts,
    artifacts: v.artifacts,
    commands: v.commands,
    deployments: v.deployments,
    history: v.history,
    eventLedger: v.eventLedger,
    sourceSequences: v.sourceSequences,
    sourceReconcile: v.sourceReconcile,
    buffered: v.buffered,
    appliedCursor: v.appliedCursor,
    currentPlan: v.currentPlan,
    immutableCaptureRevisions: v.immutableCaptureRevisions,
    eventIdentities: state.eventIdentities,
    cursorBindings: state.cursorBindings,
    seen: state.ancillary.seen,
  };
}
const EMPTY_PRIVATE = (): Record<string, unknown> =>
  privateFields(createReducerState({ mode: "fixture" }));

/** Populated context A: snapshot, an applied event, and one record of every ancillary kind. */
const populatedA = (): ReducerState =>
  play([
    recv(rec("snapshot-A")),
    recv(evt(1, "in_progress")),
    recv(rec("attempt-succeeded")),
    recv(art(1)),
    recv(rec("command-intent")),
    recv(rec("deployment-unmeasured")),
  ]).state;

describe("R1 — a changed trusted binding never keeps the previous private projection", () => {
  it("control: populated context A really holds private state", () => {
    const a = populatedA();
    const f = privateFields(a);
    expect(a.projection).toBe("current");
    expect((f["nodes"] as unknown[]).length).toBeGreaterThan(0);
    expect((f["attempts"] as unknown[]).length).toBe(1);
    expect((f["artifacts"] as unknown[]).length).toBe(1);
    expect((f["commands"] as unknown[]).length).toBe(1);
    expect((f["deployments"] as unknown[]).length).toBe(1);
    expect(a.appliedCursor).toBe(String(BASE + 1n));
  });

  for (const [label, next] of [
    ["another authorized view scope", CTX_B],
    ["another project", CTX_PROJECT_B],
  ] as const) {
    it(`A -> ${label} without a snapshot: every private field is cleared and a fresh snapshot is required`, () => {
      const r = reduce(populatedA(), bind(next));
      expect(r.commands).toEqual([]);
      expect(r.outcome).toEqual({
        disposition: "state_changed",
        code: "BINDING_CHANGED_STATE_CLEARED",
      });
      expect(r.state.binding).toEqual(next);
      expect(privateFields(r.state)).toEqual(EMPTY_PRIVATE());
      expect(r.state.projection).toBe("awaiting_snapshot");
      expect(r.state.fullSnapshotRequired).toBe(true);
      expect(projectView(r.state).stale).toBe(true);
    });
  }

  it("A -> B: the old context's records are refused and B's own snapshot installs on clean state", () => {
    const afterBind = reduce(populatedA(), bind(CTX_B)).state;
    const oldEvent = reduce(afterBind, recv(evt(2)));
    expect(oldEvent.outcome.disposition).toBe("rejected");
    expect(privateFields(oldEvent.state)).toEqual(EMPTY_PRIVATE());
    const b = structuredClone(rec("snapshot-A"));
    b["view_context"] = CTX_B;
    const installed = reduce(afterBind, recv(b)).state;
    expect(installed.projection).toBe("current");
    expect(installed.fullSnapshotRequired).toBe(false);
    expect(projectView(installed).attempts).toEqual([]);
    expect(projectView(installed).artifacts).toEqual([]);
  });

  it("same binding is idempotent: state, view and projection are unchanged", () => {
    const a = populatedA();
    const before = structuredClone(privateFields(a));
    const r = reduce(a, bind({ ...CTX }));
    expect(r.outcome.disposition).toBe("state_changed");
    expect(r.outcome.code).toBeNull();
    expect(privateFields(r.state)).toEqual(before);
    expect(r.state.projection).toBe("current");
    expect(r.state.fullSnapshotRequired).toBe(false);
  });

  it("same-scope epoch change through a plain bind is refused and leaves the old binding and view unchanged", () => {
    const a = populatedA();
    const before = structuredClone(privateFields(a));
    const r = reduce(a, bind(CTX_EPOCH_B));
    expect(r.outcome).toEqual({
      disposition: "rejected",
      code: "REBIND_REQUIRES_TRUSTED_EPOCH_RESET",
    });
    expect(r.state.binding).toEqual(CTX);
    expect(privateFields(r.state)).toEqual(before);
    expect(r.state.projection).toBe("current");
  });

  it("an authenticated session/principal change with the same opaque context clears private state", () => {
    const s1 = play([
      bind(CTX, "session-1"),
      recv(rec("snapshot-A")),
      recv(art(1)),
    ]).state;
    expect(projectView(s1).artifacts).toHaveLength(1);
    const changed = reduce(s1, bind(CTX, "session-2"));
    expect(changed.outcome.code).toBe("BINDING_CHANGED_STATE_CLEARED");
    expect(privateFields(changed.state)).toEqual(EMPTY_PRIVATE());
    expect(changed.state.fullSnapshotRequired).toBe(true);
    // The very same session re-binding is idempotent.
    const same = reduce(s1, bind(CTX, "session-1"));
    expect(privateFields(same.state)).toEqual(privateFields(s1));
    expect(same.state.projection).toBe("current");
  });

  it("an opaque tuple that happens to equal the old one does not hide a session change from unset to set", () => {
    const s1 = populatedA();
    const r = reduce(s1, bind(CTX, "session-new"));
    expect(privateFields(r.state)).toEqual(EMPTY_PRIVATE());
  });

  it("trusted epoch reset clears old-epoch ancillary catalogs and histories; none is projected as current", () => {
    const a = populatedA();
    const r = reduce(a, {
      kind: "trusted_epoch_reset",
      oldViewContext: CTX,
      newViewContext: CTX_EPOCH_B,
      authorizationObservationRef: "auth-obs-1",
    });
    expect(r.outcome.code).toBe("EPOCH_RESET_TRUSTED");
    expect(r.commands).toEqual([]);
    expect(privateFields(r.state)).toEqual(EMPTY_PRIVATE());
    expect(r.state.binding).toEqual(CTX_EPOCH_B);
    expect(r.state.fullSnapshotRequired).toBe(true);
    expect(r.state.trustedReset).toEqual({
      previousEpoch: "epoch-A",
      ref: "auth-obs-1",
    });
  });
});

/* -------------------------------------------------------------------------------------------------------------- */
const identityCount = (s: ReducerState): number =>
  Object.keys(s.eventIdentities).length;
const retainedBytes = (s: ReducerState): number =>
  [
    ...Object.values(s.eventIdentities).map((e) => e.canon),
    ...Object.values(s.ancillary.seen),
  ].reduce((n, c) => n + new TextEncoder().encode(c).length, 0);

describe("R2 — lifetime retained state is bounded and exhaustion fails closed", () => {
  const LIMITS = { maxRetainedIdentities: 5 } as Record<string, number>;
  const small = (
    inputs: ReducerInput[],
    limits: Record<string, number> = LIMITS,
  ): { state: ReducerState; outcomes: ReduceOutcome[] } =>
    play([recv(rec("snapshot-A")), ...inputs], { mode: "fixture", limits });

  it("accepted in-order events beyond the identity budget stop growing the state and enter RETENTION_LIMIT_EXCEEDED", () => {
    const inputs = Array.from({ length: 40 }, (_, i) => recv(evt(i + 1)));
    const r = small(inputs);
    expect(identityCount(r.state)).toBeLessThanOrEqual(5);
    expect(Object.keys(r.state.cursorBindings).length).toBeLessThanOrEqual(5);
    expect(r.state.holds).toContain("RETENTION_LIMIT_EXCEEDED");
    expect(r.state.fullSnapshotRequired).toBe(true);
    expect(r.state.projection).toBe("reconciling");
    // The last trusted view is the fifth applied event; nothing later was applied.
    expect(r.state.appliedCursor).toBe(String(BASE + 5n));
    expect(r.outcomes.at(-1)).toMatchObject({
      disposition: "quarantined",
      code: "RETENTION_LIMIT_EXCEEDED",
    });
    expect(nodeState(r.state)).toContain("in_progress");
  });

  it("future (gapped) events beyond the budget are refused, not retained", () => {
    const inputs = Array.from({ length: 40 }, (_, i) => recv(evt(i + 10)));
    const r = small(inputs);
    expect(identityCount(r.state)).toBeLessThanOrEqual(5);
    expect(r.state.buffer.length).toBeLessThanOrEqual(5);
    expect(r.state.holds).toContain("RETENTION_LIMIT_EXCEEDED");
    expect(r.state.fullSnapshotRequired).toBe(true);
    expect(r.state.appliedCursor).toBe(String(BASE));
  });

  it("after buffer overflow the covered identities still count against the budget", () => {
    const r = small(
      Array.from({ length: 40 }, (_, i) => recv(evt(i + 10))),
      { maxRetainedIdentities: 20, maxRecords: 3 },
    );
    expect(r.state.buffer).toHaveLength(0);
    expect(identityCount(r.state)).toBeLessThanOrEqual(20);
  });

  it("a byte budget bounds the retained canonical identity and ancillary bytes", () => {
    const one = new TextEncoder().encode(JSON.stringify(evt(1))).length;
    const budget = one * 3;
    const r = small(
      [
        ...Array.from({ length: 20 }, (_, i) => recv(evt(i + 1))),
        ...Array.from({ length: 20 }, (_, i) => recv(art(i + 1))),
      ],
      { maxRetainedBytes: budget },
    );
    expect(retainedBytes(r.state)).toBeLessThanOrEqual(budget);
    expect(r.state.holds).toContain("RETENTION_LIMIT_EXCEEDED");
  });

  it("ancillary records beyond the catalog budget are refused with a defined recovery state", () => {
    const r = small(
      Array.from({ length: 12 }, (_, i) => recv(art(i + 1))),
      { maxAncillaryRecords: 3 },
    );
    expect(Object.keys(r.state.ancillary.seen).length).toBeLessThanOrEqual(3);
    expect(projectView(r.state).artifacts).toHaveLength(3);
    expect(r.state.holds).toContain("RETENTION_LIMIT_EXCEEDED");
    expect(r.state.fullSnapshotRequired).toBe(true);
    expect(r.outcomes.at(-1)).toMatchObject({
      disposition: "quarantined",
      code: "RETENTION_LIMIT_EXCEEDED",
    });
  });

  it(
    "every history list is bounded however many events are applied",
    { timeout: 180_000 },
    () => {
      const n = 560;
      const r = play(
        [
          recv(rec("snapshot-A")),
          ...Array.from({ length: n }, (_, i) => recv(evt(i + 1))),
        ],
        {
          mode: "fixture",
          limits: {
            maxRetainedIdentities: 10_000,
            maxRetainedBytes: 100_000_000,
          } as Record<string, number>,
        },
      );
      expect(r.state.appliedCursor).toBe(String(BASE + BigInt(n)));
      for (const list of [
        r.state.eventLog,
        r.state.eventLedger,
        r.state.sourceSequences,
        r.state.history,
        r.state.snapshotHistory,
      ])
        expect(list.length).toBeLessThanOrEqual(512);
    },
  );

  it("duplicates and conflicts of retained identities are still detected at exhaustion", () => {
    const base = Array.from({ length: 10 }, (_, i) => recv(evt(i + 1)));
    const dup = small([...base, recv(evt(2))]);
    expect(dup.outcomes.at(-1)).toMatchObject({
      disposition: "ignored",
      code: "DUPLICATE_SAME_IDENTITY_AND_BODY",
    });
    const conflict = small([...base, recv(evt(2, "done"))]);
    expect(conflict.outcomes.at(-1)).toMatchObject({
      disposition: "quarantined",
      code: "IDENTITY_BODY_CONFLICT",
    });
    expect(conflict.state.holds).toContain("IDENTITY_BODY_CONFLICT");
  });

  it("a trusted full snapshot is the compaction boundary: state shrinks, and both sides of it keep their guarantees", () => {
    const exhausted = small(
      Array.from({ length: 12 }, (_, i) => recv(evt(i + 1))),
    ).state;
    expect(exhausted.holds).toContain("RETENTION_LIMIT_EXCEEDED");
    const W = 20;
    const boundary = reduce(exhausted, recv(snapshotAt(W))).state;
    expect(boundary.appliedCursor).toBe(String(BASE + BigInt(W)));
    expect(boundary.holds).toEqual([]);
    expect(boundary.fullSnapshotRequired).toBe(false);
    expect(boundary.projection).toBe("current");
    expect(identityCount(boundary)).toBe(0);
    const viewAtBoundary = structuredClone(nodeState(boundary));

    // Below the boundary: an old event, identical or conflicting, is covered by the watermark and never applied.
    const oldSame = reduce(boundary, recv(evt(3)));
    expect(oldSame.outcome).toMatchObject({
      disposition: "ignored",
      code: "COVERED_BY_WATERMARK",
    });
    const oldConflict = reduce(oldSame.state, recv(evt(3, "done")));
    expect(oldConflict.outcome.disposition).not.toBe("applied");
    expect(nodeState(oldConflict.state)).toEqual(viewAtBoundary);
    expect(oldConflict.state.appliedCursor).toBe(String(BASE + BigInt(W)));

    // Above the boundary: new events apply, and duplicate / conflict handling works again with retained identities.
    const next = reduce(boundary, recv(evt(W + 1, "done")));
    expect(next.outcome.disposition).toBe("applied");
    expect(next.state.appliedCursor).toBe(String(BASE + BigInt(W + 1)));
    const dup = reduce(next.state, recv(evt(W + 1, "done")));
    expect(dup.outcome.code).toBe("DUPLICATE_SAME_IDENTITY_AND_BODY");
    const conflict = reduce(next.state, recv(evt(W + 1, "todo")));
    expect(conflict.outcome).toMatchObject({
      disposition: "quarantined",
      code: "IDENTITY_BODY_CONFLICT",
    });
    // The number of unique applied events stays truthful across compaction.
    expect(projectView(boundary).uniqueSourceEventsApplied).toBe(5);
    expect(projectView(next.state).uniqueSourceEventsApplied).toBe(6);
  });

  it("a consistent snapshot at the applied watermark also recovers a state held only by retention exhaustion", () => {
    const ex = small(
      Array.from({ length: 6 }, (_, i) => recv(art(i + 1))),
      { maxAncillaryRecords: 3 },
    ).state;
    expect(ex.holds).toEqual(["RETENTION_LIMIT_EXCEEDED"]);
    const r = reduce(ex, recv(snapshotAt(0)));
    expect(r.outcome).toMatchObject({
      disposition: "applied",
      code: "RETENTION_COMPACTED",
    });
    expect(r.state.holds).toEqual([]);
    expect(Object.keys(r.state.ancillary.seen)).toHaveLength(0);
    expect(r.state.appliedCursor).toBe(String(BASE));
    // With another hold present the same snapshot stays an ignored consistent duplicate.
    const other = reduce(
      { ...ex, holds: ["RETENTION_LIMIT_EXCEEDED", "GAP"] },
      recv(snapshotAt(0)),
    );
    expect(other.outcome.code).toBe("SAME_WATERMARK_CONSISTENT");
  });

  it("an ancillary-exhausted state recovers through the same snapshot boundary (catalogs are re-delivered by the read side)", () => {
    const ex = small(
      Array.from({ length: 6 }, (_, i) => recv(art(i + 1))),
      { maxAncillaryRecords: 3 },
    ).state;
    const after = reduce(ex, recv(snapshotAt(1))).state;
    expect(after.holds).toEqual([]);
    expect(Object.keys(after.ancillary.seen)).toHaveLength(0);
    const again = reduce(after, recv(art(1)));
    expect(again.outcome.disposition).toBe("stored");
  });
});

/* -------------------------------------------------------------------------------------------------------------- */
describe("R3 — one page-age predicate guards every page-set completion path", () => {
  const LIMITS = { maxAgeMs: 100 };
  const PAGES = (): Record<string, unknown>[] =>
    splitPages("snapshot-ahead", 2);
  /** Applied view: snapshot-A, then both pages at t=0 with no manifest yet. */
  const pendingAllPages = (): ReducerState => {
    const pages = PAGES();
    return play(
      [recv(rec("snapshot-A")), recv(pages[0], 0), recv(pages[1], 0)],
      { mode: "fixture", limits: LIMITS },
    ).state;
  };

  it("control: pages then a manifest within the limit install the set", () => {
    const m = sealManifest(PAGES());
    const r = reduce(pendingAllPages(), manifestIn(m, 50));
    expect(r.outcome).toMatchObject({ disposition: "applied" });
    expect(r.state.pages).toBeNull();
  });

  for (const [label, at, installs] of [
    ["just before the limit", 99, true],
    ["exactly on the boundary", 100, true],
    ["just after the limit", 101, false],
    ["long after the limit", 5_000, false],
  ] as const) {
    it(`all pages first, trusted manifest ${label} (t=${at}) ${installs ? "installs" : "cannot install the expired set"}`, () => {
      const before = pendingAllPages();
      const viewBefore = structuredClone(nodeState(before));
      const cursorBefore = before.appliedCursor;
      const m = sealManifest(PAGES());
      const r = reduce(before, manifestIn(m, at));
      expect(r.commands).toEqual([]);
      if (installs) {
        expect(r.outcome.disposition).toBe("applied");
        return;
      }
      expect(r.outcome.disposition).not.toBe("applied");
      expect(r.state.pages).toBeNull();
      expect(r.state.appliedCursor).toBe(cursorBefore);
      expect(nodeState(r.state)).toEqual(viewBefore);
      expect(r.state.fullSnapshotRequired).toBe(true);
      expect(r.state.holds).toContain("PAGE_ASSEMBLY_LIMIT_EXCEEDED");
      expect(r.state.snapshotHistory.length).toBeLessThanOrEqual(512);
    });
  }

  it("the manifest does not refresh the age: a set that expired before the manifest stays expired for a later page", () => {
    const pages = PAGES();
    const s = play([recv(rec("snapshot-A")), recv(pages[0], 0)], {
      mode: "fixture",
      limits: LIMITS,
    }).state;
    const withManifest = reduce(s, manifestIn(sealManifest(pages), 90)).state;
    const late = reduce(withManifest, recv(pages[1], 150));
    expect(late.outcome.disposition).not.toBe("applied");
    expect(late.state.pages).toBeNull();
  });

  it("tick expires a pending complete assembly that is still waiting for its manifest", () => {
    const keep = reduce(pendingAllPages(), { kind: "tick", at: 100 });
    expect(keep.state.pages).not.toBeNull();
    const gone = reduce(pendingAllPages(), { kind: "tick", at: 101 });
    expect(gone.state.pages).toBeNull();
    expect(gone.state.fullSnapshotRequired).toBe(true);
    expect(gone.state.holds).toContain("PAGE_ASSEMBLY_LIMIT_EXCEEDED");
    // A manifest after the tick has nothing left to complete.
    const afterTick = reduce(
      gone.state,
      manifestIn(sealManifest(PAGES()), 102),
    );
    expect(afterTick.outcome.disposition).not.toBe("applied");
    expect(nodeState(afterTick.state)).toEqual(nodeState(pendingAllPages()));
  });

  it("tick expires a pending incomplete assembly", () => {
    const pages = PAGES();
    const s = play([recv(rec("snapshot-A")), recv(pages[0], 0)], {
      mode: "fixture",
      limits: LIMITS,
    }).state;
    expect(s.pages).not.toBeNull();
    expect(reduce(s, { kind: "tick", at: 100 }).state.pages).not.toBeNull();
    const gone = reduce(s, { kind: "tick", at: 101 });
    expect(gone.state.pages).toBeNull();
    expect(gone.state.fullSnapshotRequired).toBe(true);
  });

  it("manifest first, then pages: the page path keeps its own boundary rule", () => {
    const pages = PAGES();
    const ok = play(
      [
        recv(rec("snapshot-A")),
        manifestIn(sealManifest(pages)),
        recv(pages[0], 0),
        recv(pages[1], 100),
      ],
      { mode: "fixture", limits: LIMITS },
    );
    expect(ok.outcomes.at(-1)?.disposition).toBe("applied");
    const late = play(
      [
        recv(rec("snapshot-A")),
        manifestIn(sealManifest(pages)),
        recv(pages[0], 0),
        recv(pages[1], 101),
      ],
      { mode: "fixture", limits: LIMITS },
    );
    expect(late.outcomes.at(-1)?.disposition).not.toBe("applied");
    expect(late.state.pages).toBeNull();
  });
});
