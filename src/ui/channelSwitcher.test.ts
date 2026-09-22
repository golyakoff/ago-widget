import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { WidgetConfig } from "../config.js";
import { hubs, joinQueue, resetFakeSignalR } from "../testing/fakeSignalR.js";

/**
 * `25-204`: the `AboveComposer` placement's own renderer - a hover-revealed floating banner above
 * the toggle, outside the chat panel entirely, replacing `25-149`'s original inside-panel card
 * (`loadChannelSwitcherCard`, retired outright by this item). The console's own label for this
 * placement, "Banners above the chat window" (`ago-console`), was true of nothing the retired card
 * ever built - a card spliced directly above the composer, *inside* the open panel - which is the
 * defect this item exists to fix and this file exists to prove fixed.
 *
 * Modeled on `channelSwitcherLauncher.test.ts`'s own shape for the hover mechanism (fake timers,
 * `hoverToggle`/`unhoverToggle`, `HOVER_REGION_LEAVE_GRACE_MS`) - this banner reuses `25-203`'s own
 * `isHoverRegionActive`/`enterHoverRegion`/`scheduleHoverRegionLeave` mechanism by name rather than a
 * second, parallel implementation, so its own visibility tests are the identical shape that file
 * already proves for `BelowLauncher`'s row - and on this file's own pre-`25-204` shape for the row
 * content (real link attributes, brand icons, unrecognised-kind fallback) - `buildChannelSwitcherRow`
 * itself is untouched by this item, only where its output is mounted changed.
 */
vi.mock("@microsoft/signalr", () => import("../testing/fakeSignalR.js"));

const { ChatWidget, HOVER_REGION_LEAVE_GRACE_MS } = await import("./widget.js");

const config: WidgetConfig = {
  siteKey: "shop_test",
  apiBaseUrl: "https://api.test.invalid",
  demoNotice: "none",
  policyBaseUrl: "https://office.test.invalid",
  scriptUrl: "https://cdn.test.invalid/dist/widget.js",
};

async function flush(): Promise<void> {
  for (let i = 0; i < 25; i++) {
    await Promise.resolve();
  }
}

interface ChannelLinkFixture {
  kind: string;
  url: string;
}

function stubFetch(overrides: Record<string, unknown> = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            token: "visitor-token",
            visitorId: "99999999-9999-9999-9999-999999999999",
            widgetPrimaryColorHex: null,
            widgetPosition: "BottomRight",
            widgetLocale: "En",
            enabledModules: [],
            channelLinks: [] as ChannelLinkFixture[],
            ...overrides,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ),
  );
}

interface Panel {
  root: ShadowRoot;
  toggle: HTMLButtonElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  status: HTMLDivElement;
}

function panelOf(root: ShadowRoot): Panel {
  const query = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (element === null) {
      throw new Error(`the widget has no ${selector}`);
    }
    return element;
  };

  return {
    root,
    toggle: query<HTMLButtonElement>(".ago-toggle"),
    input: query<HTMLTextAreaElement>(".ago-input"),
    send: query<HTMLButtonElement>(".ago-send"),
    status: query<HTMLDivElement>(".ago-status"),
  };
}

async function mountWidget(): Promise<Panel> {
  const widget = new ChatWidget(config);
  widget.mount(document.body);
  await flush();

  const host = document.querySelector("[data-ago-chat-widget]");
  if (host?.shadowRoot == null) {
    throw new Error("the widget did not mount");
  }
  return panelOf(host.shadowRoot);
}

function type(panel: Panel, body: string): void {
  panel.input.value = body;
  panel.input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressEnter(panel: Panel): void {
  panel.input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", shiftKey: false, bubbles: true, cancelable: true }),
  );
}

function banner(root: ShadowRoot): HTMLDivElement | null {
  return root.querySelector<HTMLDivElement>(".ago-channel-switcher-banner");
}

/** `25-211`: the banner's own header bar. */
function bannerHeader(root: ShadowRoot): HTMLDivElement | null {
  return root.querySelector<HTMLDivElement>(".ago-channel-switcher-banner-header");
}

function isChatOpen(root: ShadowRoot): boolean {
  return !root.querySelector<HTMLDivElement>(".ago-panel")!.hidden;
}

function rows(root: ShadowRoot): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(".ago-channel-switcher-row")];
}

