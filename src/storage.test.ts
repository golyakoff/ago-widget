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
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
    expect(storage.getVisitorSession()).toEqual({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
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
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
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
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
    expect(storage.getVisitorSession()).toEqual({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: "#2F6FED",
      widgetPosition: "BottomLeft",
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
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
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
    expect(storage.getVisitorSession()).toEqual({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: "Ru",
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
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
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
    expect(storage.getVisitorSession()).toEqual({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: "We read what you send us.",
      widgetNoticeUrl: "https://tenant.example/privacy",
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
  });

  // `25-129`: the tenant's own contact-capture confirmation text, round-tripped the same way
  // `widgetNoticeText` already is.
  it("round-trips the widget contact-capture confirmation text alongside the identity, 25-129", () => {
    const storage = new WidgetStorage("site_a");
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: "Thanks, {name} - your details have been added.",
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
    expect(storage.getVisitorSession()).toEqual({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: "Thanks, {name} - your details have been added.",
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
  });

  // `23-105`: the sixth cached field, round-tripped the same way - the site's granted module keys,
  // the fact that used to be `data-booking` on the tenant's own page (`config.ts`'s own remarks).
  it("round-trips the site's enabled module keys alongside the identity, 23-105", () => {
    const storage = new WidgetStorage("site_a");
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: ["calendar"],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
    expect(storage.getVisitorSession()).toEqual({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: ["calendar"],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
  });

  // `25-131`: an additive sibling of the module-key list above, round-tripped the same way - the
  // real-tenant value `docs/backlog/25-131-*.md` found live (`/записаться`, not `/booking`), proving
  // this cache preserves the site's own configured word exactly, not a value this widget invents.
  it("round-trips the site's own module trigger words alongside the identity, 25-131", () => {
    const storage = new WidgetStorage("site_a");
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: ["calendar"],
      enabledModuleTriggerWords: { calendar: ["/записаться"] },
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
    expect(storage.getVisitorSession()).toEqual({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: ["calendar"],
      enabledModuleTriggerWords: { calendar: ["/записаться"] },
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
  });

  // `23-63`: the seventh cached field, round-tripped the same way - a plain boolean rather than
  // `T | null`, so "on" is the only value that survives the round trip as anything but the default.
  it("round-trips whether the tenant turned on attract-attention, 23-63", () => {
    const storage = new WidgetStorage("site_a");
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: true,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
    expect(storage.getVisitorSession()).toEqual({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: true,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
  });

  it("clears a previously-cached attract-attention flag once a later write turns it off", () => {
    const storage = new WidgetStorage("site_a");
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: true,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
    expect(storage.getVisitorSession()?.widgetAttractAttention).toBe(false);
  });

  it("clears a previously-cached color/position/locale/notice/modules once a later write omits them", () => {
    const storage = new WidgetStorage("site_a");
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: "#2F6FED",
      widgetPosition: "BottomLeft",
      widgetLocale: "Ru",
      widgetNoticeText: "We read what you send us.",
      widgetNoticeUrl: "https://tenant.example/privacy",
      enabledModules: ["calendar"],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
    });
    expect(storage.getVisitorSession()).toEqual({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: null,
      widgetPosition: null,
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: [],
      enabledModuleTriggerWords: {},
      channelLinks: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
      widgetContactCaptureConfirmationText: null,
      widgetChannelSwitcherPlacement: null,
      widgetChannelSwitcherIconSize: null,
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

  it("returns null for a read watermark that was never stored, 25-143", () => {
    const storage = new WidgetStorage("site_a");
    expect(storage.getLastReadSequence("conv-1")).toBeNull();
  });

  it("round-trips a read watermark per conversation, distinct from the last-known sequence, 25-143", () => {
    const storage = new WidgetStorage("site_a");
    storage.setLastKnownSequence("conv-1", 7);
    storage.setLastReadSequence("conv-1", 4);

    expect(storage.getLastReadSequence("conv-1")).toBe(4);
    expect(storage.getLastKnownSequence("conv-1")).toBe(7);
  });

  it("clears both the last-known sequence and the read watermark for the current conversation, 25-143", () => {
    const storage = new WidgetStorage("site_a");
    storage.setConversationId("conv-1");
    storage.setLastKnownSequence("conv-1", 7);
    storage.setLastReadSequence("conv-1", 4);

    storage.clearConversation();

    expect(storage.getConversationId()).toBeNull();
    expect(storage.getLastKnownSequence("conv-1")).toBeNull();
    expect(storage.getLastReadSequence("conv-1")).toBeNull();
  });
});
