/**
 * Reviewer-correction round (Agent-Brain PR #111 review, points 1, 2, 4, 7): refutation cases for the amendment-1
 * profile update. Each case states the old, wrong behaviour it refutes; `REPORT.md` records that these fail against
 * 99f3d83f and pass on the corrected head. Fixture values are synthetic.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/knowledge-observation-sha256.js";
import {
  classifyDoclabNativeShape,
  createReducerState,
  decodeObservationRecord,
  evaluateAcceptance,
  projectView,
  reduce,
  snapshotPageDigest,
  type PageSetManifest,
  type ReduceOutcome,
  type ReducerInput,
  type ReducerState,
  type ViewContext,
} from "./knowledge-observation.api.js";
import {
  bodies,
  caseMeta,
  records,
  sealManifest,
  splitPages,
} from "./knowledge-observation.harness.js";

const CTX = caseMeta.default_view_context as ViewContext;
const rec = (id: string): Record<string, unknown> =>
  structuredClone(records[id]) as Record<string, unknown>;
const recv = (record: unknown, at?: number): ReducerInput =>
  at === undefined
    ? { kind: "receive", record }
    : { kind: "receive", record, at };
const manifestIn = (manifest: PageSetManifest): ReducerInput => ({
  kind: "trusted_page_set_manifest",
  manifest,
});

interface Stepped {
  state: ReducerState;
  outcomes: ReduceOutcome[];
}
function play(
  inputs: ReducerInput[],
  options: Parameters<typeof createReducerState>[0] = { mode: "fixture" },
): Stepped {
  let state = createReducerState(options);
  const outcomes: ReduceOutcome[] = [];
  for (const input of [
    { kind: "bind_trusted_projection", viewContext: CTX } as ReducerInput,
    ...inputs,
  ]) {
    const r = reduce(state, input);
    state = r.state;
    outcomes.push(r.outcome);
  }
  return { state, outcomes: outcomes.slice(1) };
}
const last = (s: Stepped): ReduceOutcome =>
  s.outcomes[s.outcomes.length - 1] as ReduceOutcome;

/* -------------------------------------------------------------------------------------------------------------- */
describe("point 1 — a source FAIL is representable without aggregate PASS decision refs", () => {
  const failing = (): Record<string, unknown> => {
    const r = rec("conflicting-checker-aggregate");
    r["record_id"] = "failing-attempt";
    const acc = (r["data"] as { acceptance: Record<string, unknown> })
      .acceptance;
    acc["verdict"] = "FAIL";
    acc["decision_evidence_ref"] = null;
    acc["decision_policy_ref"] = null;
    return r;
  };

  it("decodes a FAIL with an actual failing checker and null decision refs", () => {
    const result = decodeObservationRecord(failing());
    expect(result.ok, result.ok ? "" : JSON.stringify(result)).toBe(true);
  });

  it("keeps the checked grounds, subject and revision mandatory for FAIL", () => {
    for (const mutate of [
      (a: Record<string, unknown>) => {
        a["checks"] = [];
      },
      (a: Record<string, unknown>) => {
        (a["observation"] as Record<string, unknown>)["grounds"] = [];
      },
      (a: Record<string, unknown>) => {
        (a["observation"] as Record<string, unknown>)["subject_ref"] = null;
      },
      (a: Record<string, unknown>) => {
        (a["observation"] as Record<string, unknown>)["subject_revision"] =
          null;
      },
    ]) {
      const r = failing();
      mutate((r["data"] as { acceptance: Record<string, unknown> }).acceptance);
      expect(decodeObservationRecord(r).ok).toBe(false);
    }
  });

  it("still requires BOTH decision refs for an aggregate PASS", () => {
    for (const field of ["decision_evidence_ref", "decision_policy_ref"]) {
      const r = rec("conflicting-checker-aggregate");
      (r["data"] as { acceptance: Record<string, unknown> }).acceptance[field] =
        null;
      expect(decodeObservationRecord(r).ok, field).toBe(false);
    }
  });

  it("labels a decoded source FAIL as an unverified source observation, never as independently verified", () => {
    const r = play([recv(failing())]);
    const attempt = projectView(r.state).attempts[0];
    expect(attempt?.acceptance).toBe("FAIL"); // fail closed
    expect(attempt?.acceptanceBasis).toBe("source_fail_unverified");
    const ev = evaluateAcceptance(
      (failing()["data"] as { acceptance: never }).acceptance,
    );
    expect(ev.independentlyVerified).toBe(false);
    expect(ev.basis).toBe("source_fail_unverified");
  });

  it("a FAIL whose checkers include no failing observation is not even an unverified FAIL", () => {
    const r = failing();
    const checks = (
      r["data"] as { acceptance: { checks: { verdict: string }[] } }
    ).acceptance.checks;
    for (const c of checks) c.verdict = "UNKNOWN";
    const a = projectView(play([recv(r)]).state).attempts[0];
    expect(a?.acceptance).toBe("NOT_MEASURED");
    expect(a?.acceptanceBasis).toBe("none");
  });

  it("a snapshot-level view dimension never marks a source FAIL as verified", () => {
    const v = projectView(play([recv(rec("snapshot-A"))]).state);
    expect(v.dimensions.independentlyVerified).toBe(false);
    expect(v.dimensions.acceptanceBasis).toBe("none");
  });
});