function twoChannels(): ChannelLinkFixture[] {
  return [
    { kind: "Telegram", url: "https://t.me/tenant_bot?start=abc123" },
    { kind: "WhatsApp", url: "https://wa.me/15550100" },
  ];
}

beforeEach(() => {
  resetFakeSignalR();
  document.body.innerHTML = "";
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a site with nothing connected", () => {
  it("builds no banner at all, even on hover", async () => {
    stubFetch({ channelLinks: [] });
    const panel = await mountWidget();
    panel.toggle.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));

    expect(banner(panel.root)).toBeNull();
  });
});

describe("a site with connected channels", () => {
  describe("never a card inside the panel - the defect this item fixes", () => {
    it("builds no .ago-channel-switcher card anywhere - retired, not merely hidden", async () => {
      stubFetch({ channelLinks: twoChannels() });
      joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
      const panel = await mountWidget();
      panel.toggle.click();
      await flush();

      expect(panel.root.querySelector(".ago-channel-switcher")).toBeNull();
    });

    it("is a sibling of the toggle, never a descendant of .ago-panel", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      const built = banner(panel.root)!;
      expect(built.parentElement).toBe(panel.toggle.parentElement);
      expect(panel.root.querySelector(".ago-panel")!.contains(built)).toBe(false);
    });
  });

  describe("visibility requires both closed and hovered - the identical rule BelowLauncher's own row follows", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function hoverToggle(panel: Panel): void {
      panel.toggle.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    }

    async function unhoverToggle(panel: Panel): Promise<void> {
      panel.toggle.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(HOVER_REGION_LEAVE_GRACE_MS);
    }

    it("is hidden before the toggle is ever hovered", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      expect(banner(panel.root)).toHaveProperty("hidden", true);
    });

    it("reveals on hover, hides again once the grace period elapses after the pointer leaves", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      hoverToggle(panel);
      expect(banner(panel.root)).toHaveProperty("hidden", false);

      await unhoverToggle(panel);
      expect(banner(panel.root)).toHaveProperty("hidden", true);
    });

    it("plays its slide-up entrance when it reveals on hover", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      hoverToggle(panel);
      expect(banner(panel.root)!.classList.contains("ago-entering")).toBe(true);
    });

    it("prefers-reduced-motion skips the banner's entrance", async () => {
      // Query-aware, not a blanket `{ matches: true }` - a mock that answers every query the same way
      // also answers `(hover: none)` `true`, which would make `isTouchRoutingDevice()` skip building
      // this hover-revealed banner at all (`loadChannelSwitcher`'s own touch-routing gate), leaving
      // nothing here to assert against.
      const matchMedia = vi.fn((query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }));
      vi.stubGlobal("matchMedia", matchMedia);

      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      hoverToggle(panel);
      expect(banner(panel.root)!.classList.contains("ago-entering")).toBe(false);
    });

    it("never reveals on hover while the chat panel is open", async () => {
      stubFetch({ channelLinks: twoChannels() });
      joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
      const panel = await mountWidget();
      await flush();

      panel.toggle.click(); // open
      await flush();

      hoverToggle(panel);
      expect(banner(panel.root)).toHaveProperty("hidden", true);
    });

    it("reveals immediately on close if the pointer never left the toggle", async () => {
      stubFetch({ channelLinks: twoChannels() });
      joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
      const panel = await mountWidget();
      await flush();

      panel.toggle.click(); // open
      await flush();
      hoverToggle(panel);
      expect(banner(panel.root)).toHaveProperty("hidden", true); // still open

      panel.toggle.click(); // close, pointer still over the toggle
      await flush();
      expect(banner(panel.root)).toHaveProperty("hidden", false); // no fresh pointerenter needed
    });
  });

  // `25-203`'s own gap-crossing mechanism, reused rather than re-implemented - this banner sits
  // across a real gap from the toggle exactly like BelowLauncher's row does
  // (`channelSwitcherLauncher.test.ts`'s own identical describe block proves the mechanism itself in
  // more depth; this block confirms the banner is wired to the same two methods, not a second copy).
  describe("the hover region spans the toggle and the banner - closing the gap between them (25-203)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function hoverToggle(panel: Panel): void {
      panel.toggle.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    }

    function unhoverToggle(panel: Panel): void {
      panel.toggle.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    }

    function hoverBanner(panel: Panel): void {
      banner(panel.root)!.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    }

    function unhoverBanner(panel: Panel): void {
      banner(panel.root)!.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    }

    it("stays visible when the pointer is over the banner directly, even though the toggle itself was never hovered", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      hoverBanner(panel);
      expect(banner(panel.root)).toHaveProperty("hidden", false);
    });

    it("never hides while the pointer crosses from the toggle into the banner within the grace period", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      hoverToggle(panel);
      expect(banner(panel.root)).toHaveProperty("hidden", false);

      // Left the toggle's own box, not yet arrived at the banner - the leave only starts the grace
      // period timer, no time has passed yet.
      unhoverToggle(panel);
      expect(banner(panel.root)).toHaveProperty("hidden", false);

      // Arrives at the banner within the grace period - its own pointerenter cancels the pending
      // timer outright.
      hoverBanner(panel);
      expect(banner(panel.root)).toHaveProperty("hidden", false);

      // Letting the full grace period elapse afterwards proves the cancellation was real, not merely
      // a longer delay.
      await vi.advanceTimersByTimeAsync(HOVER_REGION_LEAVE_GRACE_MS);
      expect(banner(panel.root)).toHaveProperty("hidden", false);
    });

    it("hides once the grace period elapses if the pointer leaves the toggle and never reaches the banner", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      hoverToggle(panel);
      unhoverToggle(panel);
      expect(banner(panel.root)).toHaveProperty("hidden", false); // still within the grace period

      await vi.advanceTimersByTimeAsync(HOVER_REGION_LEAVE_GRACE_MS);
      expect(banner(panel.root)).toHaveProperty("hidden", true);
    });

    it("hides again, after its own grace period, once the pointer leaves the banner too", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      hoverToggle(panel);
      unhoverToggle(panel);
      hoverBanner(panel);
      expect(banner(panel.root)).toHaveProperty("hidden", false);

      unhoverBanner(panel);
      expect(banner(panel.root)).toHaveProperty("hidden", false); // still within the grace period

      await vi.advanceTimersByTimeAsync(HOVER_REGION_LEAVE_GRACE_MS);
      expect(banner(panel.root)).toHaveProperty("hidden", true);
    });
  });

  it("shows one row per connected channel plus the open-chat row", async () => {
    stubFetch({ channelLinks: twoChannels() });
    joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
    const panel = await mountWidget();
    await flush();

    const built = rows(panel.root);
    expect(built).toHaveLength(3); // Telegram, WhatsApp, open-chat
  });

  it("renders each channel row as a real new-tab link carrying the server's own URL", async () => {
    stubFetch({ channelLinks: twoChannels() });
    const panel = await mountWidget();
    await flush();

    const telegramRow = rows(panel.root).find((row) => row.textContent?.includes("Telegram")) as HTMLAnchorElement;
    expect(telegramRow.tagName).toBe("A");
    expect(telegramRow.getAttribute("href")).toBe("https://t.me/tenant_bot?start=abc123");
    expect(telegramRow.getAttribute("target")).toBe("_blank");
    expect(telegramRow.getAttribute("rel")).toBe("noopener noreferrer");
    expect(telegramRow.textContent).toContain("Telegram");
  });

  it("names the group with role=group and an accessible label", async () => {
    stubFetch({ channelLinks: twoChannels() });
    const panel = await mountWidget();
    await flush();

    const built = banner(panel.root)!;
    expect(built.getAttribute("role")).toBe("group");
    expect(built.getAttribute("aria-label")).toBeTruthy();
  });

  // `25-149`'s own explicit Done-when, restated for the banner: an unrecognised kind is never
  // dropped or a crash.
  it("renders an unrecognised kind with a fallback icon and its own raw label rather than dropping it", async () => {
    stubFetch({ channelLinks: [{ kind: "FutureChannel", url: "https://future.example/chat" }] });
    const panel = await mountWidget();
    await flush();

    const built = rows(panel.root);
    expect(built).toHaveLength(2); // the unrecognised channel, plus open-chat
    const unknownRow = built.find((row) => row.textContent?.includes("FutureChannel"));
    expect(unknownRow).toBeDefined();
    expect(unknownRow?.querySelector("svg")).not.toBeNull();
  });

  describe("the four recognised channels' real brand icons", () => {
    function allFourChannels(): ChannelLinkFixture[] {
      return [
        { kind: "Telegram", url: "https://t.me/tenant_bot?start=abc123" },
        { kind: "WhatsApp", url: "https://wa.me/15550100" },
        { kind: "Vk", url: "https://vk.me/tenant_bot" },
        { kind: "Max", url: "https://max.ru/tenant_bot" },
      ];
    }

    const DISPLAYED_LABEL: Record<string, string> = {
      Telegram: "Telegram",
      WhatsApp: "WhatsApp",
      Vk: "VK",
      Max: "MAX",
    };

    it("gives Telegram, WhatsApp and VK more than one <path> - a real multi-part mark, not a placeholder glyph", async () => {
      stubFetch({ channelLinks: allFourChannels() });
      const panel = await mountWidget();
      await flush();

      const built = rows(panel.root);
      for (const kind of ["Telegram", "WhatsApp", "Vk"]) {
        const row = built.find((r) => r.textContent?.includes(DISPLAYED_LABEL[kind]!))!;
        const svg = row.querySelector("svg")!;
        expect(svg.querySelectorAll("path").length).toBeGreaterThan(1);
      }
    });

    // `25-205`: the row no longer sets an inline `color` at all - the author found live that a
    // colour picked to work as a small icon accent (Telegram's pale #0088CC) reads as washed-out,
    // low-contrast body text. `25-206`: what the label falls back to changed again, from
    // `.ago-channel-switcher-row { color: inherit }` (the panel's own near-black, still called
    // "unstylish" live) to a fixed `#374151` the author picked with a dedicated colour-picker
    // Artifact - see `the shared row rule's colour and dividers (25-206)` below for the CSS-source
    // assertion of that value. This test only proves the row still sets no inline style of its own,
    // never an inline style, while the icon's own brand fill is untouched (asserted separately below).
    it("sets no inline colour on the row - the label reads the shared rule's own colour, not the brand hex", async () => {
      stubFetch({ channelLinks: allFourChannels() });
      const panel = await mountWidget();
      await flush();

      const telegramRow = rows(panel.root).find((r) => r.textContent?.includes("Telegram")) as HTMLAnchorElement;
      expect(telegramRow.style.color).toBe("");
    });

    it("leaves each brand icon's own fill untouched by the row's text colour", async () => {
      stubFetch({ channelLinks: allFourChannels() });
      const panel = await mountWidget();
      await flush();

      const telegramRow = rows(panel.root).find((r) => r.textContent?.includes("Telegram"))!;
      const fillEl = telegramRow.querySelector("[fill='#0088CC']");
      expect(fillEl).not.toBeNull();
    });
  });

  describe("the open-chat row", () => {
    it("renders with the shared 'online chat' label and icon, opens the panel for real on click", async () => {
      stubFetch({ channelLinks: twoChannels() });
      joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
      const panel = await mountWidget();
      await flush();

      const openChatRow = panel.root.querySelector<HTMLButtonElement>(".ago-channel-switcher-row--open-chat")!;
      expect(openChatRow.tagName).toBe("BUTTON");
      expect(openChatRow.textContent).toContain("Online chat");
      expect(openChatRow.querySelector("svg")).not.toBeNull();

      expect(isChatOpen(panel.root)).toBe(false);
      openChatRow.click();
      await flush();
      expect(isChatOpen(panel.root)).toBe(true);
    });

    // Unlike the retired card's "stay here" row, the panel is closed while this banner shows - there
    // is no composer to focus instead of opening the chat.
    it("has no separate 'write in chat instead' row - opening the panel is the only way this row leaves", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      expect(rows(panel.root).filter((r) => r.tagName === "BUTTON")).toHaveLength(1);
    });

    // The item's own explicit scope: no "Отмена"/cancel row - dismissal is purely the pointer
    // leaving the hover region, matching BelowLauncher's own model.
    it("has no cancel row anywhere in the banner", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      const built = banner(panel.root)!;
      expect([...built.querySelectorAll("button")].some((b) => b.textContent?.includes("Отмена"))).toBe(false);
      expect([...built.querySelectorAll("button")].some((b) => b.textContent?.toLowerCase().includes("cancel"))).toBe(
        false,
      );
    });
  });

  // The item's own explicit decision, restated here as a test rather than left implicit: this banner
  // keeps no `storage.getChannelSwitcherDismissed()`-style memory at all - it is purely a function of
  // live hover state, matching `BelowLauncher` and the mobile touch sheet (both already stateless)
  // rather than the retired card's "seen once, never again".
  describe("no dismiss-persistence - purely live hover state, like BelowLauncher and the mobile sheet", () => {
    it("sending a message does not touch the banner's own build or visibility either way", async () => {
      stubFetch({ channelLinks: twoChannels() });
      joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
      const panel = await mountWidget();
      panel.toggle.click(); // open
      await flush();

      type(panel, "Hello!");
      pressEnter(panel);
      await flush();

      // Still built, still governed by the ordinary open/hover rule alone - nothing about sending a
      // message hid it, and nothing about it hid the composer either.
      expect(banner(panel.root)).not.toBeNull();
      panel.toggle.click(); // close
      await flush();
      panel.toggle.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
      expect(banner(panel.root)).toHaveProperty("hidden", false);
    });

    it("reappears identically after a reload - never permanently hidden the way the retired card's dismissal was", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const first = await mountWidget();
      await flush();
      first.toggle.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
      expect(banner(first.root)).toHaveProperty("hidden", false);

      document.body.innerHTML = "";
      resetFakeSignalR();
      const reloaded = await mountWidget();
      await flush();
      reloaded.toggle.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));

      expect(banner(reloaded.root)).toHaveProperty("hidden", false);
    });

    it("never writes to storage's own channel-switcher-dismissed key", async () => {
      stubFetch({ channelLinks: twoChannels() });
      joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
      const panel = await mountWidget();
      panel.toggle.click();
      await flush();
      type(panel, "Hello!");
      pressEnter(panel);
      await flush();

      expect(localStorage.getItem("ago-chat:shop_test:channel-switcher-dismissed")).toBeNull();
    });
  });

  it("never connects the hub on its own - the banner is built without the visitor writing anything", async () => {
    stubFetch({ channelLinks: twoChannels() });
    await mountWidget();
    await flush();

    expect(hubs.length).toBe(0);
  });
});

