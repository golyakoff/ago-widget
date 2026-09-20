import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetConfig } from "../config.js";
import { hubs, joinQueue, resetFakeSignalR } from "../testing/fakeSignalR.js";

/**
 * `25-149`: the Jivo-style channel-switcher card - one row per entry in `session.channelLinks`, plus
 * a final "stay here" row, built above the composer at the identical `loadBookingModuleChip` timing
 * `ui/widget.ts`'s own remarks on `loadChannelSwitcherCard` explain.
 *
 * Modeled on `modules.test.ts`'s own shape (`vi.mock("@microsoft/signalr", ...)`, a `stubFetch`
 * returning a handshake response, mount-and-open) - the closest existing precedent for "a session-
 * resolved, entitlement-gated element spliced above the composer."
 */
vi.mock("@microsoft/signalr", () => import("../testing/fakeSignalR.js"));

const { ChatWidget } = await import("./widget.js");

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

function card(root: ShadowRoot): HTMLDivElement | null {
  return root.querySelector<HTMLDivElement>(".ago-channel-switcher");
}

function rows(root: ShadowRoot): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(".ago-channel-switcher-row")];
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
  it("shows no card at all - never an empty or single-row husk", async () => {
    stubFetch({ channelLinks: [] });
    const panel = await mountWidget();
    panel.toggle.click();
    await flush();

    expect(card(panel.root)).toBeNull();
  });
});

