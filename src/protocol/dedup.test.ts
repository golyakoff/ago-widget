import { describe, expect, it } from "vitest";
import { SeenMessageIds, newClientMessageId } from "./dedup.js";

describe("SeenMessageIds", () => {
  it("reports the first occurrence of an id as new", () => {
    const seen = new SeenMessageIds();
    expect(seen.markSeen("a")).toBe(true);
  });

  it("reports a repeated id as already seen - the fan-out redelivery case", () => {
    const seen = new SeenMessageIds();
    seen.markSeen("a");
    expect(seen.markSeen("a")).toBe(false);
  });

  it("evicts the oldest id once over capacity, rather than growing unbounded", () => {
    const seen = new SeenMessageIds(2);
    seen.markSeen("a");
    seen.markSeen("b");
    seen.markSeen("c"); // evicts "a"

    expect(seen.markSeen("a")).toBe(true); // forgotten, treated as new again
    expect(seen.markSeen("c")).toBe(false); // still remembered
  });
});

describe("newClientMessageId", () => {
  it("generates a unique id on every call", () => {
    const ids = new Set(Array.from({ length: 20 }, () => newClientMessageId()));
    expect(ids.size).toBe(20);
  });
});
