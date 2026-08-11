---
"@arcanada/nest-common": minor
---

Move to Zod 4 and narrow the peer range to `zod >= 4` (was `>= 3`).

`ZodValidationPipe` re-exports Zod's own issue `code` as part of this package's
published error contract, so the contract is only stable within a Zod major.
Zod 4 renamed `invalid_string` to `invalid_format` and collapsed both
`invalid_enum_value` and `invalid_literal` into `invalid_value`. Under the old
`>= 3` peer range a single published version would emit either set depending on
which Zod the consumer resolved, so the range is now pinned to the major this
package is built, tested and documented against.

The pipe's generic constraint moves from `ZodTypeAny` — which survives in Zod 4
only through its legacy compat shim — to the canonical `ZodType`, keeping the
deprecated alias out of the published `.d.ts`.

Consumers on Zod 3 must upgrade to Zod 4, and any client branching on
`issues[].code` for string-format, enum or literal failures must be updated to
the new codes. The `code` values are now pinned per validation kind in the test
suite, and the README documents the Zod 3 to Zod 4 mapping.
