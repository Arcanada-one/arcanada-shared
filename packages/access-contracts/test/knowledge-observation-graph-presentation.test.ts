/**
 * KCLIVE-01 slice 6: the shared graph presentation projection (Agent-Brain request, PR #118 comment 6706789923).
 * Written against main 9af89919 first (red-before: the presentation exports do not exist and the existing stable view
 * input cannot see an edge-only or evidence-only change) and then against the implementation (green-after).
 * Fixture values are synthetic; no live adapter is involved. The projection is consumed through the package root only.
 */
import { describe, expect, it } from "vitest";
import {
  createReducerState,
  graphPresentationDigestInput,
  projectGraphPresentation,
  projectView,
  reduce,
  stableViewDigestInput,
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
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const rec = (id: string): Json => structuredClone(records[id]) as Json;
const recv = (record: unknown): ReducerInput => ({ kind: "receive", record });
const bind: ReducerInput = {
  kind: "bind_trusted_projection",
  viewContext: CTX,
};

function play(
  inputs: ReducerInput[],
  limits?: Parameters<typeof createReducerState>[0],
): ReducerState {
  let state = createReducerState(limits ?? { mode: "fixture" });
  for (const input of [bind, ...inputs]) {
    const r = reduce(state, input);
    expect(r.commands).toEqual([]);
    state = r.state;
  }
  return state;
}

const REF = (graph: string, auth: string, id: string): Json => ({
  graph_kind: graph,
  authority: auth,
  namespace: "fixture-project",
  local_id: id,
  revision: null,
});

/** Sets a source-asserted PASS/FAIL on an acceptance record with the checks and observation the contract requires. */
function setSourceVerdict(acceptance: Json, verdict: "PASS" | "FAIL"): void {
  const subject = REF("work", "muneral", "task-1");
  acceptance.verdict = verdict;
  acceptance.reason = verdict === "FAIL" ? "fixture-fail" : null;
  acceptance.checks = [
    {
      checker_id: "checker-1",
      checker_revision: "rev-1",
      method_ref: "fixture:method",
      verdict,
      subject_refs: [subject],
      evidence_refs: ["fixture:check-evidence"],
      observed_at: "2000-01-01T00:00:00Z",
      reason: verdict === "FAIL" ? "fixture-check-fail" : null,
      inapplicability_rule_ref: null,
    },
  ];
  acceptance.decision_evidence_ref = "fixture:decision-evidence";
  acceptance.decision_policy_ref = "fixture:decision-policy";
  Object.assign(acceptance.observation, {
    subject_ref: subject,
    subject_revision: "rev-1",
    criterion_revision: "criterion-1",
    method_ref: "fixture:method",
    observer_id: "fixture-observer",
    observed_at: "2000-01-01T00:00:00Z",
    grounds: ["fixture:ground"],
    source_unknowns: [],
  });
}

interface Variant {
  edgeKind?: string;
  graphRevision?: string;
  nodeEvidence?: string[];
  edgeEvidence?: string[];
  linkEvidence?: string[];
  sourceVerdict?: "PASS" | "FAIL" | "NOT_MEASURED";
  topSourceVerdict?: "PASS" | "FAIL";
  knowledgeGraphRevision?: string;
  edgeToId?: string;
  edgeToRevision?: string;
  edgeFromRevision?: string;
  linkKind?: string;
  linkAssociation?: string;
  linkToId?: string;
}

/** snapshot-A extended with a second work node, one ordinary edge, one crosslink and evidence on all three. */
function snapshot(v: Variant = {}, reverse = false): Json {
  const r = rec("snapshot-A");
  const work = r.data.graphs.find((g: Json) => g.graph_kind === "work");
  const node1 = work.nodes[0];
  node1.evidence_refs = v.nodeEvidence ?? ["fixture:evidence-node"];
  if (v.sourceVerdict === "PASS" || v.sourceVerdict === "FAIL")
    setSourceVerdict(node1.acceptance, v.sourceVerdict);
  if (v.topSourceVerdict !== undefined)
    setSourceVerdict(r.data.acceptance, v.topSourceVerdict);
  const node2 = structuredClone(node1);
  node2.ref = REF("work", "muneral", "task-2");
  node2.evidence_refs = ["fixture:evidence-node-2"];
  node2.acceptance.verdict = "NOT_MEASURED";
  work.nodes = [node1, node2];
  const know = r.data.graphs.find((g: Json) => g.graph_kind === "knowledge");
  const node3 = structuredClone(node1);
  node3.ref = REF("knowledge", "kc", "k-1");
  node3.evidence_refs = ["fixture:evidence-node-3"];
  node3.acceptance.verdict = "NOT_MEASURED";
  know.nodes = [node3];
  work.graph_revision = v.graphRevision ?? work.graph_revision;
  know.graph_revision = v.knowledgeGraphRevision ?? know.graph_revision;
  work.edges = [
    {
      edge_id: "edge-1",
      kind: v.edgeKind ?? "depends_on",
      from: {
        ...REF("work", "muneral", "task-1"),
        revision: v.edgeFromRevision ?? null,
      },
      to: {
        ...REF("work", "muneral", v.edgeToId ?? "task-2"),
        revision: v.edgeToRevision ?? null,
      },
      evidence_refs: v.edgeEvidence ?? ["fixture:evidence-edge"],
    },
  ];
  r.data.crosslinks = [
    {
      link_id: "link-1",
      kind: v.linkKind ?? "uses",
      from: REF("work", "muneral", "task-1"),
      to: REF("knowledge", "kc", v.linkToId ?? "k-1"),
      association_ref: v.linkAssociation ?? "fixture:association",
      evidence_refs: v.linkEvidence ?? ["fixture:evidence-link"],
    },
  ];
  if (reverse) {
    work.nodes.reverse();
    work.nodes.forEach((n: Json) => n.evidence_refs.reverse());
  }
  return r;
}

const build = (v: Variant = {}): ReducerState => play([recv(snapshot(v))]);
const digest = (s: ReducerState): string => graphPresentationDigestInput(s);

describe("graph presentation: content", () => {
  it("carries qualified typed edges, graph identity/revision and node/edge/link evidence", () => {
    const state = build();
    expect(projectView(state).nodes.length).toBe(3); // the snapshot was accepted
    const p = projectGraphPresentation(state);
    const work = p.graphs.find((g) => g.graphKind === "work");
    expect(work).toMatchObject({
      authority: "muneral",
      graphRevision: "fixture-graph-1",
      nodeCount: 2,
      edgeCount: 1,
    });
    expect(p.graphs).toHaveLength(4);
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0]).toMatchObject({
      edgeId: "edge-1",
      kind: "depends_on",
      graphKind: "work",
      graphRevision: "fixture-graph-1",
      evidenceRefs: ["fixture:evidence-edge"],
    });
    expect(p.edges[0]!.from).toMatchObject({
      graphKind: "work",
      authority: "muneral",
      namespace: "fixture-project",
      localId: "task-1",
    });
    expect(p.nodes.map((n) => n.evidenceRefs).sort()).toEqual([
      ["fixture:evidence-node"],
      ["fixture:evidence-node-2"],
      ["fixture:evidence-node-3"],
    ]);
    expect(p.crosslinks[0]).toMatchObject({
      linkId: "link-1",
      kind: "uses",
      associationRef: "fixture:association",
      evidenceRefs: ["fixture:evidence-link"],
    });
    expect(p.implicitJoins).toBe(0);
  });

  it("keeps source acceptance apart from independent acceptance; a source PASS is never an independent PASS", () => {
    const state = build({ sourceVerdict: "PASS" });
    const p = projectGraphPresentation(state);
    const n = p.nodes.find((x) => x.localId === "task-1")!;
    expect(n.acceptance.sourceVerdict).toBe("PASS");
    expect(n.acceptance.independentVerdict).not.toBe("PASS");
    expect(["NOT_MEASURED", "FAIL"]).toContain(n.acceptance.independentVerdict);
    expect(n.acceptance.independentlyVerified).toBe(false);
    expect(p.topAcceptance?.independentlyVerified).toBe(false);
  });
});

