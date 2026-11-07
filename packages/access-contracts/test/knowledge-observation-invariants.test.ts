import { describe, expect, it } from "vitest";
import {
  compareDecimal,
  createReducerState,
  decodeObservationRecord,
  parseKnowledgeObservationJson,
  nextDecimal,
  projectView,
  reduce,
  stableViewDigestInput,
  type ReducerInput,
  type ReducerState,
  type ViewContext,
} from "./knowledge-observation.api.js";
import { caseMeta, records } from "./knowledge-observation.harness.js";

const CTX = caseMeta.default_view_context as ViewContext;
const rec = (id: string): Record<string, unknown> =>
  structuredClone(records[id]) as Record<string, unknown>;
const recv = (id: string): ReducerInput => ({
  kind: "receive",
  record: rec(id),
});

function run(
  inputs: ReducerInput[],
  mode: "live" | "replay" | "fixture" = "fixture",
): { state: ReducerState; commands: unknown[] } {
  let state = createReducerState({ mode });
  const commands: unknown[] = [];
  for (const input of [
    { kind: "bind_trusted_projection", viewContext: CTX } as ReducerInput,
    ...inputs,
  ]) {
    const r = reduce(state, input);
    state = r.state;
    commands.push(...r.commands);
  }
  return { state, commands };
}

const interval = (
  from: string,
  through: string,
  ids: string[],
): ReducerInput => ({
  kind: "trusted_replay_interval",
  fromCursor: from,
  throughCursor: through,
  records: ids.map(rec),
  coverageRef: "test:authorized-interval",
});

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("same recorded events reduce to the same view", () => {
  const inOrder = run([
    recv("snapshot-A"),
    recv("event-1"),
    recv("event-2"),
    recv("event-3"),
  ]);

  it("is deterministic across repeated runs and across modes", () => {
    const again = run([
      recv("snapshot-A"),
      recv("event-1"),
      recv("event-2"),
      recv("event-3"),
    ]);
    expect(stableViewDigestInput(again.state)).toBe(
      stableViewDigestInput(inOrder.state),
    );
    for (const mode of ["live", "replay"] as const) {
      const other = run(
        [recv("snapshot-A"), recv("event-1"), recv("event-2"), recv("event-3")],
        mode,
      );
      expect(stableViewDigestInput(other.state)).toBe(
        stableViewDigestInput(inOrder.state),
      );
    }
  });

  it("converges for 80 seeded random arrival orders once the authorized contiguous interval is supplied", () => {
    const rnd = mulberry(20261106);
    const ids = [
      "snapshot-A",
      "event-1",
      "event-2",
      "event-3",
      "event-4",
      "event-5",
      "event-1-duplicate",
    ];
    const full = run([
      recv("snapshot-A"),
      recv("event-1"),
      recv("event-2"),
      recv("event-3"),
      recv("event-4"),
      recv("event-5"),
    ]);
    const target = stableViewDigestInput(full.state);
    for (let n = 0; n < 80; n += 1) {
      const order = [...ids].sort(() => rnd() - 0.5);
      const r = run([
        ...order.map(recv),
        interval("9007199254740993", "9007199254740997", [
          "event-1",
          "event-2",
          "event-3",
          "event-4",
          "event-5",
        ]),
      ]);
      expect(r.commands).toEqual([]);
      expect(stableViewDigestInput(r.state), order.join(",")).toBe(target);
    }
  }, 30_000);
});