/* -------------------------------------------------------------------------------------------------------------- */
describe("point 2 — pages become current only with an adapter-verified immutable page-set proof", () => {
  const bootstrap = recv(rec("snapshot-A"));

  it("REFUTES the old gate: a v1-shaped final page (token null, complete, every graph kind present) is not proof", () => {
    const only = rec("snapshot-colliding-ids");
    only["record_id"] = "lonely-final-page";
    (only["data"] as { snapshot_kind: string }).snapshot_kind = "partial";
    const r = play([recv(only)]);
    expect(projectView(r.state).projection).toBe("awaiting_snapshot");
    expect(r.state.appliedCursor).toBeNull();
    expect(projectView(r.state).nodes).toEqual([]);
    expect(last(r)).toMatchObject({
      disposition: "quarantined",
      code: "PAGE_SET_PROOF_MISSING",
    });
  });

  it("REFUTES the old gate on the exact reviewed shape: v1-shaped pages 1 and 3 of 3 (middle missing) must not install current", () => {
    const v1Shaped = splitPages("snapshot-colliding-ids", 3).map((p) => {
      delete (p["data"] as { coverage: Record<string, unknown> }).coverage[
        "page_set"
      ];
      return p;
    });
    const r = play([recv(v1Shaped[0]), recv(v1Shaped[2])]);
    expect(projectView(r.state).projection).toBe("awaiting_snapshot");
    expect(r.state.appliedCursor).toBeNull();
    expect(projectView(r.state).nodes).toEqual([]);
    expect(last(r)).toMatchObject({ code: "PAGE_SET_PROOF_MISSING" });
  });

  it("after bootstrap an unproven page keeps the last trusted projection and marks reconciliation", () => {
    const only = rec("snapshot-ahead");
    (only["data"] as { snapshot_kind: string }).snapshot_kind = "partial";
    const r = play([bootstrap, recv(only)]);
    const v = projectView(r.state);
    expect(v.projection).toBe("reconciling");
    expect(v.appliedCursor).toBe("9007199254740992");
    expect(r.state.holds).toContain("PAGE_SET_UNPROVEN");
  });

  it("REFUTES the missing middle page: the first and last page of three never install `current`", () => {
    const pages = splitPages("snapshot-colliding-ids", 3);
    const manifest = sealManifest(pages);
    const r = play([manifestIn(manifest), recv(pages[0]), recv(pages[2])]);
    expect(projectView(r.state).projection).toBe("awaiting_snapshot");
    expect(r.state.appliedCursor).toBeNull();
    expect(projectView(r.state).nodes).toEqual([]);
    expect(last(r)).toMatchObject({ code: "PARTIAL_PAGE_PENDING" });
    // the middle page then completes it: exactly the full snapshot's projection
    const done = play([
      manifestIn(manifest),
      recv(pages[0]),
      recv(pages[2]),
      recv(pages[1]),
    ]);
    const whole = play([recv(rec("snapshot-colliding-ids"))]);
    expect(projectView(done.state).projection).toBe("current");
    expect(projectView(done.state).nodes).toEqual(
      projectView(whole.state).nodes,
    );
    expect(projectView(done.state).crosslinks).toEqual(
      projectView(whole.state).crosslinks,
    );
    expect(done.state.appliedCursor).toBe(whole.state.appliedCursor);
    expect(last(done)).toMatchObject({ code: "PAGES_ASSEMBLED" });
  });

  it("a missing page leaves an existing view untouched", () => {
    const pages = splitPages("snapshot-ahead", 3);
    const r = play([
      bootstrap,
      manifestIn(sealManifest(pages)),
      recv(pages[0]),
      recv(pages[2]),
    ]);
    expect(r.state.appliedCursor).toBe("9007199254740992");
    expect(projectView(r.state).projection).toBe("current");
  });

  it("all pages without a trusted manifest stay pending; the manifest completes them in either order", () => {
    const pages = splitPages("snapshot-colliding-ids", 2);
    const noProof = play([recv(pages[0]), recv(pages[1])]);
    expect(projectView(noProof.state).projection).toBe("awaiting_snapshot");
    expect(last(noProof)).toMatchObject({ code: "PAGE_SET_MANIFEST_PENDING" });
    const late = play([
      recv(pages[0]),
      recv(pages[1]),
      manifestIn(sealManifest(pages)),
    ]);
    expect(projectView(late.state).projection).toBe("current");
    const early = play([
      manifestIn(sealManifest(pages)),
      recv(pages[1]),
      recv(pages[0]),
    ]);
    expect(projectView(early.state).nodes).toEqual(
      projectView(late.state).nodes,
    );
  });

  it("a duplicate page is idempotent when identical and a conflict when its bytes differ", () => {
    const pages = splitPages("snapshot-colliding-ids", 2);
    const manifest = sealManifest(pages);
    const same = play([
      manifestIn(manifest),
      recv(pages[0]),
      recv(pages[0]),
      recv(pages[1]),
    ]);
    expect(projectView(same.state).projection).toBe("current");
    expect(same.outcomes[2]).toMatchObject({
      code: "PAGE_DUPLICATE_IDENTICAL",
    });
    const altered = structuredClone(pages[0]) as {
      data: { graphs: { graph_revision: string }[] };
    };
    (altered.data.graphs[0] as { graph_revision: string }).graph_revision =
      "other-revision";
    const conflict = play([bootstrap, recv(pages[0]), recv(altered)]);
    expect(conflict.state.holds).toContain("PAGE_ASSEMBLY_INVALID");
    expect(conflict.state.fullSnapshotRequired).toBe(true);
    expect(conflict.state.pages).toBeNull();
  });

  it("a foreign page (altered content, other set, wrong ordinal or count) never completes the set", () => {
    const pages = splitPages("snapshot-colliding-ids", 2);
    const manifest = sealManifest(pages);
    // altered content: digest differs from the sealed entry
    const forged = structuredClone(pages[1]) as {
      data: { graphs: { nodes: { node_type: string }[] }[] };
    };
    (forged.data.graphs[0] as { nodes: { node_type: string }[] }).nodes[0] = {
      ...(forged.data.graphs[0] as { nodes: { node_type: string }[] }).nodes[0],
      node_type: "other",
    } as { node_type: string };
    const tampered = play([
      bootstrap,
      manifestIn(manifest),
      recv(pages[0]),
      recv(forged),
    ]);
    expect(tampered.state.holds).toContain("PAGE_SET_MISMATCH");
    expect(tampered.state.fullSnapshotRequired).toBe(true);
    expect(tampered.state.appliedCursor).toBe("9007199254740992");
    // a page from another page set under the same watermark
    const foreign = splitPages("snapshot-colliding-ids", 2, "some-other-set");
    const mixed = play([bootstrap, recv(pages[0]), recv(foreign[1])]);
    expect(mixed.state.holds).toContain("PAGE_ASSEMBLY_INVALID");
    // an ordinal outside the declared count, and a count that disagrees with the pending set
    const outOfRange = structuredClone(pages[0]) as {
      data: { coverage: { page_set: { page_index: string } } };
    };
    outOfRange.data.coverage.page_set.page_index = "2";
    expect(play([bootstrap, recv(outOfRange)]).state.holds).toContain(
      "PAGE_ASSEMBLY_INVALID",
    );
    const recount = structuredClone(pages[1]) as {
      data: { coverage: { page_set: { page_count: string } } };
    };
    recount.data.coverage.page_set.page_count = "3";
    expect(
      play([bootstrap, recv(pages[0]), recv(recount)]).state.holds,
    ).toContain("PAGE_ASSEMBLY_INVALID");
  });

  it("a manifest for another watermark, plan, snapshot ref or page count refuses the set", () => {
    const pages = splitPages("snapshot-colliding-ids", 2);
    const good = sealManifest(pages);
    for (const override of [
      { watermark: "9007199254740995" },
      { planRevision: "plan-B" },
      { trustedSnapshotRef: "other-snapshot-ref" },
      { pageCount: 3 },
    ] as Partial<PageSetManifest>[]) {
      const bad = { ...good, ...override } as PageSetManifest;
      const r = play([
        bootstrap,
        recv(pages[0]),
        recv(pages[1]),
        manifestIn(bad),
      ]);
      const v = projectView(r.state);
      expect(r.state.appliedCursor, JSON.stringify(override)).toBe(
        "9007199254740992",
      );
      expect(v.nodes.map((n) => n.localId)).not.toContain("node-1-extra");
      expect(
        ["INVALID_PAGE_SET_MANIFEST", "PAGE_SET_MISMATCH"].some(
          (c) => last(r).code === c || r.state.holds.includes(c as never),
        ),
        JSON.stringify(override),
      ).toBe(true);
    }
  });

  it("a manifest is accepted only through the trusted input, for the bound view, with sound arithmetic", () => {
    const pages = splitPages("snapshot-colliding-ids", 2);
    const good = sealManifest(pages);
    const reject = (m: PageSetManifest): string | null =>
      play([manifestIn(m)]).outcomes[0]?.code ?? null;
    expect(reject(good)).toBeNull();
    expect(
      reject({
        ...good,
        viewContext: { ...CTX, stream_epoch: "epoch-other" },
      }),
    ).toBe("INVALID_PAGE_SET_MANIFEST");
    expect(reject({ ...good, totalBytes: good.totalBytes + 1 })).toBe(
      "INVALID_PAGE_SET_MANIFEST",
    );
    expect(reject({ ...good, pages: [good.pages[0] as never] })).toBe(
      "INVALID_PAGE_SET_MANIFEST",
    );
    expect(
      reject({
        ...good,
        pages: [good.pages[0] as never, good.pages[0] as never],
      }),
    ).toBe("INVALID_PAGE_SET_MANIFEST");
    expect(
      reject({
        ...good,
        pages: good.pages.map((p) => ({ ...p, sha256: "xyz" })),
      }),
    ).toBe("INVALID_PAGE_SET_MANIFEST");
    // a manifest embedded in a page payload grants nothing: the decoder rejects the unknown field
    const smuggled = structuredClone(pages[0]) as {
      data: { coverage: Record<string, unknown> };
    };
    smuggled.data.coverage["manifest"] = good;
    expect(decodeObservationRecord(smuggled).ok).toBe(false);
    // the same ref sealed twice with different bytes is a conflict, never last-writer-wins
    const conflict = play([
      manifestIn(good),
      manifestIn({ ...good, adapterRef: "adapter:someone-else" }),
    ]);
    expect(last(conflict)).toMatchObject({
      disposition: "quarantined",
      code: "PAGE_SET_MANIFEST_CONFLICT",
    });
  });

  it("incoherent ordinals and tokens are refused (last ordinal with a next token, early page without one)", () => {
    const pages = splitPages("snapshot-colliding-ids", 2);
    const lastWithToken = structuredClone(pages[1]) as {
      data: { coverage: { next_page_token: string | null } };
    };
    lastWithToken.data.coverage.next_page_token = "page-3";
    expect(play([recv(pages[0]), recv(lastWithToken)]).state.pages).toBeNull();
    const earlyFinal = structuredClone(pages[0]) as {
      data: { coverage: { next_page_token: string | null; complete: boolean } };
    };
    earlyFinal.data.coverage.next_page_token = null;
    earlyFinal.data.coverage.complete = true;
    const r = play([bootstrap, recv(earlyFinal)]);
    expect(r.state.holds).toContain("PAGE_ASSEMBLY_INVALID");
    expect(r.state.appliedCursor).toBe("9007199254740992");
  });

  it("a declared graph kind that never arrives refuses even a fully sealed set", () => {
    const pages = splitPages("snapshot-colliding-ids", 2);
    for (const p of pages) {
      const d = p["data"] as { graphs: { graph_kind: string }[] };
      d.graphs = d.graphs.filter((g) => g.graph_kind !== "knowledge");
    }
    const r = play([
      bootstrap,
      manifestIn(sealManifest(pages)),
      recv(pages[0]),
      recv(pages[1]),
    ]);
    expect(r.state.holds).toContain("PAGE_ASSEMBLY_INVALID");
    expect(r.state.appliedCursor).toBe("9007199254740992");
  });

  it("pages and the pending set are bounded in count and age", () => {
    const pages = splitPages("snapshot-colliding-ids", 3);
    expect(
      play([bootstrap, recv(pages[0]), recv(pages[1])], {
        mode: "fixture",
        limits: { maxPages: 1 },
      }).state.holds,
    ).toContain("PAGE_ASSEMBLY_LIMIT_EXCEEDED");
    const aged = play([bootstrap, recv(pages[0], 0), recv(pages[1], 1000)], {
      mode: "fixture",
      limits: { maxAgeMs: 100 },
    });
    expect(aged.state.holds).toContain("PAGE_ASSEMBLY_LIMIT_EXCEEDED");
  });

  it("a page set never discharges a gap, even sealed and complete but for its last page", () => {
    const pages = splitPages("snapshot-ahead", 2);
    const r = play([
      bootstrap,
      recv(rec("event-1")),
      recv(rec("event-3")),
      manifestIn(sealManifest(pages)),
      recv(pages[0]),
    ]);
    expect(projectView(r.state).projection).toBe("reconciling");
    expect(r.state.appliedCursor).toBe("9007199254740993");
  });

  it("the page digest is the canonical sha256 of the decoded page and agrees with the platform implementation", () => {
    const page = splitPages("snapshot-colliding-ids", 2)[0];
    const digest = snapshotPageDigest(page);
    expect(digest).not.toBeNull();
    const decoded = decodeObservationRecord(page);
    if (!decoded.ok) throw new Error("page must decode");
    const canon = JSON.stringify(sortKeys(decoded.record));
    expect(digest?.sha256).toBe(
      createHash("sha256").update(canon, "utf8").digest("hex"),
    );
    expect(digest?.byteSize).toBe(new TextEncoder().encode(canon).length);
    expect(snapshotPageDigest({ not: "a record" })).toBeNull();
  });

  it("sha256 matches node:crypto across block boundaries and non-ASCII input", () => {
    for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const text = "a".repeat(n);
      expect(sha256Hex(text), `len ${n}`).toBe(
        createHash("sha256").update(text, "utf8").digest("hex"),
      );
    }
    const uni = "проверка — ✓ 𝔘𝔫𝔦";
    expect(sha256Hex(uni)).toBe(
      createHash("sha256").update(uni, "utf8").digest("hex"),
    );
  });
});

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (typeof v === "object" && v !== null)
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  return v;
}