describe("graph presentation: independent acceptance mutation", () => {
  it("a source FAIL with a failing check is shown as an unverified independent FAIL; a source PASS stays NOT_MEASURED", () => {
    const fail = projectGraphPresentation(build({ sourceVerdict: "FAIL" }));
    const n1 = fail.nodes.find((n) => n.localId === "task-1");
    expect(n1?.acceptance.sourceVerdict).toBe("FAIL");
    expect(n1?.acceptance.independentVerdict).toBe("FAIL");
    expect(n1?.acceptance.independentBasis).toBe("source_fail_unverified");
    expect(n1?.acceptance.independentlyVerified).toBe(false);
    const pass = projectGraphPresentation(build({ sourceVerdict: "PASS" }));
    const p1 = pass.nodes.find((n) => n.localId === "task-1");
    expect(p1?.acceptance.sourceVerdict).toBe("PASS");
    expect(p1?.acceptance.independentVerdict).toBe("NOT_MEASURED");
    expect(p1?.acceptance.independentlyVerified).toBe(false);
  });
});

describe("graph presentation: order stability", () => {
  it("equal views for equivalent delivery orders (array order, event before/after snapshot)", () => {
    const a = play([recv(snapshot()), recv(evtN(1)), recv(evtN(2))]);
    const b = play([recv(evtN(2)), recv(evtN(1)), recv(snapshot({}, true))]);
    expect(projectGraphPresentation(b)).toEqual(projectGraphPresentation(a));
    expect(digest(b)).toBe(digest(a));
  });
});

