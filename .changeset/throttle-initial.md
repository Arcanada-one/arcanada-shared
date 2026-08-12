---
"@arcanada/throttle": minor
---

Initial release of `@arcanada/throttle`: a two-layer anti-abuse toolkit for
NestJS. Layer 1 is `createThrottlerOptions()` — a typed factory over
`@nestjs/throttler` v6 that pins the `short` / `medium` / `long` named-throttler
convention and tracks requests by authenticated principal first, IP second
(`buildPrincipalTracker`, `normalizeTrackerKey`). Layer 2 is
`EscalatingBanGuard` — an escalating ban over `rate-limiter-flexible` whose
block duration grows along a capped Fibonacci ladder
(`getFibonacciBlockDurationMinutes`) and holds even for authenticated users,
without resetting when the source IP changes. Runs in-memory by default; inject
an ioredis client for distributed state. Framework and storage dependencies are
peer-only (`ioredis` optional).
