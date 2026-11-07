/**
 * KCLIVE-01 acceptance audit (predicates 2, 3, 4, 5) at the layer both site mounts consume: `projectGraphPresentation`.
 * The reducer-level tests already prove these properties on `projectView`; these tests prove the presentation carries
 * them through unchanged (freshness, view kind, original producer state, no promotion to independent acceptance).
 * Fixture values are synthetic. The presentation is consumed through the package root only.
 */
import { describe, expect, it } from "vitest";
import {
  createReducerState,
  graphPresentationDigestInput,
  projectGraphPresentation,
  reduce,
  type ObservationMode,
  type ReducerInput,
  type ReducerState,
  type ViewContext,
} from "./knowledge-observation.api.js";
import { caseMeta, records } from "./knowledge-observation.harness.js";

const CTX = caseMeta.default_view_context as ViewContext;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rec = (id: string): Json => structuredClone(records[id]) as Json;
const recv = (id: string): ReducerInput => ({
  kind: "receive",
  record: rec(id),
});
const bind: ReducerInput = {
  kind: "bind_trusted_projection",
  viewContext: CTX,
};

function play(
  inputs: ReducerInput[],
  mode: ObservationMode = "fixture",
): ReducerState {
  let state = createReducerState({ mode });
  for (const input of [bind, ...inputs]) {
    const r = reduce(state, input);
    expect(r.commands).toEqual([]);
    state = r.state;
  }
  return state;
}

const task1 = (s: ReducerState): Json | undefined =>
  projectGraphPresentation(s).nodes.find((n) => n.localId === "task-1");

describe("presentation: view kind distinguishes unconnected, fixture, replay and live", () => {
  it("names the kind of view, and an unconnected state shows no graph", () => {
    const unconnected = projectGraphPresentation(createReducerState());
    expect(unconnected.viewKind).toBe("unconnected");
    expect(unconnected.nodes).toEqual([]);
    expect(unconnected.graphs).toEqual([]);
    expect(projectGraphPresentation(play([recv("snapshot-A")])).viewKind).toBe(
      "fixture",
    );
    const asLive = (id: string): ReducerInput => {
      const r = rec(id);
      r["mode"] = "live";
      r["evidence_basis"] = "native_observation";
      return { kind: "receive", record: r };
    };
    expect(
      projectGraphPresentation(play([asLive("snapshot-A")], "live")).viewKind,
    ).toBe("live");
    expect(
      projectGraphPresentation(
        play(
          [{ kind: "set_mode", mode: "replay" }, asLive("snapshot-A")],
          "live",
        ),
      ).viewKind,
    ).toBe("replay");
  });
});

describe("presentation: gaps, duplicates and order", () => {
  const gapped = (): ReducerState =>
    play([recv("snapshot-A"), recv("event-1"), recv("event-3")]);

  it("a cursor gap is presented as stale and reconciling and the last trusted state is kept, never the later 'done'", () => {
    const p = projectGraphPresentation(gapped());
    expect(p.projection).toBe("reconciling");
    expect(p.stale).toBe(true);
    expect(task1(gapped())?.nativeState).toBe("in_progress");
    expect(task1(gapped())?.acceptance.independentVerdict).toBe("NOT_MEASURED");
  });

  it("recovery from an authorized full snapshot clears stale in the presentation", () => {
    const p = projectGraphPresentation(
      play([
        recv("snapshot-A"),
        recv("event-1"),
        recv("event-3"),
        recv("snapshot-ahead"),
      ]),
    );
    expect(p.stale).toBe(false);
    expect(p.projection).toBe("current");
  });

  it("a duplicate or reordered delivery presents exactly what the single in-order delivery presents", () => {
    const once = play([recv("snapshot-A"), recv("event-1")]);
    const dup = play([
      recv("snapshot-A"),
      recv("event-1"),
      recv("event-1-duplicate"),
      recv("event-1"),
    ]);
    expect(projectGraphPresentation(dup)).toEqual(
      projectGraphPresentation(once),
    );
    expect(graphPresentationDigestInput(dup)).toBe(
      graphPresentationDigestInput(once),
    );
  });

  it("an unknown schema version is held explicitly: the presentation neither advances nor completes", () => {
    const bad = rec("event-1");
    bad["profile"] = "knowledge-collective-observation/v999";
    const base = play([recv("snapshot-A")]);
    const held = play([recv("snapshot-A"), { kind: "receive", record: bad }]);
    const p = projectGraphPresentation(held);
    expect(p.appliedCursor).toBe("9007199254740992");
    expect(p.appliedCursor).toBe(projectGraphPresentation(base).appliedCursor);
    expect(p.projection).toBe("reconciling");
    expect(p.stale).toBe(true);
    expect(p.nodes).toEqual(projectGraphPresentation(base).nodes);
  });
});

