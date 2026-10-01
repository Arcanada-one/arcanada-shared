# @arcanada/access-contracts

## 0.2.0

### Minor Changes

- fc1aff0: Export bounded strict JSON decoding with UTF-8 validation, duplicate-key rejection, and byte and nesting limits.
- 4b4c977: Add structural personal authorization capture binding checks for intent, part,
  and terminal cancellation resources, with portable conformance vectors.
- 58c301f: Add proposed issued personal lease and bounded release-unit structure checks
  and exact admission comparison with portable conformance vectors.
- b4f4430: Add a dependency-free versioned personal capture wire profile with strict bounded
  parsers, immutable object receipt matching, idempotency comparisons, and pure
  terminal transition preconditions. The profile validates structure only; it
  does not provide authorization, durable persistence, or atomic transactions.
