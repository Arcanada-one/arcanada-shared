# @arcanada/book-package-inspector

Read-only structural inspector for Knowledge Contract `book-package/2`. **Private (not published); not part of the
`@arcanada/access-contracts` release.**

It takes the bytes of one package directory and returns:

- a **verdict** (`pass` / `refused`) with **typed, located refusals** (`RefusalCode`, `where`, the pinned checker's message);
- a **component table** (declared vs recomputed SHA-256 and byte count, `verified | missing | digest_mismatch | declared_missing`),
  filled in even when the package is refused;
- on `pass`, a **projection**: manifest, objects, relations, edits, quality, source work/edition, rights, every evidence anchor with
  its owner, relation endpoint resolution, and provenance (origin, generated vs author, reviewer/producer and whether the declared
  review separation holds and is bound to the current bytes), plus any files in the directory the manifest does not list.

`kc2_admission` is always `not_measured`. A package does not carry a Muneral run, a stream epoch or a native event identity, and this
module never invents one. `pass` means structure and cross-file coherence only; it is not extraction truth, semantic correctness,
source admission or publication permission. `knowledge_ready` is a package-status derivation, not an admission decision.

## Why a sibling package

`@arcanada/access-contracts` is deliberately dependency-free. Validating `book-package.schema.json` (JSON Schema 2020-12 with
`if/then`, `oneOf` and patterns) needs a schema engine; hand-writing one for a 735-line schema would be a second, unreviewed
interpretation of the contract. This package therefore takes `ajv` as its only runtime dependency, keeps the schema as vendored
unchanged bytes, and leaves `access-contracts` and its published surface untouched.

## Pins

| What                               | Value                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Repository / commit                | `Arcanada-one/knowledge-contract` @ `e351df0c28f0b9965a580f45b48a297d1872c3ce`                                           |
| `schemas/book-package.schema.json` | git blob `fd721e6f610547ab5ac3748dcbde76f14c3b0899` (vendored, bytes unchanged)                                          |
| `tools/check_book_package.py`      | git blob `0221e4ad301ecccf0868019c4c2575120a71b16c` (not vendored; verdicts recorded)                                    |
| Fixtures                           | `vendor/knowledge-contract-e351df0c/schemas/fixtures/book-package/` — 90 files, each checked against its pinned git blob |

`vendor/` is excluded from Prettier so the pinned bytes cannot be reformatted.

## Use

```ts
import { inspectBookPackage } from "@arcanada/book-package-inspector";
import { readPackageDirectory } from "@arcanada/book-package-inspector/node";

const result = inspectBookPackage(readPackageDirectory("/path/to/package")); // or any Map<string, Uint8Array>
```

```sh
book-package-inspect <package-dir> [--checker-repo <knowledge-contract checkout>]
# exit 0 pass, 1 refused, 2 usage/read error. With --checker-repo the pinned checker runs on the same directory and an `agreement`
# record (AGREE / DISAGREE / NOT_MEASURED) is added; a checkout that is not at the pinned commit/blobs yields NOT_MEASURED.
```

`readPackageDirectory` is read-only, does not follow symlinks (a linked component is reported missing, as `safe_file` does) and stops at
a file/byte limit. Hashing uses `node:crypto`, so this package is Node-only.

## How agreement with the pinned checker is established

1. `scripts/generate_checker_verdicts.py` runs the **pinned** checker (`check_package`, `schema_errors`) and the KC mutation registries
   from a checkout at the pin, plus the controls this package requires, and records every verdict in
   `test/fixtures/checker-verdicts.json`. It refuses to run if the checkout is not at the pinned commit and blobs.
2. `test/agreement.test.ts` replays the same bytes through the inspector and requires: the same verdict; for cross-file problems, the
   **same messages in the same order** (decoder wording normalised); for schema problems, every checker location covered by an inspector
   error at the same place or below it, and every inspector location related (equal / ancestor / descendant) to a checker location.
   ajv and python-jsonschema attribute `oneOf` / `if-then` failures at different depths, so exact schema-message equality is not claimed.

## Known differences from the pinned checker (all conservative)

- An integer literal outside the IEEE-754 safe range, or JSON nested deeper than 256, is refused (`unsupported_number` /
  `too_deep`); the checker has arbitrary-precision integers and would hit Python's recursion limit.
- Python's `\d` matches Unicode digits in schema patterns; JavaScript's matches ASCII only (ajv compiles patterns with the `u` flag).
- Invalid UTF-8 reports no byte offset; decoder error wording differs.
- A symlink cannot exist in a bytes map; `readPackageDirectory` omits symlinks, which surfaces as `component_missing`.