/**
 * `25-204`: "a real bottom margin, not flush to the viewport's bottom edge" - the author's own words.
 * jsdom cannot compute a shadow root's own cascade (`touchRoutingSheetSizing.test.ts`'s own top
 * comment has the full reasoning for why this repository's answer is reading the declared source
 * rule directly rather than `getComputedStyle` on a mounted widget); this proves the declared value
 * matches `.ago-panel`'s own literal exactly, by construction rather than by eye.
 */
describe("the banner's own position (25-204)", () => {
  function bannerRule(): CSSStyleRule {
    const cssSource = readFileSync(path.join(process.cwd(), "src", "ui", "styles.css"), "utf8");
    const style = document.createElement("style");
    style.textContent = cssSource;
    document.head.append(style);
    const sheet = style.sheet;
    if (sheet === null) {
      throw new Error("jsdom did not parse styles.css into a CSSStyleSheet");
    }
    const match = [...sheet.cssRules].find(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === ".ago-channel-switcher-banner",
    );
    if (match === undefined) {
      throw new Error("no rule found for .ago-channel-switcher-banner");
    }
    return match;
  }

  it("anchors bottom: 4.25rem - the identical offset .ago-panel itself uses, never flush to the viewport edge", () => {
    expect(bannerRule().style.bottom).toBe("4.25rem");
  });

  it("is positioned absolute, matching .ago-panel's own anchoring rather than the mobile sheet's fixed inset", () => {
    expect(bannerRule().style.position).toBe("absolute");
  });
});

