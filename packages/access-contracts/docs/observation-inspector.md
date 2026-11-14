# Read-only observation inspector

This browser module displays details already present in the shared observation projections. It introduces no parser, reducer, transport, authority, file reader or execution control.

```js
import { createObservationInspectorMount } from "@arcanada/access-contracts/observation-inspector";

const mountObservationInspector = createObservationInspectorMount({
  projectGraph: projectKnowledgeObservationGraph,
  projectView: projectKnowledgeObservation,
});

const inspection = mountObservationInspector({
  document,
  graphRoot: document.querySelector('[data-live-lab-region="graph"]'),
  timelineRoot: document.querySelector('[data-live-lab-region="timeline"]'),
  inspectorRoot: document.querySelector('[data-live-lab-region="inspector"]'),
  state,
});

// After an authorized adapter changes the reducer state and renders its graph:
inspection.update(nextState);

// Before discarding the page, changing principal, or removing its regions:
inspection.destroy();
```

## Input and lifecycle

The factory binds the existing shared projector functions once. Each mount/update accepts one already-decoded reducer state and derives both projections synchronously from that state. Callers cannot pass graph and detail projections from separate scopes. Matching projection/cursor/mode fields remain a consistency check, not authentication; these projections do not contain a full principal/run/scope fingerprint. The existing trusted adapter owns principal, scope, current authorization, snapshot coverage, revocation and receipt authenticity.

The graph's existing elements carry `data-node-key`, `data-edge-key` and `data-link-id` with the exact qualified identities from the graph projection. Selection uses equality, never a substring, bare local identifier, inferred graph association or selector assembled from data. The module adds keyboard-operable buttons without replacing the graph.

The timeline preserves the reducer's retained applied-event order, lossless cursors and three distinct timestamps. A retained ledger does not certify complete history, causality across producers or successful execution.

Every update clears previous details and event handlers before installing the next projection. A cleared or revoked reducer view therefore removes the old inspector contents. A projector failure also destroys the previous details. A disposed controller cannot repopulate them. The component does not own graph rendering: its caller must render the new graph before update, and clear the graph itself if projecting it fails. Callers must actually forward context changes/revocation to the reducer and update or destroy the component; the component does not subscribe to Auth.

Each mounted controller exclusively owns its graph, timeline and inspector regions. An overlapping mount is refused before changing either controller. `idPrefix` must be a string matching `^[a-z][a-z0-9-]*# Read-only observation inspector

This browser module displays details already present in the shared observation projections. It introduces no parser, reducer, transport, authority, file reader or execution control.

```js
import { createObservationInspectorMount } from "@arcanada/access-contracts/observation-inspector";

const mountObservationInspector = createObservationInspectorMount({
  projectGraph: projectKnowledgeObservationGraph,
  projectView: projectKnowledgeObservation,
});

const inspection = mountObservationInspector({
  document,
  graphRoot: document.querySelector('[data-live-lab-region="graph"]'),
  timelineRoot: document.querySelector('[data-live-lab-region="timeline"]'),
  inspectorRoot: document.querySelector('[data-live-lab-region="inspector"]'),
  state,
});

// After an authorized adapter changes the reducer state and renders its graph:
inspection.update(nextState);

// Before discarding the page, changing principal, or removing its regions:
inspection.destroy();
```

## Input and lifecycle

The factory binds the existing shared projector functions once. Each mount/update accepts one already-decoded reducer state and derives both projections synchronously from that state. Callers cannot pass graph and detail projections from separate scopes. Matching projection/cursor/mode fields remain a consistency check, not authentication; these projections do not contain a full principal/run/scope fingerprint. The existing trusted adapter owns principal, scope, current authorization, snapshot coverage, revocation and receipt authenticity.

The graph's existing elements carry `data-node-key`, `data-edge-key` and `data-link-id` with the exact qualified identities from the graph projection. Selection uses equality, never a substring, bare local identifier, inferred graph association or selector assembled from data. The module adds keyboard-operable buttons without replacing the graph.

The timeline preserves the reducer's retained applied-event order, lossless cursors and three distinct timestamps. A retained ledger does not certify complete history, causality across producers or successful execution.

Every update clears previous details and event handlers before installing the next projection. A cleared or revoked reducer view therefore removes the old inspector contents. A projector failure also destroys the previous details. A disposed controller cannot repopulate them. The component does not own graph rendering: its caller must render the new graph before update, and clear the graph itself if projecting it fails. Callers must actually forward context changes/revocation to the reducer and update or destroy the component; the component does not subscribe to Auth.

; its derived `-detail` ID must be unused in the document. Use distinct regions and prefixes for simultaneous inspectors. Destroying a controller releases its reservations, and an initially failed mount also cleans up. Existing placeholder `hidden` attributes, including `until-found`, are restored exactly. Unknown locales, including prototype property names, use English labels.

## Evidence and files

Node, ordinary-edge and crosslink evidence references can be inspected. An evidence reference resolves to artifact metadata only when it exactly equals a retained artifact record ID. All other references remain explicit unresolved references. Artifact keys, URLs, digests and partial strings are not used to infer a relationship.

Locators are never displayed or made clickable. Observed `access: allowed`, an immutable identity, a digest or a source PASS does not enable file opening. A separate current-authorized reader must retrieve the actual bytes and verify them before a future open action can be added. Denied artifact digests are not displayed.

Record text uses text nodes within `bdi`. No record content becomes HTML, a URL, a style, a script, a browser-storage key or a request.

## Site integration and present limits

Agent Runs already exports both required projections from its pinned vendored access-contracts bundle. Its thin mount may attach this module after rendering a valid fixture, without changing the fixture/replay/unconnected notices or enabling task execution. The same API can be used by Knowledge Journey after its trusted observation adapter exists; that site's currently empty shell must not invent a connected run.

This source addition does not demonstrate real extraction, registration, agent execution, deployed browser behavior or current grants. Native and browser execution are NOT_MEASURED until the existing site owners run their normal checks.

## Focused source qualification

The existing inspector test file now exercises queued stale handlers, terminal disposal, failed graph/view projections, node/edge/crosslink evidence, exact versus partial reference lookup, retained unresolved references, hostile inert text, prefix validation and collisions, region ownership and locale fallback. The DOM double catches HTML sinks but does not substitute for a real browser or current-user authorization test. A redundant internal cleanup assignment may remain behaviorally covered by another guard; do not require source-text assertions merely to kill every deletion mutant.

