# Semantic status exports

This private workspace package generates deterministic CSS, JSON and TypeScript
from a finite status vocabulary: operational, degraded, outage and unknown.
The bundled colors are original neutral fixtures licensed MIT. They are not a
brand palette or a replacement for an application's theme authority.

Run `pnpm --filter @arcanada/frontend-tokens build` and
`pnpm --filter @arcanada/frontend-tokens test`. The CLI also accepts an explicit
input path and output directory. CSS only declares `--arc-status-*` variables;
it adds no reset, framework, selector for application state or external asset.

Each input declares public distribution, an allowlisted permissive license and
its origin. These declarations require independent source review; the validator
cannot establish rights from a caller's assertion. Never pass private palettes,
mandatory overlays or restricted brand assets into this public export path.
Alias references use `{ "ref": "operational" }` and resolve to a color. Cycles,
missing references, duplicate or unknown roles, unsupported types and unsafe
CSS values fail with fixed diagnostic codes that omit input bodies.

Consumer mappings preserve meaning independently of color: operational maps to
success, degraded to warning, outage to error, and unknown to a neutral or info
presentation with explicit unknown text. A MUI fixture must bind these exported
values to the corresponding palette keys. Text, icon, role, keyboard behavior,
contrast, theme overrides and native no-JS fallback require consumer checks;
token generation cannot accept them. Package publication is outside this change.