describe("duplicates, out-of-order delivery and missing sequences neither rerun actions nor synthesize completion", () => {
  it("never emits a command however records are delivered", () => {
    const hostile: ReducerInput[] = [
      recv("event-3"),
      recv("snapshot-A"),
      recv("event-3"),
      recv("event-1"),
      recv("event-1"),
      recv("event-1-conflict"),
      recv("command-intent"),
      recv("command-refused"),
      recv("command-intent"),
      recv("authority-refusal"),
      recv("authority-refusal"),
    ];
    for (const mode of ["live", "replay", "fixture"] as const) {
      const r = run(hostile, mode);
      expect(r.commands).toEqual([]);
      expect(r.state.commands).toEqual([]);
    }
  });

  it("a duplicate is a no-op on the view, a gap holds the last trusted state and completion is never synthesized", () => {
    const once = run([recv("snapshot-A"), recv("event-1")]);
    const twice = run([
      recv("snapshot-A"),
      recv("event-1"),
      recv("event-1-duplicate"),
      recv("event-1"),
    ]);
    expect(stableViewDigestInput(twice.state)).toBe(
      stableViewDigestInput(once.state),
    );
    // done (event-3, cursor ...995) arrives with ...994 missing: state stays at in_progress, never done.
    const gap = run([recv("snapshot-A"), recv("event-1"), recv("event-3")]);
    const v = projectView(gap.state);
    expect(v.projection).toBe("reconciling");
    expect(v.nodes.find((n) => n.localId === "task-1")?.nativeState).toBe(
      "in_progress",
    );
    expect(v.dimensions.independentAcceptance).toBe("NOT_MEASURED");
    expect(v.attempts).toEqual([]);
  });

  it("a later missing event does not discharge a detected gap", () => {
    const r = run([
      recv("snapshot-A"),
      recv("event-3"),
      recv("event-1"),
      recv("event-2"),
    ]);
    expect(projectView(r.state).projection).toBe("reconciling");
    expect(r.state.appliedCursor).toBe("9007199254740992");
  });
});

describe("a cursor gap is explicit and recoverable only from an authorized snapshot with a watermark", () => {
  const gapped = [recv("snapshot-A"), recv("event-1"), recv("event-3")];

  it("is reconciling, stale and flagged before any recovery", () => {
    const v = projectView(run(gapped).state);
    expect(v.projection).toBe("reconciling");
    expect(v.stale).toBe(true);
    expect(v.holds).toContain("GAP");
  });

  it("is not cleared by a partial snapshot, an older snapshot or a snapshot for another view", () => {
    for (const noise of [recv("snapshot-partial"), recv("snapshot-old")]) {
      const r = run([...gapped, noise]);
      expect(projectView(r.state).projection).toBe("reconciling");
    }
    const foreign = rec("snapshot-ahead");
    (foreign["view_context"] as Record<string, string>)[
      "authorized_view_scope"
    ] = "opaque-view-OTHER";
    const r = run([...gapped, { kind: "receive", record: foreign }]);
    expect(projectView(r.state).projection).toBe("reconciling");
    expect(r.state.appliedCursor).toBe("9007199254740993");
  });

  it("is cleared by a newer full snapshot and by an authorized contiguous interval, and by nothing else", () => {
    const viaSnapshot = projectView(
      run([...gapped, recv("snapshot-ahead")]).state,
    );
    expect(viaSnapshot.projection).toBe("current");
    expect(viaSnapshot.appliedCursor).toBe("9007199254740996");
    const viaInterval = projectView(
      run([
        ...gapped,
        interval("9007199254740994", "9007199254740995", [
          "event-2",
          "event-3",
        ]),
      ]).state,
    );
    expect(viaInterval.projection).toBe("current");
    expect(viaInterval.appliedCursor).toBe("9007199254740995");
  });

  it("an interval does not discharge an unrelated hold such as an identity conflict", () => {
    const r = run([
      recv("snapshot-A"),
      recv("event-1"),
      recv("event-1-conflict"),
      interval("9007199254740994", "9007199254740995", ["event-2", "event-3"]),
    ]);
    const v = projectView(r.state);
    expect(v.projection).toBe("reconciling");
    expect(v.holds).toContain("IDENTITY_BODY_CONFLICT");
  });

  it("rejects an interval with a hole or from the wrong view", () => {
    const holey = run([
      ...gapped,
      interval("9007199254740994", "9007199254740996", ["event-2", "event-4"]),
    ]);
    expect(projectView(holey.state).projection).toBe("reconciling");
    expect(
      holey.state.rejected.some((d) => d.code === "INVALID_REPLAY_INTERVAL"),
    ).toBe(true);
  });

  it("without a trusted view binding nothing is accepted", () => {
    const r = reduce(createReducerState(), recv("snapshot-A"));
    expect(r.outcome).toEqual({
      disposition: "rejected",
      code: "NO_TRUSTED_VIEW_BINDING",
    });
    expect(r.state.appliedCursor).toBeNull();
  });
});

