import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `11-08`, `testing.md`'s "Widget isolation" level: the widget's own claims about running inside a
 * stranger's document, exercised against a page built to break it rather than asserted from the
 * presence of `attachShadow`.
 *
 * The hostile page below is the jsdom twin of `demo/index.html` - the same three kinds of hostility
 * (global `!important` CSS, a page that reassigns globals, ids and class names that collide with the
 * widget's own) - so the two stay comparable, one automated and one for live verification.
 *
 * ## What jsdom can prove here, and what it cannot
 *
 * **It cannot prove the CSS cascade half.** Measured, not assumed (2026-08-25): with the host page's
 * `* { font-family: "Comic Sans MS" !important }` and `button { background: red !important }` in
 * `document.head`, jsdom's `getComputedStyle` returns *those* values for a `<button>` **inside** an
 * open shadow root, and returns nothing at all for the shadow root's own `<style>` rules. jsdom
 * matches selectors against the flattened document and does not implement shadow-boundary scoping in
 * its cascade at all, so a `expect(getComputedStyle(toggle).fontFamily).not.toBe(...)` assertion here
 * would fail against *correct* code and would prove nothing if it passed. It is not written.
 *
 * **What it can prove is the mechanism underneath that half**, which is a DOM property and not a
 * style computation: the widget's markup is not reachable from the host document's own selector
 * queries, and its stylesheet is inside the shadow root rather than in the host's `<head>`. In a real
 * browser those two facts are exactly what makes `button { ... !important }` unable to reach in - the
 * host's rules are matched against the host tree, which does not contain the widget. The remaining
 * gap (that a browser really does honour that boundary) is what `demo/index.html` and live
 * verification are for, and `README.md`'s testing section says so.
 */

// All three are esbuild `define`s replaced by `build.mjs`, and genuinely absent under vitest, which
// does not run that build. Declared on `globalThis` for the same reason `config.test.ts` already does:
// the bundled code reads a bare identifier, and a global of that name is what a bare identifier
// resolves to.
(globalThis as unknown as Record<string, string>)["__AGO_DEFAULT_API_BASE_URL__"] = "https://built-in.example";
(globalThis as unknown as Record<string, string>)["__AGO_WIDGET_VERSION__"] = "0.1.0-test";
(globalThis as unknown as Record<string, string>)["__AGO_COMMIT__"] = "0".repeat(40);

const SITE_KEY = "demo_site";
const API_BASE_URL = "https://api.test.invalid";

interface HostileWindow {
  AgoChat?: unknown;
  $?: () => never;
  hostPageStillWorks?: () => string;
}

function hostile(): HostileWindow {
  return window;
}

/**
 * The bad neighbour. Everything here exists to break a widget that leaks style, pollutes globals,
 * assumes it owns an id, or throws into the page that loaded it.
 */
function buildHostilePage(): void {
  document.head.innerHTML = `
    <style>
      * { box-sizing: content-box !important; font-family: "Comic Sans MS", cursive !important; }
      body { color: lime !important; font-size: 22px !important; line-height: 3 !important; }
      button { background: red !important; color: yellow !important; text-transform: uppercase !important; }
      div { border: 3px solid magenta !important; padding: 12px !important; }
      .ago-panel { display: none !important; }
      .ago-toggle { visibility: hidden !important; }
    </style>`;

  // Ids and class names chosen to collide with the widget's own, which is the failure mode a widget
  // that reached for `document.getElementById` instead of its own root would hit.
  document.body.innerHTML = `
    <h1 id="ago-root">A very normal shop</h1>
    <div id="ago-chat" class="ago-panel">The host page's own element, which happens to share a name.</div>
    <button class="ago-toggle" id="ago-toggle">The host page's own button</button>
    <div class="ago-messages">The host page's own messages list.</div>`;

  // A fake global some other host-page script might define. The widget must never touch it, call it,
  // or overwrite it (embeddable-widget skill: "never touch window.$, prototypes, or existing globals").
  hostile().$ = () => {
    throw new Error("the widget must never call the host page's own $ function");
  };

  hostile().hostPageStillWorks = () => "yes";

  localStorage.setItem("cart", "2 items");
  localStorage.setItem("ago-chat-lookalike", "not the widget's key");
}

function embedTag(attributes: Record<string, string> = {}): HTMLScriptElement {
  const script = document.createElement("script");
  script.setAttribute("data-site", SITE_KEY);
  script.setAttribute("data-api", API_BASE_URL);
  for (const [name, value] of Object.entries(attributes)) {
    script.setAttribute(name, value);
  }

  document.body.appendChild(script);
  return script;
}

/**
 * Runs the widget's real bootstrap (`index.ts`) the way a browser would: `document.currentScript`
 * pointing at the embed tag, module evaluated once per inclusion. `resetModules` is what makes a
 * second `<script>` tag a genuinely second evaluation rather than a cached no-op - without it the
 * "included twice" case would pass for the wrong reason.
 */
async function runEmbed(script: HTMLScriptElement): Promise<void> {
  Object.defineProperty(document, "currentScript", { value: script, configurable: true });
  vi.resetModules();
  await import("./index.js");
  // The session handshake is fired from the constructor; let its promise settle so anything it would
  // do to the DOM or to storage has happened before a test looks.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function widgetHost(): HTMLElement {
  const host = document.querySelector<HTMLElement>("[data-ago-chat-widget]");
  if (host === null) {
    throw new Error("the widget did not mount");
  }

  return host;
}

function shadow(): ShadowRoot {
  const root = widgetHost().shadowRoot;
  if (root === null) {
    throw new Error("the widget's host element has no shadow root");
  }

  return root;
}

let globalsBefore: Set<string>;

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  localStorage.clear();
  delete hostile().AgoChat;

  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            token: "visitor-token",
            visitorId: "33333333-3333-3333-3333-333333333333",
            widgetPrimaryColorHex: "#00aa55",
            widgetPosition: "BottomLeft",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ),
  );

  buildHostilePage();
  globalsBefore = new Set(Object.keys(window));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the widget on a hostile host page", () => {
  it("puts its whole surface behind a shadow root the host document cannot query into", async () => {
    await runEmbed(embedTag());

    // The widget's own controls exist...
    expect(shadow().querySelector(".ago-toggle")).not.toBeNull();
    expect(shadow().querySelector(".ago-panel")).not.toBeNull();
    expect(shadow().querySelector(".ago-messages")).not.toBeNull();

    // ...and are invisible to every document-level query, which is the same matching the host's
    // `.ago-toggle { visibility: hidden !important }` rule would have to do to reach them.
    const toggles = document.querySelectorAll(".ago-toggle");
    expect(toggles).toHaveLength(1);
    expect(document.getElementById("ago-toggle")?.textContent).toBe("The host page's own button");
    expect(document.querySelectorAll(".ago-panel")).toHaveLength(1);
    expect(document.getElementsByTagName("textarea")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Chat with us");
  });

  it("keeps its stylesheet inside that root instead of adding one to the host's head", async () => {
    const headBefore = document.head.innerHTML;
    await runEmbed(embedTag());

    expect(document.head.innerHTML).toBe(headBefore);
    expect(document.querySelectorAll("head style, head link")).toHaveLength(1); // the host's own
    expect(shadow().querySelector("style")?.textContent).toContain(":host");
  });

  it("adds exactly one element to the host's body and touches none of its own", async () => {
    const hostOwnElements = [...document.body.children].filter((element) => element.tagName !== "SCRIPT");
    const before = hostOwnElements.map((element) => element.outerHTML);

    await runEmbed(embedTag());

    expect([...document.body.children].filter((element) => element.hasAttribute("data-ago-chat-widget"))).toHaveLength(1);
    expect(hostOwnElements.map((element) => element.outerHTML)).toEqual(before);
    expect(document.getElementById("ago-root")?.tagName).toBe("H1");
    expect(document.getElementById("ago-toggle")?.textContent).toBe("The host page's own button");
  });

  it("adds one global and leaves the host page's own alone", async () => {
    await runEmbed(embedTag());

    const added = [...Object.keys(window)].filter((name) => !globalsBefore.has(name));
    expect(added).toEqual(["AgoChat"]);
    // `15-07`: still exactly one global, and it now carries the commit the bundle was built from
    // alongside the version - the widget's own answer to what GET /healthz/version answers for the
    // .NET hosts, for a bundle running on a page whose origin serves no version.json of ours.
    expect(hostile().AgoChat).toEqual({ version: "0.1.0-test", commit: "0".repeat(40) });
    // Still the host page's function, never called and never replaced - it throws if either happened.
    expect(() => hostile().$?.()).toThrow("the widget must never call the host page's own $ function");
    expect(hostile().hostPageStillWorks?.()).toBe("yes");
  });

  it("writes only namespaced storage keys and reads none of the host page's", async () => {
    await runEmbed(embedTag());

    const keys = Object.keys(localStorage);
    const written = keys.filter((key) => key !== "cart" && key !== "ago-chat-lookalike");
    expect(written.length).toBeGreaterThan(0);
    for (const key of written) {
      expect(key.startsWith(`ago-chat:${SITE_KEY}:`)).toBe(true);
    }

    expect(localStorage.getItem("cart")).toBe("2 items");
    expect(localStorage.getItem("ago-chat-lookalike")).toBe("not the widget's key");
  });

  it("applies the site's own appearance to its own host element, not to the host page", async () => {
    await runEmbed(embedTag());

    // `11-03`'s per-site color and position, landing on the shadow host's inline style and on a class
    // inside the root - never on `document.documentElement` or a host-page stylesheet.
    expect(widgetHost().style.getPropertyValue("--ago-accent")).toBe("#00aa55");
    expect(document.documentElement.style.getPropertyValue("--ago-accent")).toBe("");
    expect(shadow().querySelector(".ago-root")?.classList.contains("ago-position-left")).toBe(true);
  });

  it("mounts once when the shop pastes the same embed snippet twice", async () => {
    await runEmbed(embedTag());
    await runEmbed(embedTag());

    expect(document.querySelectorAll("[data-ago-chat-widget]")).toHaveLength(1);
  });

  it("degrades to no widget, without throwing into the page, when its own embed is malformed", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const script = document.createElement("script");
    script.setAttribute("data-api", API_BASE_URL); // no data-site
    document.body.appendChild(script);

    await expect(runEmbed(script)).resolves.toBeUndefined();

    expect(document.querySelector("[data-ago-chat-widget]")).toBeNull();
    expect(errors).toHaveBeenCalled();
    expect(hostile().hostPageStillWorks?.()).toBe("yes");
  });

  it("still mounts on a page whose localStorage throws on every access", async () => {
    // Private-browsing modes and a page served with storage disabled both do this, and so does a host
    // page that has deliberately poisoned it.
    const denied = () => {
      throw new Error("storage is not available on this page");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(denied);

    await runEmbed(embedTag());

    expect(shadow().querySelector(".ago-toggle")).not.toBeNull();
  });

  it("does not mount when the host page has already taken the AgoChat global", async () => {
    // The other side of the "included twice" guard, and worth pinning as a decision rather than
    // discovering later: `index.ts` treats an existing `window.AgoChat` as "already embedded", so a
    // host page (or another vendor) that owns that name gets no widget and no error. Refusing is the
    // right direction - overwriting a global the page relies on would break it - and this test is
    // what makes the choice visible if anyone revisits it.
    hostile().AgoChat = { version: "someone else's" };

    await runEmbed(embedTag());

    expect(document.querySelector("[data-ago-chat-widget]")).toBeNull();
    expect(hostile().AgoChat).toEqual({ version: "someone else's" });
  });
});