function evtN(n: number): Json {
  const r = rec("event-1");
  const BASE = BigInt("9007199254740992");
  r.record_id = `ev-${n}`;
  r.data.event_id = `ev-${n}`;
  r.data.cursor = String(BASE + BigInt(n));
  r.data.producer_event_id = `p-${n}`;
  r.data.source_sequence.value = String(100 + n);
  return r;
}

describe("graph presentation: single-field differences are exposed", () => {
  const cases: [string, Variant][] = [
    ["only the edge kind", { edgeKind: "related_to" }],
    ["only the graph revision", { graphRevision: "fixture-graph-2" }],
    ["only node evidence", { nodeEvidence: ["fixture:evidence-other"] }],
    ["only edge evidence", { edgeEvidence: ["fixture:evidence-other"] }],
    ["only link evidence", { linkEvidence: ["fixture:evidence-other"] }],
    ["only the source acceptance verdict", { sourceVerdict: "PASS" }],
    ["only the top-level source acceptance", { topSourceVerdict: "FAIL" }],
    [
      "only the revision of a graph that has no edges",
      { knowledgeGraphRevision: "fixture-know-2" },
    ],
    ["only the edge target (qualifier)", { edgeToId: "task-1" }],
    ["only the edge target revision (qualifier)", { edgeToRevision: "r-2" }],
    ["only the edge source revision (qualifier)", { edgeFromRevision: "r-1" }],
    ["only the link kind", { linkKind: "derives_from" }],
    ["only the link association", { linkAssociation: "fixture:association-2" }],
    [
      "only the independent acceptance (source FAIL with a failing check)",
      { sourceVerdict: "FAIL" },
    ],
  ];
  for (const [name, variant] of cases) {
    it(`changing ${name} changes the presentation and its stable digest`, () => {
      const base = build();
      const changed = build(variant);
      expect(projectView(changed).nodes.length).toBe(3);
      expect(projectGraphPresentation(changed)).not.toEqual(
        projectGraphPresentation(base),
      );
      expect(digest(changed)).not.toBe(digest(base));
    });
  }

  it("documents the gap: the existing stable view input cannot see an edge-only or edge/link-evidence-only change", () => {
    const base = build();
    for (const v of [
      { edgeKind: "related_to" },
      { graphRevision: "fixture-graph-2" },
      { edgeEvidence: ["fixture:evidence-other"] },
      { linkEvidence: ["fixture:evidence-other"] },
    ]) {
      expect(stableViewDigestInput(build(v))).toBe(stableViewDigestInput(base));
    }
  });
});