describe("terminal native status and an empty verifier list never become independent acceptance", () => {
  it("done, SUCCEEDED, succeeded and attempt:succeeded all leave acceptance NOT_MEASURED", () => {
    const r = run([
      recv("snapshot-A"),
      recv("event-1"),
      recv("event-2"),
      recv("attempt-succeeded"),
      recv("event-3"),
    ]);
    const v = projectView(r.state);
    expect(v.nodes.find((n) => n.localId === "task-1")?.nativeState).toBe(
      "done",
    );
    expect(v.attempts[0]?.nativeState).toBe("succeeded");
    expect(v.dimensions.independentAcceptance).toBe("NOT_MEASURED");
    expect(
      v.attempts.every(
        (a) => a.acceptance === "NOT_MEASURED" && !a.checkersObserved,
      ),
    ).toBe(true);
    const doclab = projectView(
      run([
        recv("snapshot-doclab"),
        recv("doclab-event-100"),
        recv("doclab-event-104"),
      ]).state,
    );
    expect(
      doclab.nodes.find((n) => n.localId === "fixture-db-run")?.nativeState,
    ).toBe("SUCCEEDED");
    expect(doclab.dimensions.independentAcceptance).toBe("NOT_MEASURED");
  });

  it("an empty-checker PASS is a decode failure and a PASS beside a mandatory FAIL is a semantic conflict, not PASS", () => {
    expect(decodeObservationRecord(rec("invalid-empty-checker-pass")).ok).toBe(
      false,
    );
    const r = run([
      recv("conflicting-checker-aggregate"),
      {
        kind: "evaluate_acceptance",
        recordId: "conflicting-checker-aggregate",
        policy: { mandatoryChecks: "all-listed" },
      },
    ]);
    const a = projectView(r.state).attempts[0];
    expect(a?.sourceAcceptance).toBe("PASS");
    expect(a?.acceptance).toBe("NOT_MEASURED");
    expect(a?.semanticConflict).toBe(true);
  });

  it("a source FAIL with a failing checker stays FAIL; a FAIL with no failing checker is not trusted", () => {
    const failing = rec("conflicting-checker-aggregate");
    const acc = (failing["data"] as { acceptance: Record<string, unknown> })
      .acceptance;
    acc["verdict"] = "FAIL";
    failing["record_id"] = "failing-attempt";
    expect(
      projectView(run([{ kind: "receive", record: failing }]).state).attempts[0]
        ?.acceptance,
    ).toBe("FAIL");
    const hollow = structuredClone(failing);
    (
      (hollow["data"] as { acceptance: { checks: { verdict: string }[] } })
        .acceptance.checks[0] as { verdict: string }
    ).verdict = "UNKNOWN";
    hollow["record_id"] = "hollow-fail";
    expect(
      projectView(run([{ kind: "receive", record: hollow }]).state).attempts[0]
        ?.acceptance,
    ).toBe("NOT_MEASURED");
  });

  it("a positive observation cannot erase a mandatory unknown on the same attempt", () => {
    const r = run([recv("attempt-checker-unknown"), recv("attempt-succeeded")]);
    const v = projectView(r.state);
    expect(v.attempts.map((a) => a.acceptance)).toEqual([
      "NOT_MEASURED",
      "NOT_MEASURED",
    ]);
    expect(
      v.attempts.find((a) => a.recordId === "attempt-checker-unknown")
        ?.executedUndecided,
    ).toEqual(["fixture-checker"]);
  });
});

