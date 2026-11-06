# `@arcanada/observation-profile`

The shared, versioned **run / event / artifact observation contract** for the Knowledge Collective Live Lab, plus the one
framework-neutral **pure reducer and projection** that both sites (Knowledge Journey on Contract Place, Agent Runs on
Arcanada) import. There is no per-site copy of the decoder or the reducer.

Profile: `knowledge-collective-observation/v1`, required extension `lossless-decimal-counters/v1`. The JSON Schema in
`src/observation.schema.json` is the unmodified file from Agent-Brain's observation package (manifest sha256
`447266fc13b38a5d3a997c885edd349e4efaf84007e0be271af5ddcf4322d09d`, `observation-profile-v1/` in
`Arcanada-one/arcanada-workspace`, PR #1852). Its semantics are defined by that package's `SEMANTICS.md`.

## What it guarantees

- **Strict, versioned decoding.** `decodeObservationRecord` fails explicitly — `UNSUPPORTED_PROFILE`,
  `UNSUPPORTED_RECORD_KIND`, `UNSUPPORTED_REQUIRED_EXTENSION`, `SCHEMA_INVALID`, `MALFORMED_JSON`, `NOT_AN_OBJECT`. An
  unknown version is never skipped and never advances a cursor. Cursors, watermarks, sequences, native versions and
  attempt ordinals are canonical decimal strings; a JSON number at such a field is rejected, never rounded.
  RFC3339 `date-time` is asserted (via `ajv-formats`).
- **A pure reducer.** `reduce(state, input)` returns `{ state, commands, outcome }`. `commands` is always the empty tuple
  in live, replay and fixture modes. The reducer reads no clock (time arrives as `at`), does no I/O and never mutates its
  input. A reconciliation read, a click or an animation belongs to a separately authorized adapter.
- **Trusted view binding first.** Records are checked against the trusted `(project, run, authorized view scope, stream
epoch)` tuple before anything else; a mismatch is an opaque denial that retains nothing of the record.
- **Gaps are visible.** A snapshot bootstraps only from a trusted _full_ snapshot with a watermark. A cursor gap, an
  identity/body conflict, an invalid record, a buffer overflow or expiry freezes the view at the last trusted state and
  reports `reconciling`. A late missing event never discharges a gap; only a newer authorized full snapshot or a proven
  contiguous authorized interval does (and an interval lifts only the `GAP` hold).
- **No synthesized completion.** Duplicates (identical complete record) are ignored, a conflicting repeat is quarantined
  (no last-writer-wins), out-of-order events are buffered, superseded-plan events are history only. A terminal native
  status (`done`, `SUCCEEDED`, `succeeded`) and an empty checker list never become independent acceptance: the reducer
  never promotes a source `PASS`, and a `PASS` beside a mandatory non-`PASS` check is a semantic conflict.
- **Separated identities and times.** Graph nodes are keyed by the full qualified reference
  `(graph kind, authority, namespace, local id, revision)`; there is no join on a bare id. Native `revision` /
  `aggregateVersion` never become `plan_revision`. The event ledger keeps producer, producer-local sequence, causation,
  and `occurred_at` / `observed_at` / `recorded_at` verbatim and separate. Connection, freshness, native state and
  independent acceptance are four separate view dimensions.

## Use

```ts
import {
  createReducerState,
  reduce,
  projectView,
} from "@arcanada/observation-profile";

let state = createReducerState({ mode: "live" });
({ state } = reduce(state, { kind: "bind_trusted_projection", viewContext })); // from the server session, not the payload
({ state } = reduce(state, { kind: "receive", record, at: Date.now() }));
const view = projectView(state); // deterministic; pass to the shared inspector
```

Other inputs: `set_mode`, `set_buffer_limits`, `trusted_replay_interval`, `trusted_epoch_reset`,
`trusted_authorization_revoked`, `evaluate_acceptance`, `transport_connected`, `transport_disconnected`, `tick`.
The trusted inputs must be produced only by the server-side adapter that actually verified the claim.

## Supported profile and limits

- Supported: the seven record variants (run, event, snapshot, attempt, artifact, command, deployment) of `v1`.
- The reducer holds a bounded in-memory pending buffer (`maxRecords`, `maxSerializedBytes`, `maxAgeMs`). The defaults are
  test inputs, not approved production budgets.
- `projectView` never enables an "Open" action; current authorization and a fresh byte check are the serving boundary's
  job. A denied artifact exposes no locator or digest.
- The decoder checks structure and semantics of the record, **not** authenticity of an identity, grant, watermark or
  producer statement. Structural validity is not KC admission. `access-contracts` `parseBoundedJson` is a bounded
  decoder (65532 bytes, depth 16); this package does not raise those bounds — transport full graphs as bounded pages
  assembled against one verified watermark.
- Not implemented here: site wiring, real producer adapters, Auth, ARAS authority, retained-byte readback, deployment.
- Release: the package is `private` (like `oidc-bff`) and is not on the release allowlist; publishing it, or consuming it from the sites by a versioned import, is a separate release decision.
- Dependencies: `ajv` and `ajv-formats` (unlike `access-contracts`, this package is not dependency-free).

## Tests

`pnpm --filter @arcanada/observation-profile test` executes, in the real reducer, all 24 prepared cases
(OBS-01 … OBS-24) in `live`, `replay` and `fixture` mode, decodes all 50 package records (42 must decode, the 8
deliberately invalid must be rejected with the expected reason), recomputes the fixture body digests, and checks the
invariants above (including random-arrival-order convergence). Fixtures under `test/fixtures/observation-profile-v1/`
are the package's own, verbatim and sha256-pinned; **all fixture results are synthetic and labelled `fixture`** — none of
this is evidence of a live, deployed or accepted pipeline.
