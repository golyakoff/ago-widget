import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetConfig } from "../config.js";
import { joinQueue, resetFakeSignalR } from "../testing/fakeSignalR.js";

/**
 * `25-199` - the touch routing sheet's MAX row rendered with no icon. `channelSwitcher.test.ts`
 * already proves the `AboveComposer` banner renders MAX's icon correctly *in isolation* - this file's
 * whole job is the case that isolation never covers: a second `buildBrandIcon("Max")` call landing
 * in the same shadow root while the first instance is still there.
 *
 * **Confirming the cause, not assuming it.** `widget.ts`'s own `CHANNEL_ICON_TREES.Max` (~L313-383)
 * is read directly below before any fix exists: it is the only brand tree with `<defs>` children
 * carrying fixed `id`s (`a`, `b`, `c`, `d`), referenced via `fill="url(#c)"`/`href="#a"` etc. Every
 * other recognised brand (`Telegram`/`WhatsApp`/`Vk`) is flat `fill="#hex"` paths with no `id`
 * anywhere in its own tree. `buildChannelSwitcherBanner` (`25-149`, replaced by `25-204` - this file's
 * scenario is unaffected by that rewrite since it only changed *where* the rows render, not this
 * concurrency) builds the `AboveComposer` banner - MAX icon included - the moment the handshake
 * resolves, only when `isTouchRoutingDevice()` (`25-198`) is false at that moment; `openTouchRoutingSheet`
 * (`25-197`) builds the sheet - a second MAX icon, if the tenant has one connected - lazily, on the
 * visitor's first tap, gated by that same live `matchMedia("(hover: none)")` read at click time.
 *
 * `25-198` closed the *steady-state* path to two concurrent instances - a touch device now never
 * builds the banner at all, so it alone cannot see this bug once that item lands. The path this file
 * exercises instead is the one `25-199`'s own "Out of scope" section names as surviving regardless:
 * `matchMedia` is a live, re-evaluatable query, not a fixed device fact, so a hover-capable device
 * that later "narrows" to touch mid-session - a hybrid 2-in-1 switching from mouse to touchscreen
 * between the handshake and the visitor's own tap, the exact case that section describes - still
 * gets the banner built while hover-capable, then routes a later tap to the sheet once the live
 * read changes. Tests below reconstruct exactly that ordering (`stubHover(false)` before `mount`,
 * `stubHover(true)` before the click) rather than depending on both instances being reachable from a
 * single, unchanging device state - the real, still-live shape of the concurrency this item exists
 * for, not a setup 25-198 happens to remove.
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

/**
 * A sheet row carries *both* `.ago-channel-switcher-row` (`buildChannelSwitcherRow`'s own class,
 * `25-149`) and `.ago-touch-routing-row` (`buildTouchRoutingSheet`'s own addition, `25-197`) -
 * `openTouchRoutingSheet` reuses the banner's own row builder wholesale. A plain, unscoped
 * `.ago-channel-switcher-row` query therefore matches sheet rows too, and once the banner is absent
 * (or simply not queried for) that query silently resolves to the sheet's own row - the exact
 * collapse-onto-one-element failure this helper exists to make structurally impossible: `container`
 * is always one of the two distinct wrapper elements (`.ago-channel-switcher-banner` for the banner,
 * `.ago-touch-routing-sheet` for the sheet), so a row can only ever be found within the one its own
 * `container` actually names, never the other.
 */
function maxRowWithin(container: Element, rowSelector: string): HTMLElement {
  const row = [...container.querySelectorAll<HTMLElement>(rowSelector)].find((r) => r.textContent?.includes("MAX"));
  if (row === undefined) {
    throw new Error(`no MAX row found for ${rowSelector} within ${container.className}`);
  }
  return row;
}

function cardContainer(root: ShadowRoot): Element {
  const el = root.querySelector(".ago-channel-switcher-banner");
  if (el === null) {
    throw new Error("the AboveComposer banner was not built");
  }
  return el;
}

function sheetContainer(root: ShadowRoot): Element {
  const el = root.querySelector(".ago-touch-routing-sheet");
  if (el === null) {
    throw new Error("the touch routing sheet was not built");
  }
  return el;
}

/**
 * Reconstructs "the banner is already built, then the sheet is built too" without depending on a
 * single unchanging device state - see the file's own top comment for why that matters after
 * `25-198`. Hover-capable at handshake time (the banner builds via its ordinary `AboveComposer` path,
 * untouched by `25-198`'s gate), then the device "narrows" to touch before the one tap this helper
 * makes, which `toggleOpen`'s own live `matchMedia` read routes to the sheet instead of opening chat.
 * Both wrapper elements are asserted present before returning, so a caller's own assertions never
 * have to re-prove the setup worked.
 */