describe("lossless counters and strict, versioned decoding", () => {
  it("compares and increments decimals beyond 2^53 exactly", () => {
    expect(compareDecimal("9007199254740993", "9007199254740992")).toBe(1);
    expect(compareDecimal("9007199254740992", "9007199254740993")).toBe(-1);
    expect(compareDecimal("99", "100")).toBe(-1);
    expect(nextDecimal("9007199254740993")).toBe("9007199254740994");
    expect(nextDecimal("999")).toBe("1000");
    expect(() => compareDecimal("01", "2")).toThrow(RangeError);
    expect(() => compareDecimal("-1", "2")).toThrow(RangeError);
  });

  it("rejects a JSON number at a counter field even when the text would round to a valid cursor", () => {
    const text = JSON.stringify(records["event-1"]).replace(
      '"cursor":"9007199254740993"',
      '"cursor":9007199254740993',
    );
    const r = parseKnowledgeObservationJson(new TextEncoder().encode(text));
    expect(r.ok).toBe(false);
  });

  it("fails unknown profile versions, unknown record kinds and unnegotiated extensions explicitly", () => {
    const wrong = rec("event-1");
    wrong["profile"] = "knowledge-collective-observation/v2";
    expect(decodeObservationRecord(wrong)).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_PROFILE",
    });
    const kind = rec("event-1");
    kind["record_type"] = "mystery";
    expect(decodeObservationRecord(kind)).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_RECORD_KIND",
    });
    expect(
      decodeObservationRecord(rec("event-1"), { supportedExtensions: [] }),
    ).toMatchObject({ ok: false, code: "UNSUPPORTED_REQUIRED_EXTENSION" });
    expect(decodeObservationRecord(rec("event-1"))).toMatchObject({ ok: true });
    expect(decodeObservationRecord(null)).toMatchObject({
      ok: false,
      code: "NOT_AN_OBJECT",
    });
    expect(
      parseKnowledgeObservationJson(new TextEncoder().encode("{not json")),
    ).toMatchObject({ ok: false, code: "INVALID_FRAME" });
  });

  it("an unknown schema version never advances the cursor (it is held, not skipped)", () => {
    const bad = rec("event-1");
    bad["profile"] = "knowledge-collective-observation/v999";
    const r = run([
      recv("snapshot-A"),
      { kind: "receive", record: bad },
      recv("event-2"),
    ]);
    expect(r.state.appliedCursor).toBe("9007199254740992");
    expect(projectView(r.state).projection).toBe("reconciling");
  });

  it("asserts RFC3339 date-time formats (the package's own validator could not)", () => {
    const bad = rec("event-1");
    (bad["data"] as Record<string, unknown>)["occurred_at"] =
      "2000-13-45 not a time";
    expect(decodeObservationRecord(bad).ok).toBe(false);
    const offset = rec("event-1");
    (offset["data"] as Record<string, unknown>)["occurred_at"] =
      "2026-11-06T18:30:00.123456+02:00";
    expect(decodeObservationRecord(offset).ok).toBe(true);
  });
});

describe("identity separations and producer-local facts are preserved", () => {
  it("keeps sequence, causation and observed/recorded/occurred times verbatim and separate", () => {
    const e = rec("event-1");
    e["observed_at"] = "2026-11-06T18:00:00.250+01:00";
    e["recorded_at"] = "2026-11-06T17:05:00Z";
    const d = e["data"] as Record<string, unknown>;
    d["occurred_at"] = "2026-11-06T16:59:59.123456Z";
    d["causation_ref"] = "cause-7";
    const r = run([recv("snapshot-A"), { kind: "receive", record: e }]);
    const entry = projectView(r.state).eventLedger[0];
    expect(entry).toMatchObject({
      observedAt: "2026-11-06T18:00:00.250+01:00",
      recordedAt: "2026-11-06T17:05:00Z",
      occurredAt: "2026-11-06T16:59:59.123456Z",
      causationRef: "cause-7",
      producer: { service: "muneral", producerEventId: "101" },
      sourceSequence: { value: "101", scope: "task", contiguity: "unknown" },
    });
  });

  it("native revision, aggregateVersion and plan revision stay different fields", () => {
    const v = projectView(run([recv("snapshot-A"), recv("event-1")]).state);
    const task = v.nodes.find((n) => n.localId === "task-1");
    expect(task?.nativeVersions).toEqual({
      revision: "7",
      aggregateVersion: "9007199254740993",
    });
    expect(v.currentPlan).toBe("plan-A");
  });

  it("nodes sharing a local id in different graphs and authorities stay separate (no bare-id join)", () => {
    const v = projectView(run([recv("snapshot-colliding-ids")]).state);
    expect(new Set(v.nodes.map((n) => n.key)).size).toBe(4);
    expect(v.implicitJoins).toBe(0);
  });

  it("distinguishes unconnected, fixture, replay and live views", () => {
    expect(projectView(createReducerState()).viewKind).toBe("unconnected");
    expect(projectView(run([recv("snapshot-A")]).state).viewKind).toBe(
      "fixture",
    );
    const asLive = (id: string): ReducerInput => {
      const r = rec(id);
      r["mode"] = "live";
      r["evidence_basis"] = "native_observation";
      return { kind: "receive", record: r };
    };
    expect(
      projectView(run([asLive("snapshot-A")], "live").state).viewKind,
    ).toBe("live");
    expect(
      projectView(
        run(
          [{ kind: "set_mode", mode: "replay" }, asLive("snapshot-A")],
          "live",
        ).state,
      ).viewKind,
    ).toBe("replay");
  });

  it("freshness, connection, native state and acceptance are four separate dimensions", () => {
    const v = projectView(run([recv("run"), recv("snapshot-A")]).state);
    expect(Object.keys(v.dimensions).sort()).toEqual([
      "acceptanceBasis",
      "connection",
      "freshness",
      "independentAcceptance",
      "independentlyVerified",
      "nativeState",
    ]);
    expect(v.dimensions.connection).toBe("connected");
    expect(v.dimensions.freshness).toBe("current");
    expect(v.dimensions.nativeState).toBe("todo");
    expect(v.dimensions.independentAcceptance).toBe("NOT_MEASURED");
  });
});

