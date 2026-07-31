# Component provenance ledger — Arcanada Shared

**Visibility:** public. **Licence:** MIT (see `LICENSE`).

This repository is declared eligible **only** for clean-room public utilities
that contain no WHITE-LABEL donor-derived source. That eligibility rule is the
whole reason the repository can be public, so anything arriving here needs a
record of where it came from and what was checked — otherwise "clean-room" is a
claim nobody can audit after the fact.

This ledger exists for **relocated** components: packages authored elsewhere and
moved in. Packages written here from scratch do not need a row; their provenance
is the repository's own history.

> **Not a publication clearance.** A row below records what a component *is*,
> not what may be done with it. Publishing any package remains a separate,
> operator-gated decision governed by `.github/workflows/release.yml` and the
> release policy, and no row here authorises it.

## Relocated components

| Package | Origin repository | Origin commit | Arrived via | Licence tier | Donor-derived content | Identifier scan | Date |
|---|---|---|---|---|---|---|---|
| `packages/access-contracts` | `Arcanada-one/arcanada-design-system` (private) | `9a69871` (last commit before removal; deleted there in `#7` / `6a55d7c`) | arrival `arcanada-shared#8`; deletion `arcanada-design-system#7`; git-installability `arcanada-shared#9` | MIT — clean-room, **not** WHITE-LABEL | **None.** Zero dependencies, zero donor-template identifiers; the origin repository's own ledger recorded "no donor code present" for it while it lived there | clean — `scanned_file_count=6`, zero matches against the 5 committed deny-list digests (2026-07-31) | 2026-07-31 |

### Why this move was safe to make

The package is a closed capability vocabulary plus hand-written, total
validators. It takes no dependencies on purpose — a shared contract package is
imported by everything, so every dependency it takes is taken by every consumer.
It carries no styling, no component markup and no layout: none of the surfaces
that donor-derived material would actually land in. `@arcanada/ui` deliberately
stayed behind in the private repository for exactly that reason — it is the
package that will carry donor-derived styling, and it is governed by the
white-label evidence gate.

### How the identifier scan was run, and why it is not run here

The scanner and its salted deny-list live in the private
`Arcanada-one/arcanada-design-system` (`tools/identifier-scan/`). The scan over
this tree is therefore executed **from that repository**, pointed at this one:

```
node tools/identifier-scan/scan.mjs \
  --root <path-to-arcanada-shared> \
  --hashes tools/identifier-scan/donor-identifier-hashes.txt \
  --paths <each file under packages/access-contracts>
```

The deny-list is deliberately **not** copied here. Its own header states that
hashing buys neutrality rather than secrecy and that short tokens are
brute-forceable; the operative control is custody of the cleartext seed. Copying
it into a public repository would widen that disclosure surface for no gain,
and widening it is not a call this ledger entry is entitled to make.

**Residual, recorded rather than papered over:** because the scan runs from the
other repository, it is *not* a gate on this repository's CI. Nothing here
mechanically prevents donor-derived content from being added to this package
later. The scan result above is a point-in-time attestation for the relocated
tree as of the date in the row, not a standing guarantee. Closing that gap means
either running the scanner here (which requires deciding to publish the
deny-list) or scanning this repository from a job in the private one — a
deliberate choice, not an oversight.

### Non-vacuity of the scan result

A clean scan is only meaningful if the scanner could have failed on this tree.
`scanned_file_count=6` proves it opened the files; it does not prove the matcher
fires. That was checked separately: re-running the same scanner over the same
six files with a synthetic deny-list built from a term that genuinely occurs in
them produced 12 matches across 4 files and a non-zero exit. The clean result
above is therefore a real negative rather than a matcher that never runs.
