# Knowledge observation profile v1 (Live Lab)

Additive, dependency-free decoder and pure reducer for `knowledge-collective-observation/v1`, the shared run / event /
snapshot / attempt / artifact / command / deployment observation contract behind the Live Lab. It is the one
implementation both sites import; there is no per-site copy.

Sources: Agent-Brain's observation package (`documentation/plans/knowledge-collective-live-lab/observation-profile-v1/`
in `Arcanada-one/arcanada-workspace`, manifest sha256 `447266fc13b38a5d3a997c885edd349e4efaf84007e0be271af5ddcf4322d09d`)
and `implementation-contracts/2026-11-06/SHARED-OBSERVATION.md`. The schema is vendored unmodified as
`src/knowledge-observation-v1.schema.json` and interpreted by a small total validator (no schema library at runtime;
`ajv` is a test-only oracle).

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
which the reducer assembles under one watermark with count, byte and age limits. A page set stays partial until a page
declares itself final (`next_page_token: null`, `complete: true`) and every declared graph kind has arrived; only then
does it go through the normal full-snapshot rules.

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
