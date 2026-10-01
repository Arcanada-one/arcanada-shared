# @arcanada/access-contracts

## 0.2.0

### Minor Changes

- fc1aff0: Export bounded strict JSON decoding with UTF-8 validation, duplicate-key rejection, and byte and nesting limits.
- b4f4430: Add a dependency-free versioned personal capture wire profile with strict bounded
  parsers, immutable object receipt matching, idempotency comparisons, and pure
  terminal transition preconditions. The profile validates structure only; it
  does not provide authorization, durable persistence, or atomic transactions.