/* -------------------------------------------------------------------------------------------------------------- */
describe("point 4 — a verified contiguous same-view replay interval recovers a gap; expiry and overflow still need a full snapshot", () => {
  const A = recv(rec("snapshot-A"));
  const replay = (
    from: string,
    through: string,
    ids: string[],
  ): ReducerInput => ({
    kind: "trusted_replay_interval",
    fromCursor: from,
    throughCursor: through,
    records: ids.map((id) => rec(id)),
    coverageRef: "coverage:test-interval",
  });

  it("REFUTES `any hold demands a full snapshot`: gap, pending page, then a verified interval ends current", () => {
    const pages = splitPages("snapshot-ahead", 2);
    const r = play([
      A,
      recv(rec("event-3")), // out of order: GAP
      manifestIn(sealManifest(pages)),
      recv(pages[0]), // a pending proven page arrives while the gap is outstanding
    ]);
    expect(r.state.holds).toContain("GAP");
    expect(r.state.fullSnapshotRequired).toBe(false);
    const recovered = play([
      A,
      recv(rec("event-3")),
      manifestIn(sealManifest(pages)),
      recv(pages[0]),
      replay("9007199254740993", "9007199254740994", ["event-1", "event-2"]),
    ]);
    expect(recovered.state.holds).toEqual([]);
    expect(recovered.state.fullSnapshotRequired).toBe(false);
    expect(projectView(recovered.state).projection).toBe("current");
    expect(recovered.state.appliedCursor).toBe("9007199254740995");
  });

  it("REFUTES the old flag on the v1 wire: a v1-shaped partial page during a gap does not by itself demand a full snapshot", () => {
    const r = play([
      A,
      recv(rec("event-3")),
      recv(rec("snapshot-partial")),
      replay("9007199254740993", "9007199254740994", ["event-1", "event-2"]),
    ]);
    // the interval cleared the GAP; the unproven page keeps its own hold (frozen, reconciling) but is not a full-snapshot demand
    expect(r.state.holds).not.toContain("GAP");
    expect(r.state.holds).toContain("PAGE_SET_UNPROVEN");
    expect(r.state.fullSnapshotRequired).toBe(false);
    expect(projectView(r.state).projection).toBe("reconciling");
  });

  it("overflow cannot be recovered by an interval: it keeps demanding a full snapshot", () => {
    const r = play(
      [
        A,
        recv(rec("event-3")),
        recv(rec("event-1")),
        recv(rec("event-2")),
        { kind: "tick", at: 10_000_000 },
        replay("9007199254740993", "9007199254740994", ["event-1", "event-2"]),
      ],
      { mode: "fixture", limits: { maxRecords: 1, maxAgeMs: 10 } },
    );
    expect(r.state.fullSnapshotRequired).toBe(true);
    expect(projectView(r.state).projection).toBe("reconciling");
  });

  it("an expired buffer, a trusted reset and a revocation each still require a full snapshot", () => {
    const expired = play(
      [A, recv(rec("event-3"), 0), { kind: "tick", at: 60_000 }],
      { mode: "fixture", limits: { maxAgeMs: 100 } },
    );
    expect(expired.state.holds).toContain("BUFFER_EXPIRED");
    expect(expired.state.fullSnapshotRequired).toBe(true);
    const revoked = play([
      A,
      { kind: "trusted_authorization_revoked", viewContext: CTX },
    ]);
    expect(revoked.state.fullSnapshotRequired).toBe(true);
    expect(projectView(revoked.state).projection).toBe("cleared");
  });
});

