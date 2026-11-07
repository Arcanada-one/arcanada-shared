---
"@arcanada/access-contracts": minor
---

Knowledge observation reducer: repairs from the Agent-Brain consumer-boundary review. A changed trusted binding (another project, run or scope, or another authenticated `sessionRef`) now clears every private field atomically and requires a fresh full snapshot, a same-scope epoch change through a plain bind is refused (`REBIND_REQUIRES_TRUSTED_EPOCH_RESET`) and a trusted epoch reset clears old-epoch ancillary catalogs and histories. Lifetime retained state is bounded by explicit budgets (`maxRetainedIdentities`, `maxRetainedBytes`, `maxAncillaryRecords`, 512-entry histories); exhaustion holds the last trusted view with `RETENTION_LIMIT_EXCEEDED` and a trusted full snapshot is the compaction boundary. One page-age predicate now guards page, manifest, tick and completion paths, so a late trusted manifest cannot install an expired page assembly.
