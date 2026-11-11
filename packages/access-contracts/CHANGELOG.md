# @arcanada/access-contracts

## 0.2.0

### Minor Changes

- fc1aff0: Export bounded strict JSON decoding with UTF-8 validation, duplicate-key rejection, and byte and nesting limits.
- 9af8991: Knowledge observation reducer: repairs from the Agent-Brain consumer-boundary review. A changed trusted binding (another project, run or scope, or another authenticated `sessionRef`) now clears every private field atomically and requires a fresh full snapshot, a same-scope epoch change through a plain bind is refused (`REBIND_REQUIRES_TRUSTED_EPOCH_RESET`) and a trusted epoch reset clears old-epoch ancillary catalogs and histories. Lifetime retained state is bounded by explicit budgets (`maxRetainedIdentities`, `maxRetainedBytes`, `maxAncillaryRecords`, 512-entry histories); exhaustion holds the last trusted view with `RETENTION_LIMIT_EXCEEDED` and a trusted full snapshot is the compaction boundary. One page-age predicate now guards page, manifest, tick and completion paths, so a late trusted manifest cannot install an expired page assembly.
- 8282f9d: Add the Knowledge Collective Live Lab observation profile v1, additively and dependency-free: `parseKnowledgeObservationJson` (bounded frames through `parseBoundedJson`, strict versioned decoding with string decimal counters and RFC3339 times) and a pure `reduceKnowledgeObservation` / `projectKnowledgeObservation` that emits zero commands in live, replay and fixture modes. Reviewer corrections (amendment 1): a source FAIL no longer needs aggregate PASS decision refs and is labelled an unverified source observation; paged snapshots become current only with an adapter-sealed page-set manifest (`trusted_page_set_manifest`, `knowledgeObservationPageDigest`); same-watermark equality compares the complete normalised projection; a verified replay interval can still recover a gap.
- 4b4c977: Add structural personal authorization capture binding checks for intent, part,
  and terminal cancellation resources, with portable conformance vectors.
- 58c301f: Add proposed issued personal lease and bounded release-unit structure checks
  and exact admission comparison with portable conformance vectors.
- 50d0b0d: Add proposed personal owner outcome structure checks, source effect mapping and
  exact retry comparison using existing capture parsers and portable synthetic
  conformance vectors. These structures grant no authority or durable settlement.
- b4f4430: Add a dependency-free versioned personal capture wire profile with strict bounded
  parsers, immutable object receipt matching, idempotency comparisons, and pure
  terminal transition preconditions. The profile validates structure only; it
  does not provide authorization, durable persistence, or atomic transactions.

### Patch Changes

- 7a195bb: Add proposed protected owner-outcome requests and same-generation structural lease compatibility without runtime authorization.