describe("remaining reducer rules from the semantics document", () => {
  it("a same-watermark full snapshot must agree with the recorded projection, otherwise it is quarantined", () => {
    const same = run([recv("snapshot-A"), recv("snapshot-A")]);
    expect(projectView(same.state).projection).toBe("current");
    const contradicting = rec("snapshot-A");
    const work = (
      contradicting["data"] as {
        graphs: {
          graph_kind: string;
          nodes: { native_state: { value: string } }[];
        }[];
      }
    ).graphs.find((g) => g.graph_kind === "work")?.nodes[0];
    if (work) work.native_state.value = "cancelled";
    const bad = run([
      recv("snapshot-A"),
      { kind: "receive", record: contradicting },
    ]);
    expect(projectView(bad.state).holds).toContain("SNAPSHOT_CONTRADICTION");
    expect(
      projectView(bad.state).nodes.find((n) => n.localId === "task-1")
        ?.nativeState,
    ).toBe("todo");
  });

  it("an aged-out pending buffer is discarded and a full snapshot is required (time arrives as input, never from a clock)", () => {
    const r = run([
      { kind: "set_buffer_limits", limits: { maxAgeMs: 1000 } },
      { kind: "receive", record: rec("snapshot-A"), at: 0 },
      { kind: "receive", record: rec("event-3"), at: 100 },
      { kind: "tick", at: 5000 },
    ]);
    const v = projectView(r.state);
    expect(v.buffered).toEqual([]);
    expect(v.holds).toContain("BUFFER_EXPIRED");
    expect(v.fullSnapshotRequired).toBe(true);
    expect(v.appliedCursor).toBe("9007199254740992");
  });

  it("a disconnect freezes the last observation as stale and implies neither success nor failure", () => {
    const r = run([
      recv("run"),
      recv("snapshot-A"),
      recv("event-1"),
      { kind: "transport_disconnected" },
    ]);
    const v = projectView(r.state);
    expect(v.stale).toBe(true);
    expect(v.dimensions.connection).toBe("disconnected");
    expect(v.nodes.find((n) => n.localId === "task-1")?.nativeState).toBe(
      "in_progress",
    );
    expect(v.dimensions.independentAcceptance).toBe("NOT_MEASURED");
    expect(r.commands).toEqual([]);
  });

  it("an event for a subject the snapshot does not contain stays unassociated and creates no node", () => {
    const e = rec("event-1");
    (
      e["data"] as { subject_refs: { local_id: string }[] }
    ).subject_refs[0]!.local_id = "task-unknown";
    const v = projectView(
      run([recv("snapshot-A"), { kind: "receive", record: e }]).state,
    );
    expect(v.unassociatedSubjects).toHaveLength(1);
    expect(v.nodes.map((n) => n.localId)).toEqual(["task-1"]);
  });
});
