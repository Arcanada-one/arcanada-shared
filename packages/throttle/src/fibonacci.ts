/**
 * Block-duration ladder for the escalating ban.
 *
 * Each repeated violation by the same principal is punished longer than the
 * last, following the Fibonacci sequence in minutes (1, 2, 3, 5, 8, 13, …).
 * The growth is clamped at a ceiling so a determined abuser can never push the
 * ban into an effectively-permanent or integer-overflowing duration — the cap
 * is the security control against unbounded growth (Appendix A-5).
 */

/** Default ceiling: 24 hours. A single key is never banned longer than this. */
export const DEFAULT_FIBONACCI_CAP_MINUTES = 1440;

/**
 * Returns the ban duration in minutes for the `n`-th violation (1-indexed).
 *
 * - `n < 1` → `0` (nothing to ban yet).
 * - `1 → 1`, `2 → 2`, `3 → 3`, `4 → 5`, `5 → 8`, … (Fibonacci, in minutes).
 * - The result is clamped to `cap` (default {@link DEFAULT_FIBONACCI_CAP_MINUTES}).
 *
 * The sequence is computed iteratively rather than read from a fixed table, so
 * there is no arbitrary upper index — large `n` simply saturates at `cap`.
 */
export function getFibonacciBlockDurationMinutes(
  n: number,
  cap: number = DEFAULT_FIBONACCI_CAP_MINUTES,
): number {
  if (n < 1) return 0;

  // Walk the Fibonacci ladder until we reach the n-th term or the cap.
  // a is fib(1) = 1, b is fib(2) = 2 in this minute-mapped sequence.
  let a = 1;
  let b = 2;
  for (let i = 1; i < n; i++) {
    if (a >= cap) return cap;
    const next = a + b;
    a = b;
    b = next;
  }
  return Math.min(a, cap);
}
