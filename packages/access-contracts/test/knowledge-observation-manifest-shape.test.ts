/**
 * KCLIVE-01 round 4: a trusted page-set manifest may reach the reducer from an adapter boundary, so its nested runtime
 * shapes are not guaranteed by the TypeScript types. A malformed shape must be refused with INVALID_PAGE_SET_MANIFEST
 * (zero commands, accepted view unchanged) and must never throw. Fixture values are synthetic.
 */
import { describe, expect, it } from "vitest";
import {
  createReducerState,
  projectView,
  reduce,
  type PageSetManifest,
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
const manifestIn = (manifest: unknown): ReducerInput => ({
  kind: "trusted_page_set_manifest",
  manifest: manifest as PageSetManifest,
});
const PAGES = (): Record<string, unknown>[] =>
  splitPages("snapshot-colliding-ids", 2);

function bound(prefix: ReducerInput[]): ReducerState {
  let state = createReducerState({ mode: "fixture" });
  for (const input of [
    { kind: "bind_trusted_projection", viewContext: CTX } as ReducerInput,
    recv(structuredClone(records["snapshot-A"])),
    ...prefix,
  ])
    state = reduce(state, input).state;
  return state;
}

const asString = (text: string): unknown => ({ toString: () => text });

type Mutation = [string, (m: PageSetManifest) => unknown];
const MUTATIONS: Mutation[] = [
  ["viewContext null", (m) => ({ ...m, viewContext: null })],
  ["viewContext a string", (m) => ({ ...m, viewContext: "ctx" })],
  ["first pages entry null", (m) => ({ ...m, pages: [null, m.pages[1]] })],
  ["last pages entry null", (m) => ({ ...m, pages: [m.pages[0], null] })],
  ["pages entry a number", (m) => ({ ...m, pages: [7, m.pages[1]] })],
  [
    "pageSetRef an object whose toString matches",
    (m) => ({ ...m, pageSetRef: asString("set-1") }),
  ],
  ["pageSetRef a number", (m) => ({ ...m, pageSetRef: 12345 })],
  [
    "trustedSnapshotRef an object whose toString matches",
    (m) => ({ ...m, trustedSnapshotRef: asString("snap-1") }),
  ],
  [
    "trustedSnapshotRef a one-element array",
    (m) => ({ ...m, trustedSnapshotRef: ["snap-1"] }),
  ],
  [
    "adapterRef an object whose toString matches",
    (m) => ({ ...m, adapterRef: asString("adapter-1") }),
  ],
  ["adapterRef a number", (m) => ({ ...m, adapterRef: 42 })],
];

describe("malformed trusted manifest shapes are refused, never thrown", () => {
  it("control: the untouched manifest is accepted in this harness", () => {
    const m = sealManifest(PAGES());
    const r = reduce(bound([]), manifestIn(m));
    expect(r.outcome).toMatchObject({ disposition: "state_changed" });
  });

  for (const [label, mutate] of MUTATIONS) {
    for (const order of ["manifest-first", "pages-first"] as const) {
      it(`${label} (${order}) -> rejected/INVALID_PAGE_SET_MANIFEST, zero commands, view unchanged`, () => {
        const pages = PAGES();
        const bad = mutate(sealManifest(pages));
        const before = bound(order === "pages-first" ? [recv(pages[0])] : []);
        const viewBefore = structuredClone(projectView(before));
        const r = reduce(before, manifestIn(bad));
        expect(r.outcome).toMatchObject({
          disposition: "rejected",
          code: "INVALID_PAGE_SET_MANIFEST",
        });
        expect(r.commands).toEqual([]);
        // The accepted view is unchanged except for the diagnostic record of this very refusal.
        const { rejected: rejectedAfter, ...viewAfter } = structuredClone(
          projectView(r.state),
        );
        const { rejected: rejectedBefore, ...viewRest } = viewBefore;
        expect(viewAfter).toEqual(viewRest);
        expect(rejectedAfter).toEqual([
          ...rejectedBefore,
          { code: "INVALID_PAGE_SET_MANIFEST", recordId: null },
        ]);
        expect(r.state.appliedCursor).toBe(before.appliedCursor);
      });
    }
  }
});