/* -------------------------------------------------------------------------------------------------------------- */
describe("point 7 — same-watermark equality compares the complete authorized projection", () => {
  type Snap = {
    record_id: string;
    data: {
      plan_revision: string | null;
      acceptance: { reason: string | null };
      source_revisions: { versions: Record<string, string> }[];
      allowed_actions_observation: unknown[];
      graphs: {
        graph_kind: string;
        graph_revision: string;
        nodes: Record<string, unknown>[];
        edges: Record<string, unknown>[];
      }[];
      crosslinks: { evidence_refs: string[] }[];
    };
  };
  const ref = (kind: string, id: string, authority: string): unknown => ({
    graph_kind: kind,
    authority,
    namespace: "fixture-project",
    local_id: id,
    revision: null,
  });
  const edgeBetween = (id: string, kind = "uses"): Record<string, unknown> => ({
    edge_id: id,
    kind,
    from: ref("work", "node-1", "muneral"),
    to: ref("work", "node-1", "muneral"),
    evidence_refs: ["fixture:edge"],
  });
  const base = (): Snap => {
    const s = rec("snapshot-colliding-ids") as unknown as Snap;
    (
      s.data.graphs.find(
        (g) => g.graph_kind === "work",
      ) as Snap["data"]["graphs"][number]
    ).edges.push(edgeBetween("edge-1"));
    return s;
  };
  const mutants: Record<string, (s: Snap) => void> = {
    "added edge": (s) => {
      (s.data.graphs[0] as Snap["data"]["graphs"][number]).edges.push(
        edgeBetween("edge-2"),
      );
    },
    "changed edge kind": (s) => {
      (
        (
          s.data.graphs.find(
            (g) => g.graph_kind === "work",
          ) as Snap["data"]["graphs"][number]
        ).edges[0] as { kind: string }
      ).kind = "depends_on";
    },
    "omitted edge": (s) => {
      (
        s.data.graphs.find(
          (g) => g.graph_kind === "work",
        ) as Snap["data"]["graphs"][number]
      ).edges = [];
    },
    "omitted node": (s) => {
      (
        s.data.graphs.find(
          (g) => g.graph_kind === "processing_execution",
        ) as Snap["data"]["graphs"][number]
      ).nodes = [];
    },
    "extra node": (s) => {
      const g = s.data.graphs.find(
        (x) => x.graph_kind === "work",
      ) as Snap["data"]["graphs"][number];
      const copy = structuredClone(g.nodes[0]) as { ref: { local_id: string } };
      copy.ref.local_id = "node-extra";
      g.nodes.push(copy);
    },
    "changed node native state": (s) => {
      const n = (
        s.data.graphs.find(
          (x) => x.graph_kind === "work",
        ) as Snap["data"]["graphs"][number]
      ).nodes[0] as { native_state: { value: string } };
      n.native_state.value = "doing";
    },
    "changed node acceptance": (s) => {
      const n = (
        s.data.graphs.find(
          (x) => x.graph_kind === "work",
        ) as Snap["data"]["graphs"][number]
      ).nodes[0] as { acceptance: { reason: string } };
      n.acceptance.reason = "A different, one-bit-changed reason.";
    },
    "changed graph revision": (s) => {
      (s.data.graphs[0] as Snap["data"]["graphs"][number]).graph_revision =
        "fixture-graph-2";
    },
    "changed plan revision": (s) => {
      s.data.plan_revision = "plan-B";
    },
    "changed top-level acceptance": (s) => {
      s.data.acceptance.reason = "changed";
    },
    "changed source revision": (s) => {
      (
        s.data.source_revisions[0] as { versions: Record<string, string> }
      ).versions["revision"] = "8";
    },
    "changed crosslink evidence": (s) => {
      (s.data.crosslinks[0] as { evidence_refs: string[] }).evidence_refs = [
        "fixture:other-evidence",
      ];
    },
    "removed crosslink": (s) => {
      s.data.crosslinks = [];
    },
  };

  for (const [name, mutate] of Object.entries(mutants)) {
    it(`REFUTES the overlap-only check: ${name} at the same watermark is quarantined`, () => {
      const variant = base();
      variant.record_id = `mutant-${name.replaceAll(" ", "-")}`;
      mutate(variant);
      expect(decodeObservationRecord(variant).ok, name).toBe(true);
      const r = play([recv(base()), recv(variant)]);
      expect(last(r), name).toMatchObject({
        disposition: "quarantined",
        code: "SNAPSHOT_CONTRADICTION",
      });
      expect(r.state.holds).toContain("SNAPSHOT_CONTRADICTION");
      expect(projectView(r.state).projection).toBe("reconciling");
    });
  }

  it("an identical re-capture is consistent even with other record id, ordering and capture metadata", () => {
    const again = base();
    again.record_id = "recapture";
    again.data.graphs.reverse();
    for (const g of again.data.graphs) g.nodes.reverse();
    (again as unknown as { observed_at: string }).observed_at =
      "2000-01-01T00:00:09Z";
    const r = play([recv(base()), recv(again)]);
    expect(last(r)).toMatchObject({
      disposition: "ignored",
      code: "SAME_WATERMARK_CONSISTENT",
    });
    expect(r.state.holds).toEqual([]);
  });

  it("events applied after the snapshot are part of the recorded projection a same-watermark capture is compared against", () => {
    const a = recv(rec("snapshot-A"));
    const withEvent = play([a, recv(rec("event-1"))]);
    // a re-capture of the ORIGINAL snapshot (watermark 0992) is now older than the applied cursor, hence history only
    const r = play([a, recv(rec("event-1")), recv(rec("snapshot-A"))]);
    expect(withEvent.state.appliedCursor).toBe("9007199254740993");
    expect(last(r)).toMatchObject({ disposition: "historical" });
  });
});

