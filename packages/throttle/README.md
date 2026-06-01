# @arcanada/throttle

Two-layer anti-abuse for NestJS backends in the Arcanada ecosystem.

- **Layer 1 — named throttlers.** `createThrottlerOptions()` is a typed factory
  over [`@nestjs/throttler`](https://github.com/nestjs/throttler) v6. It pins the
  ecosystem's `short` / `medium` / `long` convention and tracks each request by
  authenticated principal first, source IP second (`buildPrincipalTracker`).
- **Layer 2 — escalating ban.** `EscalatingBanGuard` (over
  [`rate-limiter-flexible`](https://github.com/animir/node-rate-limiter-flexible))
  remembers how often a principal has misbehaved and lengthens the ban on each
  fresh round of violations along a **capped Fibonacci ladder**
  (1, 2, 3, 5, 8 … minutes). The ban is keyed by `user.id` first, so it holds
  even for authenticated abusers and **cannot be reset by rotating IPs**.

Framework and storage packages are **peer dependencies**; `ioredis` is optional
(omit it and both layers run in-memory).

## Install

```bash
pnpm add @arcanada/throttle @nestjs/throttler rate-limiter-flexible
# optional, for distributed state across instances:
pnpm add ioredis
```

## Layer 1 — named throttlers

```ts
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { createThrottlerOptions } from "@arcanada/throttle";

@Module({
  imports: [
    ThrottlerModule.forRoot(
      createThrottlerOptions({
        // override any tier; the rest keep their defaults
        short: { limit: 10, ttl: 30_000 },
      }),
    ),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

`createThrottlerOptions()` wires a `getTracker` that returns `user:<id>` for
authenticated requests and `ip:<addr>` otherwise, both normalized to defeat
Redis key-injection. To share counters across instances, pass a
`ThrottlerStorage` implementation (e.g. `@nest-lab/throttler-storage-redis`) via
the `storage` option.

## Layer 2 — escalating ban

```ts
import { APP_GUARD } from "@nestjs/core";
import { EscalatingBanGuard } from "@arcanada/throttle";
import Redis from "ioredis";

const guard = new EscalatingBanGuard({
  violationThreshold: 5, // violations per window before a ban
  violationWindowSeconds: 60,
  capMinutes: 1440, // ban never exceeds 24h
  failClosed: true, // reject (503) if the limiter backend errors
  redis: new Redis(process.env.REDIS_URL), // omit → in-memory
});

@Module({ providers: [{ provide: APP_GUARD, useValue: guard }] })
export class AppModule {}
```

### Ban ladder

`getFibonacciBlockDurationMinutes(n, cap?)` is exported if you want to inspect or
reuse the ladder. Round `n` (1-indexed) maps to the `n`-th Fibonacci minute,
clamped at `cap` (default 24h) — the cap is the control against unbounded growth.

## Security notes

- **Fail-closed by default** — a limiter-backend error rejects with `503`. Opt
  into graceful degradation with `failClosed: false`.
- **Key-injection defence** — principal identifiers are normalized
  (`normalizeTrackerKey`) before they enter a Redis key.
- **IP-rotation resistant** — escalation is keyed by `user.id` for authenticated
  principals, so changing IP does not reset the ladder.

## License

MIT
