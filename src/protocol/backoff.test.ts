import { describe, expect, it, vi } from "vitest";
import { jitteredDelayMs } from "./backoff.js";

describe("jitteredDelayMs", () => {
  it("never exceeds the exponential cap for the given attempt", () => {
    const options = { baseDelayMs: 1000, maxDelayMs: 30_000 };
    for (let attempt = 1; attempt <= 10; attempt++) {
      const cap = Math.min(options.baseDelayMs * 2 ** (attempt - 1), options.maxDelayMs);
      const delay = jitteredDelayMs(attempt, options);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(cap);
    }
  });

  it("saturates at maxDelayMs rather than growing unbounded", () => {
    const options = { baseDelayMs: 1000, maxDelayMs: 5000 };
    const spy = vi.spyOn(Math, "random").mockReturnValue(1);
    try {
      expect(jitteredDelayMs(20, options)).toBe(options.maxDelayMs);
    } finally {
      spy.mockRestore();
    }
  });

  it("is not deterministic across calls (full jitter, not fixed backoff)", () => {
    const spy = vi.spyOn(Math, "random");
    spy.mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);
    try {
      const first = jitteredDelayMs(5);
      const second = jitteredDelayMs(5);
      expect(first).not.toBe(second);
    } finally {
      spy.mockRestore();
    }
  });
});