/**
 * `25-206`: the label colour settled by a dedicated colour-picker Artifact (a faithful replica of
 * both the `AboveComposer` banner and the mobile touch routing sheet, with a live slider) after the
 * author found `25-205`'s own `color: inherit` fallback still read "unstylish" live. jsdom cannot
 * compute a shadow root's own cascade (`touchRoutingSheetSizing.test.ts`'s own top comment has the
 * full reasoning), so - exactly like the banner-position describe block above - this reads the
 * declared source rules directly rather than asserting on a `getComputedStyle` jsdom cannot produce.
 * The real, painted colour in both surfaces is confirmed separately, live, in a real browser (this
 * item's own Done-when explicitly asks for that, not a unit test standing in for it).
 */
describe("the shared row rule's colour and dividers (25-206)", () => {
  function styleSheet(): CSSStyleSheet {
    const cssSource = readFileSync(path.join(process.cwd(), "src", "ui", "styles.css"), "utf8");
    const style = document.createElement("style");
    style.textContent = cssSource;
    document.head.append(style);
    const sheet = style.sheet;
    if (sheet === null) {
      throw new Error("jsdom did not parse styles.css into a CSSStyleSheet");
    }
    return sheet;
  }

  function ruleIndexFor(sheet: CSSStyleSheet, selectorText: string): number {
    const rules = [...sheet.cssRules];
    const index = rules.findIndex((rule) => rule instanceof CSSStyleRule && rule.selectorText === selectorText);
    if (index === -1) {
      throw new Error(`no rule found for selector ${selectorText}`);
    }
    return index;
  }

  function ruleFor(sheet: CSSStyleSheet, selectorText: string): CSSStyleRule {
    return sheet.cssRules[ruleIndexFor(sheet, selectorText)] as CSSStyleRule;
  }

  it("sets the shared row's own colour to the fixed #374151 the author picked, not color: inherit any more", () => {
    const row = ruleFor(styleSheet(), ".ago-channel-switcher-row");
    expect(row.style.color).toBe("rgb(55, 65, 81)"); // #374151, as jsdom's CSSOM normalises it
  });

  it("still lets the 'Онлайн чат' row's accent colour win by source order over the new base colour", () => {
    const sheet = styleSheet();
    const openChat = ruleFor(sheet, ".ago-channel-switcher-row--open-chat");
    expect(openChat.style.color).toBe("var(--ago-accent)");
    // Same specificity (one class each) as the base rule, so source order alone decides the winner -
    // this row's own override has to stay declared after `.ago-channel-switcher-row` for its accent
    // colour to keep beating the new #374151.
    expect(ruleIndexFor(sheet, ".ago-channel-switcher-row--open-chat")).toBeGreaterThan(
      ruleIndexFor(sheet, ".ago-channel-switcher-row"),
    );
  });

  it("still lets the touch sheet's 'Отмена' row keep its own grey by source order over the new base colour", () => {
    const sheet = styleSheet();
    const cancel = ruleFor(sheet, ".ago-touch-routing-row--cancel");
    expect(cancel.style.color).toBe("rgb(107, 114, 128)"); // #6b7280
    expect(ruleIndexFor(sheet, ".ago-touch-routing-row--cancel")).toBeGreaterThan(
      ruleIndexFor(sheet, ".ago-channel-switcher-row"),
    );
  });

  it("gives every row inside the AboveComposer banner a divider, including the first - the touch sheet's own unconditional pattern, replicated", () => {
    // jsdom's CSSOM does not serialise the `border-top` shorthand getter reliably once a sibling
    // rule also sets the bare `border` shorthand (`.ago-channel-switcher-row`'s own `border: none`) -
    // asserting on the three longhands it decomposes into instead of the shorthand sidesteps that.
    const rule = ruleFor(styleSheet(), ".ago-channel-switcher-banner .ago-channel-switcher-row");
    expect(rule.style.borderTopWidth).toBe("0.0625rem");
    expect(rule.style.borderTopStyle).toBe("solid");
    expect(rule.style.borderTopColor).toBe("rgb(229, 231, 235)"); // #e5e7eb
  });

  it("declares the banner's divider at higher specificity than the 'Онлайн чат' row's own identical border-top, so nothing conflicts", () => {
    const sheet = styleSheet();
    const openChat = ruleFor(sheet, ".ago-channel-switcher-row--open-chat");
    const bannerDivider = ruleFor(sheet, ".ago-channel-switcher-banner .ago-channel-switcher-row");
    expect(openChat.style.borderTopWidth).toBe(bannerDivider.style.borderTopWidth);
    expect(openChat.style.borderTopStyle).toBe(bannerDivider.style.borderTopStyle);
    expect(openChat.style.borderTopColor).toBe(bannerDivider.style.borderTopColor);
  });

  it("leaves the bare shared row rule without a divider of its own - only the banner-scoped rule adds one", () => {
    const sheet = styleSheet();
    // `.ago-channel-switcher-row` sets `border: none`, so its own `border-top-style` reads `none` -
    // no divider - unlike the two rules above, which both read `solid`.
    expect(ruleFor(sheet, ".ago-channel-switcher-row").style.borderTopStyle).toBe("none");
  });

  it("leaves the touch sheet's own unconditional divider (.ago-touch-routing-row) untouched by this item", () => {
    // Pre-existing, from `25-197`/`25-200` - this item only adds the banner's own equivalent above;
    // it must not also reach the touch sheet's rows via the bare shared class.
    const rule = ruleFor(styleSheet(), ".ago-touch-routing-row");
    expect(rule.style.borderTopWidth).toBe("0.0625rem");
    expect(rule.style.borderTopStyle).toBe("solid");
    expect(rule.style.borderTopColor).toBe("rgb(229, 231, 235)"); // #e5e7eb
  });
});