async function mountWithBothPlacementsBuilt(channelLinks: ChannelLinkFixture[]): Promise<Panel> {
  stubHover(false);
  stubFetch({ channelLinks, widgetChannelSwitcherPlacement: "AboveComposer" });
  joinQueue.push({ conversationId: "conv-1", isNew: false, history: [] });
  const panel = await mountWidget();
  expect(panel.root.querySelector(".ago-channel-switcher-banner")).not.toBeNull();

  stubHover(true);
  panel.toggle.click();
  await flush();
  expect(panel.root.querySelector(".ago-touch-routing-sheet")).toHaveProperty("hidden", false);

  return panel;
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

describe("two MAX icons alive in the same shadow root at once (the AboveComposer banner and the touch routing sheet)", () => {
  it("confirms the cause: every id the widget ever mints is unique - collides today, unique after the fix", async () => {
    const panel = await mountWithBothPlacementsBuilt([{ kind: "Max", url: "https://max.ru/tenant_bot" }]);

    const ids = allIds(panel.root);
    // The confirmation itself: MAX's own tree mints 4 ids (`a`, `b`, `c`, `d`) per instance, so two
    // live instances must show 8 total ids - the real question is whether they are 8 *distinct*
    // values (fixed) or the same 4 values twice (today's defect).
    expect(ids.length).toBe(8);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every gradient reference inside a MAX icon self-contained - resolvable to an id that exists exactly once", async () => {
    const panel = await mountWithBothPlacementsBuilt([{ kind: "Max", url: "https://max.ru/tenant_bot" }]);

    const cardIcon = maxRowWithin(cardContainer(panel.root), ".ago-channel-switcher-row").querySelector("svg")!;
    const sheetIcon = maxRowWithin(sheetContainer(panel.root), ".ago-touch-routing-row").querySelector("svg")!;

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

    // No hover-none device here, so the sheet is never built - `.ago-channel-switcher-banner` is the
    // only MAX instance in the shadow root.
    expect(panel.root.querySelector(".ago-touch-routing-sheet")).toBeNull();
    const icon = maxRowWithin(cardContainer(panel.root), ".ago-channel-switcher-row").querySelector("svg")!;
    // `CHANNEL_ICON_TREES.Max`'s own `<defs>`: linearGradient "b", linearGradient "a",
    // linearGradient "c", radialGradient "d" - four gradient elements per instance.
    expect(icon.querySelectorAll("linearGradient, radialGradient")).toHaveLength(4);
    expect(icon.getAttribute("style") ?? "").toContain("clip-path:circle(50% at 50% 50%)");

    const ids = allIds(panel.root);
    expect(ids.length).toBe(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("leaves Telegram/WhatsApp/Vk unaffected - no `id` anywhere in their trees, with or without a second instance", async () => {
    const panel = await mountWithBothPlacementsBuilt([
      { kind: "Telegram", url: "https://t.me/tenant_bot?start=abc123" },
      { kind: "WhatsApp", url: "https://wa.me/15550100" },
      { kind: "Vk", url: "https://vk.me/tenant_bot" },
    ]);

    expect(allIds(panel.root)).toEqual([]);

    const card = cardContainer(panel.root);
    const sheet = sheetContainer(panel.root);
    const displayNameByKind: Record<string, string> = { Telegram: "Telegram", WhatsApp: "WhatsApp", Vk: "VK" };
    for (const label of Object.values(displayNameByKind)) {
      const cardRow = [...card.querySelectorAll<HTMLElement>(".ago-channel-switcher-row")].find((r) =>
        r.textContent?.includes(label),
      )!;
      // Scoped to the sheet's own container, not a bare `.ago-touch-routing-row` query, for the
      // identical reason `maxRowWithin`'s own doc comment gives - a row found this way can only ever
      // be the sheet's, never the card's, regardless of which classes either happens to share.
      const sheetRow = [...sheet.querySelectorAll<HTMLElement>(".ago-touch-routing-row")].find((r) =>
        r.textContent?.includes(label),
      )!;
      for (const row of [cardRow, sheetRow]) {
        const svg = row.querySelector("svg")!;
        expect(svg.querySelectorAll("path").length).toBeGreaterThan(1);
        expect(svg.getAttribute("fill")).not.toBe("currentColor");
      }
    }
  });
});