describe("presentation: original producer state is retained and terminal state is not acceptance", () => {
  const done = (): ReducerState =>
    play([
      recv("snapshot-A"),
      recv("event-1"),
      recv("event-2"),
      recv("attempt-succeeded"),
      recv("event-3"),
    ]);

  it("native 'done' stays 'done' while source and independent acceptance stay NOT_MEASURED and unverified", () => {
    const n = task1(done());
    expect(n?.nativeState).toBe("done");
    expect(n?.acceptance).toMatchObject({
      sourceVerdict: "NOT_MEASURED",
      independentVerdict: "NOT_MEASURED",
      independentBasis: "none",
      independentlyVerified: false,
    });
    const p = projectGraphPresentation(done());
    expect(p.topAcceptance?.independentVerdict).toBe("NOT_MEASURED");
    expect(p.topAcceptance?.independentlyVerified).toBe(false);
    expect(
      p.nodes.every((x) => x.acceptance.independentlyVerified === false),
    ).toBe(true);
  });

  it("a Doclab SUCCEEDED row keeps its original spelling and is not independently accepted", () => {
    const p = projectGraphPresentation(
      play([
        recv("snapshot-doclab"),
        recv("doclab-event-100"),
        recv("doclab-event-104"),
      ]),
    );
    const run = p.nodes.find((n) => n.localId === "fixture-db-run");
    expect(run?.nativeState).toBe("SUCCEEDED");
    expect(run?.acceptance.independentVerdict).toBe("NOT_MEASURED");
    expect(run?.acceptance.independentlyVerified).toBe(false);
  });

  it("an empty verifier list on a source PASS is refused before it can be presented", () => {
    const bad = rec("snapshot-A");
    const node = bad.data.graphs.find((g: Json) => g.graph_kind === "work")
      .nodes[0];
    node.acceptance.verdict = "PASS";
    node.acceptance.checks = [];
    const s = play([{ kind: "receive", record: bad }]);
    const p = projectGraphPresentation(s);
    expect(p.nodes).toEqual([]);
    expect(p.topAcceptance).toBeNull();
  });
});

describe("presentation: distinct typed graphs with explicit cross-references", () => {
  it("same local id in different graphs and authorities stays separate and nothing is joined implicitly", () => {
    const p = projectGraphPresentation(play([recv("snapshot-colliding-ids")]));
    expect(new Set(p.nodes.map((n) => n.key)).size).toBe(4);
    expect(new Set(p.graphs.map((g) => g.graphKind)).size).toBe(
      p.graphs.length,
    );
    expect(p.implicitJoins).toBe(0);
  });

  it("every graph kind declared by the snapshot is presented as its own graph with its own authority and revision", () => {
    const p = projectGraphPresentation(play([recv("snapshot-A")]));
    expect(p.graphs.map((g) => g.graphKind).sort()).toEqual([
      "contract_receipt_chain",
      "knowledge",
      "processing_execution",
      "work",
    ]);
    for (const g of p.graphs) {
      expect(g.authority).not.toBe("");
      expect(g.graphRevision).not.toBe("");
    }
  });
});