/**
 * `25-211`: a live sizing picker (icon scale 100-200%, row padding, a header-bar preview) settled on
 * the values this describe block proves - 28px icons (175%), 10px vertical row padding, and a dark
 * header bar sitting above the rows. jsdom cannot compute a shadow root's own cascade
 * (`touchRoutingSheetSizing.test.ts`'s own top comment has the full reasoning), so the sizing half of
 * this block reads the declared source rules directly, the identical shape
 * `touchRoutingSheetSizing.test.ts`/the "shared row rule's colour and dividers" block above already
 * establish. The real, painted result is confirmed separately, live, against the picker itself - this
 * item's own Done-when explicitly asks for that, not a unit test standing in for it.
 */
describe("the banner's own sizing and header bar (25-211)", () => {
  function styleSheet(): CSSStyleSheet {
    const cssSource = readFileSync(path.join(process.cwd(), "src", "ui", "styles.css"), "utf8");
    const style = document.createElement("style");
    style.textContent = cssSource;
    document.head.append(style);
    const sheet = style.sheet;
    if (sheet === null) {
      throw new Error("jsdom did not parse styles.css into a CSSStyleSheet");
    }
    return sheet;
  }

  function ruleFor(sheet: CSSStyleSheet, selectorText: string): CSSStyleRule {
    const rule = [...sheet.cssRules].find(
      (r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText === selectorText,
    );
    if (rule === undefined) {
      throw new Error(`no rule found for selector ${selectorText}`);
    }
    return rule;
  }

  describe("row and icon sizing", () => {
    it("sets the banner row's own font-size to 1.75rem (28px) - the icon's inline 1em attribute resolves against it", () => {
      const rule = ruleFor(styleSheet(), ".ago-channel-switcher-banner .ago-channel-switcher-row");
      expect(rule.style.fontSize).toBe("1.75rem");
    });

    it("sets the banner row's own vertical padding to 0.625rem (10px), horizontal unchanged", () => {
      const rule = ruleFor(styleSheet(), ".ago-channel-switcher-banner .ago-channel-switcher-row");
      expect(rule.style.paddingTop).toBe("0.625rem");
      expect(rule.style.paddingBottom).toBe("0.625rem");
      expect(rule.style.paddingLeft).toBe("0.75rem");
      expect(rule.style.paddingRight).toBe("0.75rem");
    });

    it("pins the label span back to 1rem so it does not grow with the row's own font-size", () => {
      const rule = ruleFor(styleSheet(), ".ago-channel-switcher-banner .ago-channel-switcher-row span");
      expect(rule.style.fontSize).toBe("1rem");
    });

    it("never applies the banner's own sizing to the bare .ago-channel-switcher-row every placement shares", () => {
      const sheet = styleSheet();
      const bareRow = ruleFor(sheet, ".ago-channel-switcher-row");
      // The bare rule's own `font: inherit` shorthand decomposes its own `font-size` sub-property to
      // literally `"inherit"` - never the banner's fixed `1.75rem`, which is exactly what "never
      // applies" means here.
      expect(bareRow.style.fontSize).toBe("inherit");
    });

    it("leaves the touch sheet's own font-size (16px) untouched - it is declared after this rule and wins by source order regardless", () => {
      const sheet = styleSheet();
      const touchRow = ruleFor(sheet, ".ago-touch-routing-row");
      expect(touchRow.style.fontSize).toBe("16px");
    });
  });

  describe("the header bar's own declared style", () => {
    it("gives the header bar white, regular-weight text and rounded top corners matching the banner's own", () => {
      const rule = ruleFor(styleSheet(), ".ago-channel-switcher-banner-header");
      expect(rule.style.color).toBe("rgb(255, 255, 255)");
      expect(rule.style.fontWeight).toBe("400");
      expect(rule.style.borderRadius).toBe("0.75rem 0.75rem 0 0");
    });

    // `25-219`: this bar used to be a flat #374151, found live to read as a second, disconnected
    // brand surface next to `.ago-header`'s own tenant-coloured gradient - it now reuses that exact
    // gradient expression instead, so the banner reads as the same chrome as the panel it stands in
    // for.
    it("reuses the exact tenant-coloured gradient .ago-header itself declares, not a flat neutral", () => {
      const sheet = styleSheet();
      const header = ruleFor(sheet, ".ago-channel-switcher-banner-header");
      const agoHeader = ruleFor(sheet, ".ago-header");
      expect(header.style.background).toBe(agoHeader.style.background);
    });
  });

  describe("the header bar in the mounted widget", () => {
    it("renders as the banner's own first child, above every channel row", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      const built = banner(panel.root)!;
      expect(built.firstElementChild).toBe(bannerHeader(panel.root));
      expect(bannerHeader(panel.root)!.classList.contains("ago-channel-switcher-row")).toBe(false);
    });

    it("shows exactly the real panel's own resolved title - never a second, independently-derived copy", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      expect(bannerHeader(panel.root)!.textContent).toBe(panel.root.querySelector(".ago-header h1")!.textContent);
      expect(bannerHeader(panel.root)!.textContent).not.toBe("");
    });

    it("carries no button, link, or other control of any kind - nothing here to dismiss", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      const header = bannerHeader(panel.root)!;
      expect(header.querySelector("button")).toBeNull();
      expect(header.querySelector("a")).toBeNull();
      expect(header.querySelector("svg")).toBeNull();
    });

    it("builds no header bar at all for a site with nothing connected - the banner itself never builds either", async () => {
      stubFetch({ channelLinks: [] });
      const panel = await mountWidget();
      await flush();

      expect(bannerHeader(panel.root)).toBeNull();
    });
  });
});

