import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIBONACCI_CAP_MINUTES,
  getFibonacciBlockDurationMinutes,
} from "../src/fibonacci.js";

describe("getFibonacciBlockDurationMinutes", () => {
  it("returns 0 for a violation index below 1 (no ban yet)", () => {
    expect(getFibonacciBlockDurationMinutes(0)).toBe(0);
    expect(getFibonacciBlockDurationMinutes(-3)).toBe(0);
  });

  it("follows the Fibonacci ladder for the first violations", () => {
    // n is 1-indexed: 1st violation → 1 min, 2nd → 2, 3rd → 3, 4th → 5, 5th → 8.
    expect(getFibonacciBlockDurationMinutes(1)).toBe(1);
    expect(getFibonacciBlockDurationMinutes(2)).toBe(2);
    expect(getFibonacciBlockDurationMinutes(3)).toBe(3);
    expect(getFibonacciBlockDurationMinutes(4)).toBe(5);
    expect(getFibonacciBlockDurationMinutes(5)).toBe(8);
  });

  it("grows monotonically until it reaches the cap", () => {
    let prev = getFibonacciBlockDurationMinutes(1);
    for (let n = 2; n <= 10; n++) {
      const cur = getFibonacciBlockDurationMinutes(n);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });

  it("caps the duration at the default ceiling (security: no unbounded growth)", () => {
    // A very large violation index must not exceed the cap.
    expect(getFibonacciBlockDurationMinutes(1_000_000)).toBe(
      DEFAULT_FIBONACCI_CAP_MINUTES,
    );
  });

  it("respects a custom cap", () => {
    // 5th violation is normally 8 min; a cap of 5 clamps it.
    expect(getFibonacciBlockDurationMinutes(5, 5)).toBe(5);
    // Below the cap the ladder value is returned unchanged.
    expect(getFibonacciBlockDurationMinutes(3, 5)).toBe(3);
  });
});
