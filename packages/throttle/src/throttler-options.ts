import { seconds } from "@nestjs/throttler";
import type {
  ThrottlerModuleOptions,
  ThrottlerOptions,
  ThrottlerStorage,
} from "@nestjs/throttler";

/**
 * Layer 1 of the anti-abuse stack: a typed factory over `@nestjs/throttler`
 * v6 that pins the ecosystem's named-throttler convention (`short` / `medium`
 * / `long`) and tracks requests by authenticated principal first, IP second.
 *
 * The factory returns the *object* form of `ThrottlerModuleOptions` so it can
 * carry a top-level `getTracker` (the canonical v6 hook for custom tracking —
 * not `generateKey`, which only namespaces an already-resolved tracker) and an
 * optional distributed `storage` provider. Pass the result straight into
 * `ThrottlerModule.forRoot(createThrottlerOptions(...))`.
 */

/** A single tier's tunable knobs. `ttl` is in milliseconds (use `seconds()`). */
export interface ThrottlerTier {
  limit: number;
  ttl: number;
}

export interface CreateThrottlerOptionsConfig {
  short?: ThrottlerTier;
  medium?: ThrottlerTier;
  long?: ThrottlerTier;
  /**
   * Optional distributed storage. Inject a `ThrottlerStorage` implementation
   * (e.g. `new ThrottlerStorageRedisService(redis)` from
   * `@nest-lab/throttler-storage-redis`) to share counters across instances.
   * Omitted → throttler uses its in-memory default.
   */
  storage?: ThrottlerStorage;
}

const DEFAULT_TIERS: Record<"short" | "medium" | "long", ThrottlerTier> = {
  short: { limit: 20, ttl: seconds(30) },
  medium: { limit: 60, ttl: seconds(120) },
  long: { limit: 200, ttl: seconds(600) },
};

/**
 * A request shape with the two fields we read. Kept structural (not tied to
 * Express/Fastify) so the tracker works under either HTTP adapter.
 */
export interface TrackedRequest {
  user?: { id?: string | number };
  ip?: string;
}

/**
 * Removes characters that act as separators inside a Redis key, so a crafted
 * `user_id` (e.g. `victim:id`) cannot forge or collide with another bucket
 * (Appendix A-4, threat T2). Lower-cases for stable, case-insensitive keys.
 */
export function normalizeTrackerKey(value: string): string {
  return value
    .trim()
    .replace(/[\s:;,]+/g, "-")
    .toLowerCase();
}

/**
 * Builds a `getTracker`-compatible function: authenticated `user.id` wins over
 * `ip`, so a banned principal cannot reset their counter by rotating IPs
 * (threat T3). The returned value is namespaced (`user:` / `ip:`) and
 * normalized.
 */
export function buildPrincipalTracker(): (
  req: TrackedRequest,
) => Promise<string> {
  return async (req: TrackedRequest): Promise<string> => {
    const userId = req.user?.id;
    if (userId !== undefined && userId !== null && `${userId}` !== "") {
      return `user:${normalizeTrackerKey(`${userId}`)}`;
    }
    if (req.ip) {
      return `ip:${normalizeTrackerKey(req.ip)}`;
    }
    return "anonymous";
  };
}

export function createThrottlerOptions(
  config: CreateThrottlerOptionsConfig = {},
): Extract<ThrottlerModuleOptions, { throttlers: ThrottlerOptions[] }> {
  const tracker = buildPrincipalTracker();
  const throttlers: ThrottlerOptions[] = [
    { name: "short", ...DEFAULT_TIERS.short, ...config.short },
    { name: "medium", ...DEFAULT_TIERS.medium, ...config.medium },
    { name: "long", ...DEFAULT_TIERS.long, ...config.long },
  ];

  return {
    throttlers,
    // Canonical v6 hook for per-principal tracking (README: getTracker).
    getTracker: (req) => tracker(req as TrackedRequest),
    ...(config.storage ? { storage: config.storage } : {}),
  };
}