/**
 * `25-211`'s own explicit scope: `BelowLauncher`'s circular launcher-icon row and the mobile touch
 * routing sheet are neither renderer this item's banner - both must render at their pre-existing
 * sizes with their own pre-existing dividers, provably unchanged by this item's new banner-scoped
 * rules and its header bar.
 */
describe("BelowLauncher and the touch routing sheet stay untouched (25-211's own explicit Out of scope)", () => {
  it("BelowLauncher's own icon size rules are untouched - still governed by .ago-channel-switcher-launcher-icon, never the banner's new font-size rule", () => {
    const cssSource = readFileSync(path.join(process.cwd(), "src", "ui", "styles.css"), "utf8");
    const style = document.createElement("style");
    style.textContent = cssSource;
    document.head.append(style);
    const sheet = style.sheet;
    if (sheet === null) {
      throw new Error("jsdom did not parse styles.css into a CSSStyleSheet");
    }

    const rules = [...sheet.cssRules];
    const largeIcon = rules.find(
      (r): r is CSSStyleRule =>
        r instanceof CSSStyleRule && r.selectorText === ".ago-channel-switcher-launcher--large .ago-channel-switcher-launcher-icon",
    );
    if (largeIcon === undefined) {
      throw new Error("BelowLauncher's own large-icon rule is missing");
    }
    // Pre-existing pixel sizes (`25-173`), unchanged by anything this item added.
    expect(largeIcon.style.width).toBe("3.5rem");
    expect(largeIcon.style.height).toBe("3.5rem");
  });

  it("builds no header bar and no font-size/padding change for BelowLauncher's own row - it never uses .ago-channel-switcher-banner at all", async () => {
    stubFetch({ channelLinks: twoChannels(), widgetChannelSwitcherPlacement: "BelowLauncher" });
    const panel = await mountWidget();
    await flush();

    expect(banner(panel.root)).toBeNull();
    expect(bannerHeader(panel.root)).toBeNull();
    expect(panel.root.querySelector(".ago-channel-switcher-launcher")).not.toBeNull();
  });

  it("leaves the touch routing sheet's own row padding (0.75rem 1rem) untouched", () => {
    const cssSource = readFileSync(path.join(process.cwd(), "src", "ui", "styles.css"), "utf8");
    const style = document.createElement("style");
    style.textContent = cssSource;
    document.head.append(style);
    const sheet = style.sheet;
    if (sheet === null) {
      throw new Error("jsdom did not parse styles.css into a CSSStyleSheet");
    }

    const rule = [...sheet.cssRules].find(
      (r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText === ".ago-touch-routing-row",
    );
    if (rule === undefined) {
      throw new Error("no rule found for .ago-touch-routing-row");
    }
    expect(rule.style.padding).toBe("0.75rem 1rem");
  });
});
