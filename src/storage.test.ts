import { beforeEach, describe, expect, it } from "vitest";
import { WidgetStorage } from "./storage.js";

describe("WidgetStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a visitor session", () => {
    const storage = new WidgetStorage("site_a");
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
    });
    expect(storage.getVisitorSession()).toEqual({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
    });
  });

  it("scopes keys per site - one site's storage never reads another's", () => {
    new WidgetStorage("site_a").setVisitorSession({
      token: "a-token",
      visitorId: "a-visitor",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
    });
    const siteB = new WidgetStorage("site_b");
    expect(siteB.getVisitorSession()).toBeNull();
  });

  it("round-trips widget config alongside the identity, 11-03", () => {
    const storage = new WidgetStorage("site_a");
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: "#2F6FED",
      widgetPosition: "BottomLeft",
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
    });
    expect(storage.getVisitorSession()).toEqual({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: "#2F6FED",
      widgetPosition: "BottomLeft",
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
    });
  });

  // `11-10`: the third cached field, round-tripped the same way the two `11-03` fields already are.
  it("round-trips the widget locale alongside the identity, 11-10", () => {
    const storage = new WidgetStorage("site_a");
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: "Ru",
      widgetNoticeText: null,
      widgetNoticeUrl: null,
    });
    expect(storage.getVisitorSession()).toEqual({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: "Ru",
      widgetNoticeText: null,
      widgetNoticeUrl: null,
    });
  });

  // `16-04`: the fourth and fifth cached fields, round-tripped the same way.
  it("round-trips the widget notice text and link alongside the identity, 16-04", () => {
    const storage = new WidgetStorage("site_a");
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: "We read what you send us.",
      widgetNoticeUrl: "https://tenant.example/privacy",
    });
    expect(storage.getVisitorSession()).toEqual({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: "We read what you send us.",
      widgetNoticeUrl: "https://tenant.example/privacy",
    });
  });

  it("clears a previously-cached color/position/locale/notice once a later write omits them", () => {
    const storage = new WidgetStorage("site_a");
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: "#2F6FED",
      widgetPosition: "BottomLeft",
      widgetLocale: "Ru",
      widgetNoticeText: "We read what you send us.",
      widgetNoticeUrl: "https://tenant.example/privacy",
    });
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
    });
    expect(storage.getVisitorSession()).toEqual({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
    });
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
