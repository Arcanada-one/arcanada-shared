// Layer 1 — named @nestjs/throttler configuration + principal tracker.
export {
  createThrottlerOptions,
  buildPrincipalTracker,
  normalizeTrackerKey,
  type CreateThrottlerOptionsConfig,
  type ThrottlerTier,
  type TrackedRequest,
} from "./throttler-options.js";

// Layer 2 — escalating ban guard with Fibonacci block growth.
export {
  EscalatingBanGuard,
  type EscalatingBanGuardOptions,
} from "./escalating-ban.guard.js";

// Ban-duration ladder (exported for consumers that want to tune / inspect it).
export {
  DEFAULT_FIBONACCI_CAP_MINUTES,
  getFibonacciBlockDurationMinutes,
} from "./fibonacci.js";
