import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import {
  RateLimiterMemory,
  RateLimiterRes,
  type RateLimiterAbstract,
} from "rate-limiter-flexible";
import {
  DEFAULT_FIBONACCI_CAP_MINUTES,
  getFibonacciBlockDurationMinutes,
} from "./fibonacci.js";
import {
  buildPrincipalTracker,
  type TrackedRequest,
} from "./throttler-options.js";

/**
 * Layer 2: an escalating-ban guard. Unlike a plain rate limiter, it *remembers*
 * how many times a principal has misbehaved and lengthens the ban on each fresh
 * round of violations, following the Fibonacci ladder (1, 2, 3, 5, 8 … minutes,
 * capped). The ban is keyed by authenticated `user.id` first, IP second, so it
 * holds even for logged-in abusers and cannot be reset by rotating IPs.
 *
 * Two `rate-limiter-flexible` limiters back it:
 * - **counter** — a sliding window that counts recent violations; crossing its
 *   threshold triggers an escalation.
 * - **ban** — holds the active block; its `block(key, seconds)` is what the
 *   guard rejects against, and a per-key violation-round tally drives how long
 *   each successive ban lasts.
 *
 * No `redis` option → both limiters run in-memory (single-instance / tests).
 * Inject `redis` (an ioredis client) to share state across instances; the guard
 * builds `RateLimiterRedis` limiters over it. The two are never mixed.
 */

export interface EscalatingBanGuardOptions {
  /** Violations within the window before a ban is (re)applied. Default 5. */
  violationThreshold?: number;
  /** Sliding-window length for the violation counter, seconds. Default 60. */
  violationWindowSeconds?: number;
  /** Upper bound of the Fibonacci ban ladder, minutes. Default 1440 (24h). */
  capMinutes?: number;
  /** On limiter-backend error: true → reject (503), false → allow. Default true. */
  failClosed?: boolean;
  /**
   * Optional ioredis client for distributed state. Omitted → in-memory.
   * Typed as `unknown` to avoid a hard `ioredis` type dependency in consumers
   * that only use the in-memory path.
   */
  redis?: unknown;
}

type RequiredOpts = Required<Omit<EscalatingBanGuardOptions, "redis">>;

const KEY_PREFIX = "arcanada-escalating-ban";

@Injectable()
export class EscalatingBanGuard implements CanActivate {
  private readonly opts: RequiredOpts;
  private readonly track: (req: TrackedRequest) => Promise<string>;
  /** Counts violations in a sliding window; reject = threshold crossed. */
  private readonly counter: RateLimiterAbstract;
  /** Holds the active ban; `block()` sets it, `get()` reads the remaining window. */
  private readonly ban: RateLimiterAbstract;
  /** Per-key tally of how many ban rounds a principal has earned (1-indexed). */
  private readonly rounds = new Map<string, number>();

  constructor(options: EscalatingBanGuardOptions = {}) {
    this.opts = {
      violationThreshold: options.violationThreshold ?? 5,
      violationWindowSeconds: options.violationWindowSeconds ?? 60,
      capMinutes: options.capMinutes ?? DEFAULT_FIBONACCI_CAP_MINUTES,
      failClosed: options.failClosed ?? true,
    };
    this.track = buildPrincipalTracker();

    if (options.redis) {
      // Lazy require keeps ioredis an optional peer for in-memory consumers.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { RateLimiterRedis } = require("rate-limiter-flexible");
      this.counter = new RateLimiterRedis({
        storeClient: options.redis,
        keyPrefix: `${KEY_PREFIX}:counter`,
        points: this.opts.violationThreshold,
        duration: this.opts.violationWindowSeconds,
      });
      this.ban = new RateLimiterRedis({
        storeClient: options.redis,
        keyPrefix: `${KEY_PREFIX}:ban`,
        points: 1,
        duration: 0, // ban duration is set explicitly via block()
      });
    } else {
      this.counter = new RateLimiterMemory({
        keyPrefix: `${KEY_PREFIX}:counter`,
        points: this.opts.violationThreshold,
        duration: this.opts.violationWindowSeconds,
      });
      this.ban = new RateLimiterMemory({
        keyPrefix: `${KEY_PREFIX}:ban`,
        points: 1,
        duration: 0,
      });
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TrackedRequest>();
    const key = await this.track(req);

    try {
      // 1. Already banned? A live ban leaves points consumed with time left.
      const active = await this.ban.get(key);
      if (active && active.consumedPoints > 0 && active.msBeforeNext > 0) {
        throw this.tooManyRequests();
      }

      // 2. Record this hit against the sliding violation window.
      try {
        await this.counter.consume(key);
        return true;
      } catch (counterErr) {
        if (counterErr instanceof RateLimiterRes) {
          // Threshold crossed → escalate the ban and reject.
          await this.escalate(key);
          throw this.tooManyRequests();
        }
        throw counterErr; // genuine backend error — handled below
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      if (this.opts.failClosed) {
        throw new HttpException(
          "Service Unavailable",
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      return true; // fail-open (opt-in)
    }
  }

  /** Applies the next Fibonacci ban tier for this key. */
  private async escalate(key: string): Promise<void> {
    const round = (this.rounds.get(key) ?? 0) + 1;
    this.rounds.set(key, round);
    const minutes = getFibonacciBlockDurationMinutes(
      round,
      this.opts.capMinutes,
    );
    await this.ban.block(key, minutes * 60);
  }

  private tooManyRequests(): HttpException {
    return new HttpException("Too Many Requests", HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Remaining ban window in seconds for a request's principal (0 = not banned). */
  async banSecondsRemaining(req: TrackedRequest): Promise<number> {
    const key = await this.track(req);
    const res = await this.ban.get(key);
    if (!res || res.consumedPoints <= 0 || res.msBeforeNext <= 0) return 0;
    return Math.ceil(res.msBeforeNext / 1000);
  }

  // --- test seams (prefixed __; not part of the public contract) ---

  /** Clears the active ban for a principal so a fresh round can be provoked. */
  async __unblockForTest(req: TrackedRequest): Promise<void> {
    const key = await this.track(req);
    await this.ban.delete(key);
    await this.counter.delete(key);
  }

  /** Replaces the counter with one that always throws, to exercise fail-closed. */
  __breakLimiterForTest(): void {
    const boom = {
      consume: () => Promise.reject(new Error("limiter backend down")),
      get: () => Promise.reject(new Error("limiter backend down")),
    } as unknown as RateLimiterAbstract;
    // @ts-expect-error overriding readonly for a controlled test seam
    this.counter = boom;
    // @ts-expect-error overriding readonly for a controlled test seam
    this.ban = boom;
  }
}
