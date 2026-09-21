import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetConfig } from "../config.js";
import { hubs, joinQueue, resetFakeSignalR } from "../testing/fakeSignalR.js";

/**
 * `25-197`: on a device with no hover at all, the closed toggle opens a routing sheet instead of
 * the chat directly - a channel row opens that channel for real and closes the sheet, "Онлайн чат"
 * opens the chat for real, "Отмена" (and the backdrop) close the sheet with no other effect. A
 * site with nothing connected, or a device that *does* have hover, is entirely unaffected -
 * `channelSwitcher.test.ts`/`channelSwitcherLauncher.test.ts` already prove both existing
 * placements are untouched here; this file only proves the new gate and the sheet itself.
 *
 * Modeled on `channelSwitcherLauncher.test.ts`'s own shape - the closest existing precedent for
 * "a session-resolved element that only some devices ever see."
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

/** Mirrors a real browser's own `matchMedia`: each query gets its own answer, so a test asserting
 * `(hover: none)` is not silently also faking `(prefers-reduced-motion: reduce)` or
 * `(pointer: coarse)` into matching. */
function stubHover(matchesHoverNone: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: query === "(hover: none)" ? matchesHoverNone : false })),
  );
}

function twoChannels(): ChannelLinkFixture[] {
  return [
    { kind: "Telegram", url: "https://t.me/tenant_bot?start=abc123" },
    { kind: "WhatsApp", url: "https://wa.me/15550100" },
  ];
}

interface Panel {
  root: ShadowRoot;
  toggle: HTMLButtonElement;
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

function sheet(root: ShadowRoot): HTMLDivElement | null {
  return root.querySelector<HTMLDivElement>(".ago-touch-routing-sheet");
}

function isOpen(root: ShadowRoot): boolean {
  return !root.querySelector<HTMLDivElement>(".ago-panel")!.hidden;
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

describe("a hover-capable device", () => {
  it("taps straight into chat - no sheet is ever built", async () => {
    stubHover(false);
    stubFetch({ channelLinks: twoChannels() });
    joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
    const panel = await mountWidget();

    panel.toggle.click();
    await flush();

    expect(isOpen(panel.root)).toBe(true);
    expect(sheet(panel.root)).toBeNull();
  });
});

describe("a site with nothing connected", () => {
  it("taps straight into chat even with no hover, unchanged from before this item", async () => {
    stubHover(true);
    stubFetch({ channelLinks: [] });
    joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
    const panel = await mountWidget();

    panel.toggle.click();
    await flush();

    expect(isOpen(panel.root)).toBe(true);
    expect(sheet(panel.root)).toBeNull();
  });
});

describe("a touch-only device with connected channels", () => {
  it("shows the routing sheet instead of opening chat", async () => {
    stubHover(true);
    stubFetch({ channelLinks: twoChannels() });
    const panel = await mountWidget();

    panel.toggle.click();
    await flush();

    expect(isOpen(panel.root)).toBe(false);
    expect(sheet(panel.root)).toHaveProperty("hidden", false);
  });

  it("selecting a channel opens its real link and closes the sheet without opening chat", async () => {
    stubHover(true);
    stubFetch({ channelLinks: twoChannels() });
    const panel = await mountWidget();

    panel.toggle.click();
    await flush();

    const telegramRow = panel.root.querySelector<HTMLAnchorElement>(".ago-touch-routing-row[href]")!;
    expect(telegramRow.href).toBe("https://t.me/tenant_bot?start=abc123");
    expect(telegramRow.target).toBe("_blank");
    expect(telegramRow.rel).toBe("noopener noreferrer");

    telegramRow.click();
    await flush();

    expect(sheet(panel.root)).toHaveProperty("hidden", true);
    expect(isOpen(panel.root)).toBe(false);
  });

  it('selecting "Онлайн чат" opens the real chat panel and closes the sheet', async () => {
    stubHover(true);
    stubFetch({ channelLinks: twoChannels() });
    joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
    const panel = await mountWidget();

    panel.toggle.click();
    await flush();

    const rows = [...panel.root.querySelectorAll<HTMLButtonElement>(".ago-touch-routing-row")];
    const onlineChatRow = rows.find((row) => row.textContent?.includes("Online chat"))!;
    onlineChatRow.click();
    await flush();

    expect(isOpen(panel.root)).toBe(true);
    expect(sheet(panel.root)).toHaveProperty("hidden", true);
  });

  it('selecting "Отмена" closes the sheet with no other effect', async () => {
    stubHover(true);
    stubFetch({ channelLinks: twoChannels() });
    const panel = await mountWidget();

    panel.toggle.click();
    await flush();

    const rows = [...panel.root.querySelectorAll<HTMLButtonElement>(".ago-touch-routing-row")];
    const cancelRow = rows.find((row) => row.textContent?.includes("Cancel"))!;
    cancelRow.click();
    await flush();

    expect(sheet(panel.root)).toHaveProperty("hidden", true);
    expect(isOpen(panel.root)).toBe(false);
  });

  it("clicking the backdrop closes the sheet, the same as Отмена", async () => {
    stubHover(true);
    stubFetch({ channelLinks: twoChannels() });
    const panel = await mountWidget();

    panel.toggle.click();
    await flush();

    // The sheet element itself is the backdrop - dispatching the click directly on it (not on the
    // panel or a row inside it) is what a real click outside the panel would deliver.
    sheet(panel.root)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(sheet(panel.root)).toHaveProperty("hidden", true);
    expect(isOpen(panel.root)).toBe(false);
  });

  it("reopens on every tap, not just the first", async () => {
    stubHover(true);
    stubFetch({ channelLinks: twoChannels() });
    const panel = await mountWidget();

    panel.toggle.click();
    await flush();
    const rows = [...panel.root.querySelectorAll<HTMLButtonElement>(".ago-touch-routing-row")];
    rows.find((row) => row.textContent?.includes("Cancel"))!.click();
    await flush();
    expect(sheet(panel.root)).toHaveProperty("hidden", true);

    panel.toggle.click();
    await flush();
    expect(sheet(panel.root)).toHaveProperty("hidden", false);
  });

  it("never forces a connection just from opening the sheet", async () => {
    stubHover(true);
    stubFetch({ channelLinks: twoChannels() });
    await mountWidget();
    await flush();

    expect(hubs.length).toBe(0);
  });
});
