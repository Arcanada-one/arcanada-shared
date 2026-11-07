/**
 * KCLIVE-01 round 3: each per-page binding of the sealed page-set manifest is pinned by a test in which ONLY that
 * binding differs. Round 2 only showed that a tampered page is refused, and that refusal could come from the
 * `totalBytes` sum alone. Here the sum is kept equal, so removing the guard under test is the only way the set could
 * be accepted. Fixture values are synthetic.
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
const recv = (record: unknown): ReducerInput => ({ kind: "receive", record });
const manifestIn = (manifest: PageSetManifest): ReducerInput => ({
  kind: "trusted_page_set_manifest",
  manifest,
});
const bootstrap = recv(structuredClone(records["snapshot-A"]));

function play(inputs: ReducerInput[]): {
  state: ReducerState;
  outcomes: ReduceOutcome[];
} {
  let state = createReducerState({ mode: "fixture" });
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

const PAGES = (): Record<string, unknown>[] =>
  splitPages("snapshot-colliding-ids", 2);

/** Same byte size, different content: one character of a free-text field changes. */
function sameSizeForgery(page: Record<string, unknown>): unknown {
  const forged = structuredClone(page) as {
    data: { graphs: { nodes: { acceptance: { reason: string } }[] }[] };
  };
  const node = (
    forged.data.graphs[0] as { nodes: { acceptance: { reason: string } }[] }
  ).nodes[0] as { acceptance: { reason: string } };
  const text = node.acceptance.reason;
  node.acceptance.reason = `${text.slice(0, -1)}${text.endsWith("!") ? "?" : "!"}`;
  return forged;
}

/** The sealed sizes trade one byte between the two entries, so the sum still equals the real total. */
function sizeSwapped(pages: Record<string, unknown>[]): PageSetManifest {
  const m = sealManifest(pages);
  const [a, b] = m.pages;
  return {
    ...m,
    pages: [
      { ...(a as object), byteSize: (a as { byteSize: number }).byteSize + 1 },
      { ...(b as object), byteSize: (b as { byteSize: number }).byteSize - 1 },
    ],
  } as unknown as PageSetManifest;
}

describe("per-page binding to the sealed manifest — only one field differs at a time", () => {
  it("controls: the untouched set completes in both orders, so the refusals below are caused by the one altered field", () => {
    const pages = PAGES();
    const m = sealManifest(pages);
    for (const order of [
      [manifestIn(m), recv(pages[0]), recv(pages[1])],
      [recv(pages[0]), recv(pages[1]), manifestIn(m)],
    ]) {
      const r = play(order);
      expect(projectView(r.state).projection).toBe("current");
      expect(r.outcomes[r.outcomes.length - 1]).toMatchObject({
        code: "PAGES_ASSEMBLED",
      });
    }
  });

  it("the forgery has the sealed byte size and still decodes (it differs ONLY by digest)", () => {
    const pages = PAGES();
    const forged = sameSizeForgery(pages[1] as Record<string, unknown>);
    const real = play([recv(pages[1])]).state.pages;
    const fake = play([recv(forged)]).state.pages;
    expect(real?.pages[0]?.byteSize).toBe(fake?.pages[0]?.byteSize);
    expect(real?.pages[0]?.sha256).not.toBe(fake?.pages[0]?.sha256);
  });

  for (const [label, order] of [
    ["manifest before pages", "manifest-first"],
    ["pages before manifest", "pages-first"],
  ] as const) {
    it(`digest only (${label}): a page with the sealed size and ordinal but another digest never completes the set`, () => {
      const pages = PAGES();
      const m = sealManifest(pages);
      const forged = sameSizeForgery(pages[1] as Record<string, unknown>);
      const inputs =
        order === "manifest-first"
          ? [bootstrap, manifestIn(m), recv(pages[0]), recv(forged)]
          : [bootstrap, recv(pages[0]), recv(forged), manifestIn(m)];
      const r = play(inputs);
      expect(r.outcomes[r.outcomes.length - 1]).toMatchObject({
        disposition: "rejected",
        code: "PAGE_SET_MISMATCH",
      });
      expect(r.state.holds).toContain("PAGE_SET_MISMATCH");
      expect(r.state.fullSnapshotRequired).toBe(true);
      expect(r.state.appliedCursor).toBe("9007199254740992");
      expect(r.state.pages).toBeNull();
    });

    it(`byte size only (${label}): a page whose digest matches but whose sealed size differs never completes the set`, () => {
      const pages = PAGES();
      const m = sizeSwapped(pages);
      const inputs =
        order === "manifest-first"
          ? [bootstrap, manifestIn(m), recv(pages[0]), recv(pages[1])]
          : [bootstrap, recv(pages[0]), recv(pages[1]), manifestIn(m)];
      const r = play(inputs);
      expect(r.outcomes[r.outcomes.length - 1]).toMatchObject({
        disposition: "rejected",
        code: "PAGE_SET_MISMATCH",
      });
      expect(r.state.holds).toContain("PAGE_SET_MISMATCH");
      expect(r.state.appliedCursor).toBe("9007199254740992");
      expect(r.state.pages).toBeNull();
    });
  }

  it("the size-swapped manifest is itself well-formed, so only the per-entry size comparison can refuse it", () => {
    const pages = PAGES();
    const r = play([manifestIn(sizeSwapped(pages))]);
    expect(r.outcomes[0]).toMatchObject({ disposition: "state_changed" });
  });
});
