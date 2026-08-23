import { describe, expect, it } from "vitest";
import { SequenceTracker } from "./sequence.js";

describe("SequenceTracker", () => {
  it("starts with no known sequence by default", () => {
    expect(new SequenceTracker().lastKnownSequence).toBeNull();
  });

  it("advances on a strictly greater sequence", () => {
    const tracker = new SequenceTracker();
    expect(tracker.observe(5)).toBe(true);
    expect(tracker.lastKnownSequence).toBe(5);
  });

  it("never moves backward on an out-of-order or replayed message", () => {
    const tracker = new SequenceTracker(10);
    expect(tracker.observe(3)).toBe(false);
    expect(tracker.lastKnownSequence).toBe(10);
  });

  it("does not advance on an exact repeat", () => {
    const tracker = new SequenceTracker(10);
    expect(tracker.observe(10)).toBe(false);
    expect(tracker.lastKnownSequence).toBe(10);
  });

  it("seeds from a stored value, e.g. resumed from localStorage across a page reload", () => {
    const tracker = new SequenceTracker(42);
    expect(tracker.lastKnownSequence).toBe(42);
    expect(tracker.observe(43)).toBe(true);
  });
});
