# JEV canary harness (ARCA-JEV-03)

Offline class-(a)/(b) canary corpus, harness-only `--defences-off` /
`--defences-on` stand, and AC-25 mutation stand.

## Commands

From the repository root:

```sh
python3 eval/canary/run.py --defences-on
python3 eval/canary/run.py --defences-off
python3 eval/canary/run.py --mutation-stand
```

Node coverage lives in `tests/canary.test.mjs` (picked up by root `pnpm test`
via `tests/*.test.mjs`).

A stand that does not redden with defences off is not a stand (fail). Live
provider metrics remain `NOT_MEASURED` without an authorized route key.
`--defences-off` exists only under `eval/`; it is absent from service config.
