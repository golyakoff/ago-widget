import { beforeEach, describe, expect, it } from "vitest";
import { WidgetStorage } from "./storage.js";

describe("WidgetStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a visitor session", () => {
    const storage = new WidgetStorage("site_a");
    storage.setVisitorSession({ token: "t", visitorId: "v" });
    expect(storage.getVisitorSession()).toEqual({ token: "t", visitorId: "v" });
  });

  it("scopes keys per site - one site's storage never reads another's", () => {
    new WidgetStorage("site_a").setVisitorSession({ token: "a-token", visitorId: "a-visitor" });
    const siteB = new WidgetStorage("site_b");
    expect(siteB.getVisitorSession()).toBeNull();
  });

  it("returns null for a sequence that was never stored", () => {
    const storage = new WidgetStorage("site_a");
    expect(storage.getLastKnownSequence("conv-1")).toBeNull();
  });

  it("round-trips a last-known sequence per conversation", () => {
    const storage = new WidgetStorage("site_a");
    storage.setLastKnownSequence("conv-1", 7);
    expect(storage.getLastKnownSequence("conv-1")).toBe(7);
  });
});
