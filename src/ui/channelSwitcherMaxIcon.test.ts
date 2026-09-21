import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetConfig } from "../config.js";
import { joinQueue, resetFakeSignalR } from "../testing/fakeSignalR.js";

/**
 * `25-199` - the touch routing sheet's MAX row rendered with no icon. `channelSwitcher.test.ts`
 * already proves the `AboveComposer` card renders MAX's icon correctly *in isolation* - this file's
 * whole job is the case that isolation never covers: a second `buildBrandIcon("Max")` call landing
 * in the same shadow root while the first instance is still there.
 *
 * **Confirming the cause, not assuming it.** `widget.ts`'s own `CHANNEL_ICON_TREES.Max` (~L313-383)
 * is read directly below before any fix exists: it is the only brand tree with `<defs>` children
 * carrying fixed `id`s (`a`, `b`, `c`, `d`), referenced via `fill="url(#c)"`/`href="#a"` etc. Every
 * other recognised brand (`Telegram`/`WhatsApp`/`Vk`) is flat `fill="#hex"` paths with no `id`
 * anywhere in its own tree. `loadChannelSwitcherCard` (`25-149`) builds the `AboveComposer` card -
 * MAX icon included - the moment the handshake resolves, regardless of device or whether the panel
 * is open; `openTouchRoutingSheet` (`25-197`) builds the sheet - a second MAX icon, if the tenant has
 * one connected - lazily, on the visitor's first tap. A visitor whose device already answers
 * `(hover: none)` truthy at handshake time still gets the card built (25-198 only changed *whether*
 * the card is offered - see that item; it did not change *when* it is built relative to the sheet),
 * so the concurrency this item exists for - the card's own MAX icon and the sheet's own MAX icon,
 * both alive in the same shadow root at once - is the real, live shape of a touch visitor's session,
 * not a contrived setup.
 *
 * The first test below inspects the actual built DOM for the one fact that decides everything:
 * whether the two instances' `id` attributes literally collide. They do, today - every `id` in this
 * file's tree is a hardcoded string literal, with no per-call uniqueness of any kind, so two calls to
 * `buildBrandIcon("Max")` are guaranteed, not merely likely, to each mint an `<linearGradient
 * id="a">` (etc.) as a *sibling* of the other's identical `id="a"` in the same shadow root - the
 * DOM's own `id` uniqueness invariant already broken before any browser gets a chance to decide which
 * copy `url(#a)` resolves against. That collision is the confirmed cause this item's own "Done when"
 * asks for - not a browser-specific painting quirk downstream of it (this project's test suite is
 * jsdom, which does not paint at all; the DOM-level defect is real and browser-independent, which is
 * why the fix targets exactly it rather than any one renderer's specific failure mode).
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

/** Identical shape to `touchRoutingSheet.test.ts`'s own `stubHover` - each query gets its own
 * answer, so this never accidentally also fakes `prefers-reduced-motion`/`pointer` into matching. */
function stubHover(matchesHoverNone: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: query === "(hover: none)" ? matchesHoverNone : false })),
  );
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

/** Every element anywhere in the shadow root that carries a non-empty `id` attribute - `linearGradient`/
 * `radialGradient` are the only elements this widget ever gives an `id`, but this walks every element
 * rather than naming those tags, so it also catches a fix that moved the `id` onto some other node. */
function allIds(root: ShadowRoot): string[] {
  return [...root.querySelectorAll("[id]")].map((el) => el.id).filter((id) => id !== "");
}

