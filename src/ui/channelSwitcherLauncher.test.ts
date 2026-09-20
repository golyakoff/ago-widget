import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetConfig } from "../config.js";
import { hubs, joinQueue, resetFakeSignalR } from "../testing/fakeSignalR.js";

/**
 * `25-173`: the "below launcher" channel-switcher renderer - `loadChannelSwitcher`'s other branch,
 * chosen instead of `channelSwitcher.test.ts`'s own above-composer card when a session's
 * `widgetChannelSwitcherPlacement` is `"BelowLauncher"`. Modeled on that file's own shape
 * (`vi.mock("@microsoft/signalr", ...)`, a `stubFetch` returning a handshake response, mount) - the
 * same session-resolved, entitlement-gated element this sibling file already proves for the other
 * placement.
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
            widgetChannelSwitcherPlacement: "BelowLauncher",
            widgetChannelSwitcherIconSize: "Medium",
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

function launcherRow(root: ShadowRoot): HTMLDivElement | null {
  return root.querySelector<HTMLDivElement>(".ago-channel-switcher-launcher");
}

function launcherIcons(root: ShadowRoot): HTMLAnchorElement[] {
  return [...root.querySelectorAll<HTMLAnchorElement>(".ago-channel-switcher-launcher-icon")];
}

function twoChannels(): ChannelLinkFixture[] {
  return [
    { kind: "Telegram", url: "https://t.me/tenant_bot?start=abc123" },
    { kind: "WhatsApp", url: "https://wa.me/15550100" },
  ];
}

function fourChannels(): ChannelLinkFixture[] {
  return [
    { kind: "Telegram", url: "https://t.me/tenant_bot?start=abc123" },
    { kind: "WhatsApp", url: "https://wa.me/15550100" },
    { kind: "Vk", url: "https://vk.me/tenant_bot" },
    { kind: "Max", url: "https://max.ru/tenant_bot" },
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
  it("builds no launcher row at all", async () => {
    stubFetch({ channelLinks: [] });
    const panel = await mountWidget();
    await flush();

    expect(launcherRow(panel.root)).toBeNull();
  });
});

describe("a site on the default placement (AboveComposer)", () => {
  it("never builds the below-launcher row - the card, not this renderer, applies", async () => {
    stubFetch({ channelLinks: twoChannels(), widgetChannelSwitcherPlacement: "AboveComposer" });
    joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
    const panel = await mountWidget();
    panel.toggle.click();
    await flush();

    expect(launcherRow(panel.root)).toBeNull();
    expect(panel.root.querySelector(".ago-channel-switcher")).not.toBeNull();
  });

  // A session cached before this field existed carries no widgetChannelSwitcherPlacement at all -
  // parseChannelSwitcherPlacement's own fallback must still mean "the pre-existing card", never the
  // new row, so an old cached session does not silently switch placement on its own.
  it("also applies when the field is entirely absent from the response", async () => {
    stubFetch({ channelLinks: twoChannels(), widgetChannelSwitcherPlacement: undefined });
    joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
    const panel = await mountWidget();
    panel.toggle.click();
    await flush();

    expect(launcherRow(panel.root)).toBeNull();
    expect(panel.root.querySelector(".ago-channel-switcher")).not.toBeNull();
  });
});

describe("a site on the new placement (BelowLauncher)", () => {
  it("renders one circular icon per connected channel, and nothing above the composer", async () => {
    stubFetch({ channelLinks: twoChannels() });
    const panel = await mountWidget();
    await flush();

    expect(launcherIcons(panel.root)).toHaveLength(2);
    expect(panel.root.querySelector(".ago-channel-switcher")).toBeNull();
  });

  it("renders correctly with exactly one connected channel", async () => {
    stubFetch({ channelLinks: [{ kind: "Telegram", url: "https://t.me/tenant_bot?start=abc123" }] });
    const panel = await mountWidget();
    await flush();

    expect(launcherIcons(panel.root)).toHaveLength(1);
  });

  it("renders correctly with all four connected channels", async () => {
    stubFetch({ channelLinks: fourChannels() });
    const panel = await mountWidget();
    await flush();

    expect(launcherIcons(panel.root)).toHaveLength(4);
  });

  // `25-191`: the row is still a sibling of the toggle, not a child of the panel - but its own
  // `hidden` now tracks the panel's open/close one-for-one (`setChannelSwitcherLauncherRowVisible`),
  // reversing `25-173`'s original "persistent regardless of open/closed" design.
  describe("visibility tracks the panel's own open/closed state", () => {
    it("is hidden before the panel is ever opened", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      // Never opened - panel.toggle.click() is deliberately not called here.
      expect(launcherRow(panel.root)).toHaveProperty("hidden", true);
      expect(launcherIcons(panel.root)).toHaveLength(2);
    });

    it("becomes visible once the panel opens, and hides again once it closes", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      panel.toggle.click(); // open
      await flush();
      expect(launcherRow(panel.root)).toHaveProperty("hidden", false);

      panel.toggle.click(); // close
      await flush();
      expect(launcherRow(panel.root)).toHaveProperty("hidden", true);
    });
  });

  it("renders each icon as a real new-tab link carrying the server's own URL", async () => {
    stubFetch({ channelLinks: twoChannels() });
    const panel = await mountWidget();
    await flush();

    const telegram = launcherIcons(panel.root).find((a) => a.getAttribute("aria-label") === "Telegram")!;
    expect(telegram.tagName).toBe("A");
    expect(telegram.getAttribute("href")).toBe("https://t.me/tenant_bot?start=abc123");
    expect(telegram.getAttribute("target")).toBe("_blank");
    expect(telegram.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("names the group with role=group and an accessible label, the same as the card", async () => {
    stubFetch({ channelLinks: twoChannels() });
    const panel = await mountWidget();
    await flush();

    const row = launcherRow(panel.root)!;
    expect(row.getAttribute("role")).toBe("group");
    expect(row.getAttribute("aria-label")).toBeTruthy();
  });

  // Unlike the card's own rows, this row carries no visible text label - the accessible name has to
  // live entirely on the icon's own aria-label instead.
  it("gives each icon its own accessible name since there is no visible text label", async () => {
    stubFetch({ channelLinks: [{ kind: "WhatsApp", url: "https://wa.me/15550100" }] });
    const panel = await mountWidget();
    await flush();

    const icon = launcherIcons(panel.root)[0]!;
    expect(icon.textContent?.trim()).toBe("");
    expect(icon.getAttribute("aria-label")).toBe("WhatsApp");
  });

  // 25-149's own explicit Done-when, restated for this renderer: an unrecognised kind is never
  // dropped or a crash.
  it("renders an unrecognised kind with the fallback icon rather than dropping it", async () => {
    stubFetch({ channelLinks: [{ kind: "FutureChannel", url: "https://future.example/chat" }] });
    const panel = await mountWidget();
    await flush();

    const icons = launcherIcons(panel.root);
    expect(icons).toHaveLength(1);
    expect(icons[0]!.classList.contains("ago-channel-switcher-launcher-icon--fallback")).toBe(true);
    expect(icons[0]!.querySelector("svg")).not.toBeNull();
  });

  describe("the three closed sizes", () => {
    it.each([
      ["Large", "large"],
      ["Medium", "medium"],
      ["Small", "small"],
    ])("applies the %s size as its own modifier class", async (wireValue, className) => {
      stubFetch({ channelLinks: twoChannels(), widgetChannelSwitcherIconSize: wireValue });
      const panel = await mountWidget();
      await flush();

      const row = launcherRow(panel.root)!;
      expect(row.classList.contains(`ago-channel-switcher-launcher--${className}`)).toBe(true);
    });

    // A session cached before this field existed, or a malformed value, falls back to Medium - the
    // server's own default, never a free/undefined size.
    it("falls back to medium when the field is absent", async () => {
      stubFetch({ channelLinks: twoChannels(), widgetChannelSwitcherIconSize: undefined });
      const panel = await mountWidget();
      await flush();

      expect(launcherRow(panel.root)!.classList.contains("ago-channel-switcher-launcher--medium")).toBe(true);
    });
  });

  it("follows the launcher's own side - .ago-position-left when the site is pinned left", async () => {
    stubFetch({ channelLinks: twoChannels(), widgetPosition: "BottomLeft" });
    const panel = await mountWidget();
    await flush();

    const root = panel.root.querySelector(".ago-root")!;
    expect(root.classList.contains("ago-position-left")).toBe(true);
    // The row itself carries no side-specific class of its own - ui/styles.ts's
    // `.ago-root.ago-position-left .ago-channel-switcher-launcher` rule is what flips its anchor side,
    // driven by the identical .ago-position-left class the toggle/panel already share.
    expect(launcherRow(panel.root)).not.toBeNull();
  });

  // 25-173's own explicit Scope, still true after 25-191: no *permanent-dismiss* concept at all -
  // unlike the above-composer card, nothing here ever stores "never show this again" for a visitor
  // identity. Open/close visibility (proven above) is a different, unrelated fact from dismissal.
  describe("no permanent-dismiss concept", () => {
    it("has no dismiss control anywhere in the row", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const panel = await mountWidget();
      await flush();

      expect(panel.root.querySelector(".ago-channel-switcher-row--dismiss")).toBeNull();
    });

    it("stays visible after sending a message, while the panel is still open", async () => {
      stubFetch({ channelLinks: twoChannels() });
      joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
      const panel = await mountWidget();
      panel.toggle.click();
      await flush();

      panel.input.value = "Hello!";
      panel.input.dispatchEvent(new Event("input", { bubbles: true }));
      panel.input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: false, bubbles: true, cancelable: true }),
      );
      await flush();

      expect(launcherRow(panel.root)).toHaveProperty("hidden", false);
      expect(launcherIcons(panel.root)).toHaveLength(2);
    });

    it("reappears identically after a reload - dismissing the above-composer card never applies here", async () => {
      stubFetch({ channelLinks: twoChannels() });
      const first = await mountWidget();
      await flush();
      expect(launcherRow(first.root)).not.toBeNull();

      document.body.innerHTML = "";
      resetFakeSignalR();
      const reloaded = await mountWidget();
      await flush();

      expect(launcherRow(reloaded.root)).not.toBeNull();
      expect(launcherIcons(reloaded.root)).toHaveLength(2);
    });
  });

  it("never connects the hub on its own - the row is built without the visitor writing anything", async () => {
    stubFetch({ channelLinks: twoChannels() });
    await mountWidget();
    await flush();

    expect(hubs.length).toBe(0);
  });
});