describe("a site with connected channels", () => {
  function twoChannels(): ChannelLinkFixture[] {
    return [
      { kind: "Telegram", url: "https://t.me/tenant_bot?start=abc123" },
      { kind: "WhatsApp", url: "https://wa.me/15550100" },
    ];
  }

  it("shows one row per connected channel plus the write-in-chat row", async () => {
    stubFetch({ channelLinks: twoChannels() });
    joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
    const panel = await mountWidget();
    panel.toggle.click();
    await flush();

    const built = rows(panel.root);
    expect(built).toHaveLength(3); // Telegram, WhatsApp, write-in-chat

    expect(panel.root.querySelector(".ago-channel-switcher")).toHaveProperty("hidden", false);
  });

  it("renders each channel row as a real new-tab link carrying the server's own URL", async () => {
    stubFetch({ channelLinks: twoChannels() });
    joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
    const panel = await mountWidget();
    panel.toggle.click();
    await flush();

    const telegramRow = rows(panel.root).find((row) => row.textContent?.includes("Telegram")) as HTMLAnchorElement;
    expect(telegramRow.tagName).toBe("A");
    expect(telegramRow.getAttribute("href")).toBe("https://t.me/tenant_bot?start=abc123");
    expect(telegramRow.getAttribute("target")).toBe("_blank");
    expect(telegramRow.getAttribute("rel")).toBe("noopener noreferrer");
    // The accessible name is the visible, untranslated proper noun - never run through WidgetStrings.
    expect(telegramRow.textContent).toContain("Telegram");
  });

  it("names the group with role=group and an accessible label", async () => {
    stubFetch({ channelLinks: twoChannels() });
    joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
    const panel = await mountWidget();
    panel.toggle.click();
    await flush();

    const group = card(panel.root)!;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBeTruthy();
  });

  // `25-149`'s own explicit Done-when: an unrecognised kind is never dropped or a crash.
  it("renders an unrecognised kind with a fallback icon and its own raw label rather than dropping it", async () => {
    stubFetch({ channelLinks: [{ kind: "FutureChannel", url: "https://future.example/chat" }] });
    joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
    const panel = await mountWidget();
    panel.toggle.click();
    await flush();

    const built = rows(panel.root);
    expect(built).toHaveLength(2); // the unrecognised channel, plus write-in-chat
    const unknownRow = built.find((row) => row.textContent?.includes("FutureChannel"));
    expect(unknownRow).toBeDefined();
    expect(unknownRow?.querySelector("svg")).not.toBeNull();
  });

  it("a visitor with unread history still sees their own transcript, unaffected by the card", async () => {
    stubFetch({ channelLinks: twoChannels() });
    joinQueue.push({
      conversationId: "conv-1",
      isNew: false,
      history: [
        {
          id: "m1",
          sequence: 1,
          authorKind: "Operator",
          authorId: "88888888-8888-8888-8888-888888888888",
          body: "hello there",
          createdAt: "2026-08-25T09:00:00+00:00",
        },
      ],
    });
    const panel = await mountWidget();
    panel.toggle.click();
    await flush();

    expect(panel.root.querySelector(".ago-message")?.textContent).toContain("hello there");
    expect(card(panel.root)).not.toBeNull();
  });

  // `25-172`: the four recognised kinds now render a real, multi-path brand mark built via a
  // structured-tree builder rather than `createSvgIcon`'s single `fill: currentColor` path - these
  // assertions would have failed against `25-149`'s own placeholder shapes (each exactly one `<path>`)
  // and guard against silently regressing back to them.
  describe("the four recognised channels' real brand icons", () => {
    function allFourChannels(): ChannelLinkFixture[] {
      return [
        { kind: "Telegram", url: "https://t.me/tenant_bot?start=abc123" },
        { kind: "WhatsApp", url: "https://wa.me/15550100" },
        { kind: "Vk", url: "https://vk.me/tenant_bot" },
        { kind: "Max", url: "https://max.ru/tenant_bot" },
      ];
    }

    // Wire `kind` -> the label `CHANNEL_DISPLAY_NAMES` actually renders (`Vk`/`Max` display as the
    // all-caps "VK"/"MAX" acronyms) - rows() below finds a row by its visible text, not the wire string.
    const DISPLAYED_LABEL: Record<string, string> = {
      Telegram: "Telegram",
      WhatsApp: "WhatsApp",
      Vk: "VK",
      Max: "MAX",
    };

    it("gives Telegram, WhatsApp and VK more than one <path> - a real multi-part mark, not a placeholder glyph", async () => {
      stubFetch({ channelLinks: allFourChannels() });
      joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
      const panel = await mountWidget();
      panel.toggle.click();
      await flush();

      const built = rows(panel.root);
      for (const kind of ["Telegram", "WhatsApp", "Vk"]) {
        const row = built.find((r) => r.textContent?.includes(DISPLAYED_LABEL[kind]!))!;
        const svg = row.querySelector("svg")!;
        expect(svg.querySelectorAll("path").length).toBeGreaterThan(1);
      }
    });

    it("never leaves the recognised channels' icon fill reading currentColor - it must not follow row.style.color", async () => {
      stubFetch({ channelLinks: allFourChannels() });
      joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
      const panel = await mountWidget();
      panel.toggle.click();
      await flush();

      const built = rows(panel.root);
      for (const kind of ["Telegram", "WhatsApp", "Vk", "Max"]) {
        const row = built.find((r) => r.textContent?.includes(DISPLAYED_LABEL[kind]!))!;
        const svg = row.querySelector("svg")!;
        expect(svg.getAttribute("fill")).not.toBe("currentColor");
      }
    });

    it("crops MAX's icon to a true circle via clip-path, unlike its native rounded-square art", async () => {
      stubFetch({ channelLinks: allFourChannels() });
      joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
      const panel = await mountWidget();
      panel.toggle.click();
      await flush();

      const maxRow = rows(panel.root).find((r) => r.textContent?.includes("MAX"))!;
      const svg = maxRow.querySelector("svg")!;
      expect(svg.getAttribute("style") ?? "").toContain("clip-path:circle(50% at 50% 50%)");
    });

    it("keeps the label text tint independent of the icon - row.style.color still carries the brand hex", async () => {
      stubFetch({ channelLinks: allFourChannels() });
      joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
      const panel = await mountWidget();
      panel.toggle.click();
      await flush();

      const telegramRow = rows(panel.root).find((r) => r.textContent?.includes("Telegram")) as HTMLAnchorElement;
      expect(telegramRow.style.color).toBe("rgb(0, 136, 204)"); // #0088CC
    });
  });

  describe("the write-in-chat row", () => {
    const AUTO_OPEN_DELAY_MS = 30_000;

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("hides the card, focuses the composer, sends nothing, and never forces a connection", async () => {
      stubFetch({
        channelLinks: twoChannels(),
        widgetAutoOpenEnabled: true,
        widgetAutoOpenDelaySeconds: 30,
        widgetAutoOpenGreetingText: "Hi, need any help?",
      });
      const panel = await mountWidget();

      await vi.advanceTimersByTimeAsync(AUTO_OPEN_DELAY_MS);

      // `adr/0148`: auto-open never connects on its own - the fails-before shape this file borrows
      // from `widget.test.ts`'s own auto-open block.
      expect(hubs.length).toBe(0);
      expect(card(panel.root)).toHaveProperty("hidden", false);

      const dismissRow = panel.root.querySelector<HTMLButtonElement>(".ago-channel-switcher-row--dismiss")!;
      dismissRow.click();

      expect(card(panel.root)).toHaveProperty("hidden", true);
      expect(panel.root.activeElement).toBe(panel.input);
      expect(hubs.length).toBe(0); // still never connected
    });
  });

  describe("sending the first message", () => {
    it("also dismisses the card, without a separate click on the write-in-chat row", async () => {
      stubFetch({ channelLinks: twoChannels() });
      joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
      const panel = await mountWidget();
      panel.toggle.click();
      await flush();

      expect(card(panel.root)).toHaveProperty("hidden", false);

      type(panel, "Hello!");
      pressEnter(panel);
      await flush();

      expect(card(panel.root)).toHaveProperty("hidden", true);
    });
  });

  describe("cadence across opens and a reload", () => {
    it("reappears on every subsequent open until dismissed, then stays hidden across a reload", async () => {
      stubFetch({ channelLinks: twoChannels() });
      joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
      const panel = await mountWidget();

      panel.toggle.click(); // open
      await flush();
      expect(card(panel.root)).toHaveProperty("hidden", false);

      panel.toggle.click(); // close
      await flush();
      panel.toggle.click(); // reopen - still there, no dismissal happened
      await flush();
      expect(card(panel.root)).toHaveProperty("hidden", false);

      const dismissRow = panel.root.querySelector<HTMLButtonElement>(".ago-channel-switcher-row--dismiss")!;
      dismissRow.click();
      await flush();
      expect(card(panel.root)).toHaveProperty("hidden", true);

      // "Reload": a brand-new `ChatWidget` instance against the same, now-populated `localStorage` -
      // the identical stand-in `sessionRenewal.test.ts`/`unreadBadgeReload.test.ts` already use for a
      // returning visitor's browser.
      document.body.innerHTML = "";
      resetFakeSignalR();
      joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
      const reloaded = await mountWidget();
      reloaded.toggle.click();
      await flush();

      expect(card(reloaded.root)).toBeNull();
    });
  });
});