function maxRow(root: ShadowRoot, selector: string): HTMLElement {
  const row = [...root.querySelectorAll<HTMLElement>(selector)].find((r) => r.textContent?.includes("MAX"));
  if (row === undefined) {
    throw new Error(`no MAX row found for ${selector}`);
  }
  return row;
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

describe("two MAX icons alive in the same shadow root at once (the AboveComposer card and the touch routing sheet)", () => {
  it("confirms the cause: every id the widget ever mints is unique - collides today, unique after the fix", async () => {
    stubHover(true);
    stubFetch({
      channelLinks: [{ kind: "Max", url: "https://max.ru/tenant_bot" }],
      widgetChannelSwitcherPlacement: "AboveComposer",
    });
    joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
    const panel = await mountWidget();

    // The card builds unconditionally at handshake time, `loadChannelSwitcherCard`'s own doc
    // comment - present in the shadow root before the visitor has tapped anything.
    expect(panel.root.querySelector(".ago-channel-switcher")).not.toBeNull();

    // A device answering `(hover: none)` truthy routes the tap to the sheet instead of opening chat
    // directly - `toggleOpen`'s own gate (`25-197`/`25-198`) - so the sheet's own MAX row is now a
    // second, independent `buildBrandIcon("Max")` call landing in the very same shadow root as the
    // card's, which was never removed.
    panel.toggle.click();
    await flush();
    expect(panel.root.querySelector(".ago-touch-routing-sheet")).toHaveProperty("hidden", false);

    const ids = allIds(panel.root);
    // The confirmation itself: MAX's own tree mints 4 ids (`a`, `b`, `c`, `d`) per instance, so two
    // live instances must show 8 total ids - the real question is whether they are 8 *distinct*
    // values (fixed) or the same 4 values twice (today's defect).
    expect(ids.length).toBe(8);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every gradient reference inside a MAX icon self-contained - resolvable to an id that exists exactly once", async () => {
    stubHover(true);
    stubFetch({
      channelLinks: [{ kind: "Max", url: "https://max.ru/tenant_bot" }],
      widgetChannelSwitcherPlacement: "AboveComposer",
    });
    joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
    const panel = await mountWidget();
    panel.toggle.click();
    await flush();

    const cardIcon = maxRow(panel.root, ".ago-channel-switcher-row").querySelector("svg")!;
    const sheetIcon = maxRow(panel.root, ".ago-touch-routing-row").querySelector("svg")!;

    for (const icon of [cardIcon, sheetIcon]) {
      // Only `href="#a"` (a gradient inheriting another gradient's stops) and `fill="url(#c)"` (a
      // shape painted with a gradient) are actual fragment references in this tree - `fill="#fff"`
      // on the path below is a literal colour, not a reference, and must not be mistaken for one.
      const refs = [
        ...[...icon.querySelectorAll("[href]")].map((el) => el.getAttribute("href")),
        ...[...icon.querySelectorAll("[fill]")]
          .map((el) => el.getAttribute("fill"))
          .filter((value): value is string => value !== null && value.startsWith("url(")),
      ]
        .filter((value): value is string => value !== null)
        .map((value) => value.match(/#([\w-]+)/)?.[1])
        .filter((id): id is string => id !== undefined);

      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        // The referenced id must exist exactly once *in the whole shadow root* (not merely inside
        // this icon's own subtree) - that global uniqueness is what makes `url(#id)` resolution
        // unambiguous regardless of which of the two instances a browser's own fragment lookup
        // happens to favour.
        expect(panel.root.querySelectorAll(`[id="${ref}"]`)).toHaveLength(1);
      }
    }
  });

  it("renders correctly when it is the only instance in the document - the pre-existing, already-working case", async () => {
    stubHover(false);
    stubFetch({ channelLinks: [{ kind: "Max", url: "https://max.ru/tenant_bot" }] });
    joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
    const panel = await mountWidget();
    panel.toggle.click();
    await flush();

    // No hover-none device here, so the sheet is never built - `.ago-channel-switcher` is the only
    // MAX instance in the shadow root.
    expect(panel.root.querySelector(".ago-touch-routing-sheet")).toBeNull();
    const icon = maxRow(panel.root, ".ago-channel-switcher-row").querySelector("svg")!;
    // `CHANNEL_ICON_TREES.Max`'s own `<defs>`: linearGradient "b", linearGradient "a",
    // linearGradient "c", radialGradient "d" - four gradient elements per instance.
    expect(icon.querySelectorAll("linearGradient, radialGradient")).toHaveLength(4);
    expect(icon.getAttribute("style") ?? "").toContain("clip-path:circle(50% at 50% 50%)");

    const ids = allIds(panel.root);
    expect(ids.length).toBe(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("leaves Telegram/WhatsApp/Vk unaffected - no `id` anywhere in their trees, with or without a second instance", async () => {
    stubHover(true);
    stubFetch({
      channelLinks: [
        { kind: "Telegram", url: "https://t.me/tenant_bot?start=abc123" },
        { kind: "WhatsApp", url: "https://wa.me/15550100" },
        { kind: "Vk", url: "https://vk.me/tenant_bot" },
      ],
      widgetChannelSwitcherPlacement: "AboveComposer",
    });
    joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
    const panel = await mountWidget();
    panel.toggle.click();
    await flush();

    expect(panel.root.querySelector(".ago-touch-routing-sheet")).toHaveProperty("hidden", false);
    expect(allIds(panel.root)).toEqual([]);

    const displayNameByKind: Record<string, string> = { Telegram: "Telegram", WhatsApp: "WhatsApp", Vk: "VK" };
    for (const [kind, label] of Object.entries(displayNameByKind)) {
      const cardRow = [...panel.root.querySelectorAll<HTMLElement>(".ago-channel-switcher-row")].find((r) =>
        r.textContent?.includes(label),
      )!;
      const sheetRow = [...panel.root.querySelectorAll<HTMLElement>(".ago-touch-routing-row")].find((r) =>
        r.textContent?.includes(label),
      )!;
      for (const row of [cardRow, sheetRow]) {
        const svg = row.querySelector("svg")!;
        expect(svg.querySelectorAll("path").length).toBeGreaterThan(1);
        expect(svg.getAttribute("fill")).not.toBe("currentColor");
      }
      void kind;
    }
  });
});