/* -------------------------------------------------------------------------------------------------------------- */
describe("points 3, 5, 6, 8, 9, 10 — confirmed behaviour pinned by direct tests", () => {
  it("3: the B2 discriminator needs all four native conditions; the reducer itself never asserts it", () => {
    const native = JSON.parse(
      (bodies["b2-native-shape"] as { bytes_utf8: string }).bytes_utf8,
    ) as { events: unknown[]; run: { profile: string } };
    expect(classifyDoclabNativeShape(native).shape).toBe(
      "b2_finished_converted_text",
    );
    const noEvent = { ...native, events: [] };
    expect(classifyDoclabNativeShape(noEvent).shape).not.toBe(
      "b2_finished_converted_text",
    );
    const profileNameOnly = {
      run: native.run,
      stage_tasks: [{ id: "x" }],
      stage_attempts: [],
      events: native.events,
    };
    expect(classifyDoclabNativeShape(profileNameOnly).shape).not.toBe(
      "b2_finished_converted_text",
    );
    const keys = Object.keys(
      projectView(play([recv(rec("snapshot-b2"))]).state),
    );
    expect(keys.filter((k) => /b2/i.test(k))).toEqual([]);
  });

  it("5: only an otherwise identical binding with another epoch is UNTRUSTED_EPOCH_CHANGE; any other mismatch is opaque", () => {
    const epoch = rec("snapshot-A");
    (epoch["view_context"] as { stream_epoch: string }).stream_epoch =
      "epoch-other";
    const e = play([recv(rec("snapshot-A")), recv(epoch)]);
    expect(last(e)).toMatchObject({ code: "UNTRUSTED_EPOCH_CHANGE" });
    const other = rec("snapshot-A");
    (other["view_context"] as { run_id: string }).run_id = "run-other";
    const o = play([recv(rec("snapshot-A")), recv(other)]);
    expect(last(o)).toMatchObject({ code: "OPAQUE_VIEW_BINDING_MISMATCH" });
    expect(o.state.holds).toEqual([]);
    expect(o.state.rejected.map((d) => d.recordId)).toEqual([]);
  });

  it("6: malformed input before the first trusted snapshot stays awaiting_snapshot with no fabricated view; afterwards the view is preserved", () => {
    const junk = { profile: "knowledge-collective-observation/v1" };
    const pre = play([recv(junk)]);
    expect(projectView(pre.state).projection).toBe("awaiting_snapshot");
    expect(pre.state.view).toBeNull();
    expect(pre.state.holds).toEqual([]);
    const post = play([recv(rec("snapshot-A")), recv(junk)]);
    expect(projectView(post.state).projection).toBe("reconciling");
    expect(post.state.appliedCursor).toBe("9007199254740992");
    expect(projectView(post.state).nodes.length).toBeGreaterThan(0);
  });

  it("8: no effective aggregate PASS from a source PASS; a disconnect freezes and stales without inferring worker state", () => {
    const pass = play([recv(rec("conflicting-checker-aggregate"))]);
    const a = projectView(pass.state).attempts[0];
    expect(a?.sourceAcceptance).toBe("PASS");
    expect(a?.acceptance).toBe("NOT_MEASURED");
    const before = projectView(play([recv(rec("snapshot-A"))]).state);
    const after = projectView(
      play([recv(rec("snapshot-A")), { kind: "transport_disconnected" }]).state,
    );
    expect(after.stale).toBe(true);
    expect(after.dimensions.connection).toBe("disconnected");
    expect(after.dimensions.nativeState).toBe(before.dimensions.nativeState);
    expect(after.dimensions.independentAcceptance).toBe("NOT_MEASURED");
  });

  it("9: `proposed` is a site presentation mode, not a transport mode or a wire record kind", () => {
    const proposed = rec("snapshot-A");
    proposed["mode"] = "proposed";
    expect(decodeObservationRecord(proposed).ok).toBe(false);
    const kinds = new Set(
      ["unconnected", "fixture", "replay", "live"].map(String),
    );
    for (const id of ["snapshot-A", "run"]) {
      expect(kinds.has(projectView(play([recv(rec(id))]).state).viewKind)).toBe(
        true,
      );
    }
    const recordKind = rec("snapshot-A");
    recordKind["record_type"] = "proposed";
    expect(decodeObservationRecord(recordKind).ok).toBe(false);
  });

  it("10: RFC 3339 date-time accepts T and t, rejects a space, and keeps offset and fractional precision", () => {
    for (const [stamp, ok] of [
      ["2000-01-01T00:00:00Z", true],
      ["2000-01-01t00:00:00z", true],
      ["2000-01-01 00:00:00Z", false],
    ] as const) {
      const r = rec("snapshot-A");
      r["observed_at"] = stamp;
      expect(decodeObservationRecord(r).ok, stamp).toBe(ok);
    }
    const precise = rec("snapshot-A");
    precise["observed_at"] = "2000-01-01T03:00:00.123456+03:00";
    const decoded = decodeObservationRecord(precise);
    expect(decoded.ok && decoded.record.observed_at).toBe(
      "2000-01-01T03:00:00.123456+03:00",
    );
  });
});