describe("graph presentation: clearing and bounds", () => {
  const EMPTY = (): unknown =>
    projectGraphPresentation(createReducerState({ mode: "fixture" }));
  const populated = (): ReducerState => build({ sourceVerdict: "PASS" });

  it("revocation clears every added field", () => {
    const before = projectGraphPresentation(populated());
    expect(before.edges.length).toBe(1);
    const after = reduce(populated(), {
      kind: "trusted_authorization_revoked",
      viewContext: CTX,
    }).state;
    const p = projectGraphPresentation(after);
    expect(p.edges).toEqual([]);
    expect(p.graphs).toEqual([]);
    expect(p.nodes).toEqual([]);
    expect(p.crosslinks).toEqual([]);
    expect(p.topAcceptance).toBeNull();
    expect(p.projection).toBe("cleared");
  });

  it("a denied (mismatched) context cannot install or alter the presentation", () => {
    const state = populated();
    const other = snapshot();
    other.view_context = { ...CTX, authorized_view_scope: "opaque-view-B" };
    other.data.graphs[3].edges = [];
    const after = reduce(state, recv(other)).state;
    expect(projectGraphPresentation(after).edges).toEqual(
      projectGraphPresentation(state).edges,
    );
    const denied = play([], { mode: "fixture" });
    const r = reduce(denied, recv(other)).state; // never bound to B
    expect(projectGraphPresentation(r).edges).toEqual([]);
  });

  it("an epoch reset clears the added fields", () => {
    const next: ViewContext = { ...CTX, stream_epoch: "epoch-B" };
    const after = reduce(populated(), {
      kind: "trusted_epoch_reset",
      oldViewContext: CTX,
      newViewContext: next,
      authorizationObservationRef: "fixture:auth-ref",
    }).state;
    const p = projectGraphPresentation(after);
    expect(p.edges).toEqual([]);
    expect(p.nodes).toEqual([]);
    expect(p.crosslinks).toEqual([]);
  });

  it("the empty state projects to the empty presentation", () => {
    expect(
      projectGraphPresentation(createReducerState({ mode: "fixture" })),
    ).toEqual(EMPTY());
  });

  it("is bounded: output never exceeds the input, and an oversized snapshot is refused before any presentation", () => {
    const state = populated();
    const p = projectGraphPresentation(state);
    const v = state.view;
    if (v === null) throw new Error("expected a populated view");
    expect(p.edges.length).toBeLessThanOrEqual(
      v.graphs.reduce((n, g) => n + g.edges.length, 0),
    );
    expect(p.nodes.length).toBeLessThanOrEqual(
      v.graphs.reduce((n, g) => n + g.nodes.length, 0),
    );
    expect(p.crosslinks.length).toBeLessThanOrEqual(v.crosslinks.length);
    // a page set larger than the page bound is refused at its first page and nothing is presented
    records["graph-presentation-snapshot"] = snapshot();
    const pages = splitPages("graph-presentation-snapshot", 2);
    const refused = play([recv(pages[0])], {
      mode: "fixture",
      limits: { maxPages: 1 },
    });
    expect(projectGraphPresentation(refused).edges).toEqual([]);
    expect(projectGraphPresentation(refused).nodes).toEqual([]);
    // and a page above the byte bound is refused
    const size = sealManifest(pages).pages[0]!.byteSize;
    const tooBig = play([recv(pages[0])], {
      mode: "fixture",
      limits: { maxSerializedBytes: size - 1 },
    });
    expect(projectGraphPresentation(tooBig).nodes).toEqual([]);
  });

  it("page-set delivery in either order presents exactly what the single snapshot presents", () => {
    records["graph-presentation-snapshot"] = snapshot();
    const pages = splitPages("graph-presentation-snapshot", 2);
    const manifest: ReducerInput = {
      kind: "trusted_page_set_manifest",
      manifest: sealManifest(pages),
    };
    const forward = play([manifest, recv(pages[0]), recv(pages[1])]);
    const backward = play([manifest, recv(pages[1]), recv(pages[0])]);
    const whole = build();
    expect(projectGraphPresentation(forward).edges).toHaveLength(1);
    expect(projectGraphPresentation(forward)).toEqual(
      projectGraphPresentation(whole),
    );
    expect(projectGraphPresentation(backward)).toEqual(
      projectGraphPresentation(whole),
    );
    expect(digest(backward)).toBe(digest(whole));
  });

  it("projecting does not mutate the state and is idempotent", () => {
    const state = populated();
    const frozen = JSON.stringify(state);
    const a = projectGraphPresentation(state);
    const b = projectGraphPresentation(state);
    expect(a).toEqual(b);
    expect(JSON.stringify(state)).toBe(frozen);
  });
});
