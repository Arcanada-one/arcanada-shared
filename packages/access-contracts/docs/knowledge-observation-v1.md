# Knowledge observation profile v1 (Live Lab)

Additive, dependency-free decoder and pure reducer for `knowledge-collective-observation/v1`, the shared run / event /
snapshot / attempt / artifact / command / deployment observation contract behind the Live Lab. It is the one
implementation both sites import; there is no per-site copy.

Sources: Agent-Brain's observation package (`documentation/plans/knowledge-collective-live-lab/observation-profile-v1/`
in `Arcanada-one/arcanada-workspace`, manifest sha256 `447266fc13b38a5d3a997c885edd349e4efaf84007e0be271af5ddcf4322d09d`)
and `implementation-contracts/2026-11-06/SHARED-OBSERVATION.md`. The decoder schema is the reviewed **amendment 1**
(`src/knowledge-observation-v1.amendment-1.schema.json`, derived deterministically from the pinned v1 schema; the
workspace PR `observation-profile-v1/amendment-1/` carries the semantics) and is interpreted by a small total validator
(no schema library at runtime; `ajv` is a test-only oracle). The unmodified pinned v1 schema is kept as a test fixture
and every v1-valid fixture record stays valid. Workspace correction PR: `Arcanada-one/arcanada-workspace#1882`.

## Frames and decoding

- `parseKnowledgeObservationJson(bytes)` calls the existing `parseBoundedJson` (1..65,532 UTF-8 bytes, depth 16, decoded
  duplicate keys, BOM and lone surrogates refused) and then `decodeKnowledgeObservationRecord`. No second JSON parser.
  The result carries an owned copy of the exact input bytes.
- `decodeKnowledgeObservationRecord(value)` captures own data properties once (getters, symbols and exotic prototypes are
  refused), then checks profile, negotiated required extensions, record kind and the schema. Failures are explicit:
  `INVALID_FRAME`, `NOT_AN_OBJECT`, `UNSUPPORTED_PROFILE`, `UNSUPPORTED_RECORD_KIND`, `UNSUPPORTED_REQUIRED_EXTENSION`,
  `SCHEMA_INVALID`.
- Counters (cursor, watermark, producer sequence, native `revision` / `aggregateVersion`, attempt ordinal) are canonical
  decimal strings; a JSON number is refused even when it is a safe integer. This is the required extension
  `lossless-decimal-counters/v1` and does not change `parseBoundedJson`'s numeric semantics for other consumers.
- Timestamps are RFC 3339 `date-time`; offsets and fractions are kept verbatim. `T`/`t` is required as the separator.

A full graph does not fit one 65,532-byte frame. Transport uses bounded authorized pages (`snapshot_kind: "partial"`),
each naming its immutable set in `coverage.page_set` (`page_set_ref`, canonical `page_index`, `page_count`). Those fields
are claims. A page set becomes the current view only when the external read adapter has supplied a **sealed ordered
manifest** through the trusted `trusted_page_set_manifest` input (same view scope and epoch, snapshot ref, plan,
watermark, page count, and each page's canonical sha256 and byte size from `knowledgeObservationPageDigest`), every
ordinal `0..count-1` is present exactly once, and each page matches its entry. A final page with `next_page_token: null`
and every graph kind present is **not** proof. Without proof a set stays pending (before bootstrap `awaiting_snapshot`,
afterwards `reconciling`) and nothing becomes current; a page without `page_set` is quarantined as unproven. Missing,
duplicate (different bytes) and foreign pages discard the assembly. Only a proven set goes through the normal
full-snapshot rules.

A same-watermark snapshot is accepted as consistent only when its complete normalised projection (plan, native state,
acceptance, source revisions, atomicity, graph kinds, every node, edge and crosslink) equals the recorded view; anything
else is quarantined as `SNAPSHOT_CONTRADICTION`. A verified contiguous same-view replay interval can clear a gap; a full
snapshot is required after buffer expiry or overflow, reset, revocation and a discarded page assembly.

A source `FAIL` needs an actual failing checker but no aggregate decision refs (only `PASS` needs them). It fails closed
and is exposed as `acceptanceBasis: "source_fail_unverified"` with `independentlyVerified: false`; it is never presented
as independently verified.

## Reducer

`reduceKnowledgeObservation(state, input)` → `{ state, commands: [], outcome }`. No I/O, no clock (time is the `at`
argument), no network. Trusted view binding, revocation, epoch resets and replay-interval coverage are explicit inputs that
only the external read adapter may produce after verifying them; nothing in a record payload grants them. The reducer
never promotes a source `PASS` to independent acceptance and never issues a command.

Create state with `createKnowledgeObservationState`, read it with `projectKnowledgeObservation` (deterministic; four
separate dimensions: connection, freshness, native state, independent acceptance).

## Limits

Structural validity is not authenticity, source authorization, KC admission or deployment. Pending buffer and page limits
(`DEFAULT_KNOWLEDGE_OBSERVATION_LIMITS`) are test inputs, not approved production budgets.
