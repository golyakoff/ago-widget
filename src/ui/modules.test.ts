import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig, type WidgetConfig } from "../config.js";
import { currentHub, joinQueue, resetFakeSignalR } from "../testing/fakeSignalR.js";

/**
 * `20-07`: booking behind the chat contract, from the widget's own side.
 *
 * `20-06`'s `ui/booking.test.ts` tested a second panel with its own direct-HTTP flow; that panel is
 * gone (`BookingPanel`, `CalendarClient`, `BookingFlow`, `steps.ts` are all deleted, not moved), so
 * this file replaces it rather than extending it. What is left to prove:
 *
 * - The module chip is absent, and the lazy module bundle is never fetched, unless the site's own
 *   handshake response says the calendar module is granted (`VisitorSessionResponse.enabledModules`,
 *   `23-105`) - mirrors `20-06`'s own "a shop that did not buy booking pays nothing", now decided by
 *   the platform's own entitlement instead of an attribute on the tenant's page. `23-105`'s own
 *   proof - that the retired `data-booking` attribute can no longer turn the chip on - lives in
 *   `config.test.ts`, since `readConfig` never reaches this file at all any more.
 * - Clicking the chip is **not a second code path** - it sends the trigger phrase through the exact
 *   function a typed-and-Entered message already uses (`18-03`'s own interaction shape).
 * - A step arriving as an ordinary chat message renders richly (`ui/primitives/render.ts`), and
 *   replying to it sends the wire-contract-exact shape: `contentKind` equal to the kind being
 *   replied to, `content: { value }`, no `actions`.
 * - A `form` step's reply is free text regardless of what it looks like - the numeric-looking case
 *   the backlog's own "Where this goes wrong" section names explicitly.
 * - No request ever reaches AGO Calendar directly - there is no HTTP client left in this repository
 *   that could make one.
 *
 * `ui/moduleLoader.ts`'s real `loadModule` does a runtime `import()` of a URL nothing in this test
 * environment serves, so it is mocked here - the one seam between "genuinely lazy in a real browser"
 * (proved by `bundleInputs.test.ts` against the real build) and "testable under vitest/jsdom".
 */
// `25-27`: the one `readConfig` call in this file (below, "stays absent for a page that still
// asserts data-booking") evaluates `WidgetConfig.policyBaseUrl` unconditionally - `config.test.ts`'s
// own comment on this same stand-in explains why a bare global is the faithful way to fake an
// esbuild `define` outside a real build.
(globalThis as unknown as Record<string, string>)["__AGO_DEFAULT_POLICY_BASE_URL__"] = "https://office.test.invalid";

vi.mock("@microsoft/signalr", () => import("../testing/fakeSignalR.js"));

const loadModuleMock = vi.fn((_scriptUrl: string, _fileName: string) => ({
  bookingChipSpec: (locale: string) =>
    locale === "ru"
      ? { label: "Запись", ariaLabel: "Записаться на приём", triggerText: "/booking" }
      : { label: "Book", ariaLabel: "Book an appointment", triggerText: "/booking" },
}));
vi.mock("./moduleLoader.js", () => ({
  loadModule: (scriptUrl: string, fileName: string) => loadModuleMock(scriptUrl, fileName),
}));

const { ChatWidget } = await import("./widget.js");

// `23-105`: a single fixture, not two - whether booking appears is decided by the handshake
// response now (`stubFetch`'s `enabledModules` parameter below), not by anything on `WidgetConfig`.
const config: WidgetConfig = {
  siteKey: "shop_test",
  apiBaseUrl: "https://api.test.invalid",
  demoNotice: "none",
  policyBaseUrl: "https://office.test.invalid",
  scriptUrl: "https://cdn.test.invalid/dist/widget.js",
};

const CONVERSATION_ID = "88888888-8888-8888-8888-888888888888";

async function flush(): Promise<void> {
  for (let i = 0; i < 25; i++) {
    await Promise.resolve();
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

// `23-105`: `enabledModules` is the one parameter that decides whether the module chip appears -
// the site's own handshake response, not an attribute on `config` above. Defaults to `[]`, the
// same "no grant, no booking" default `VisitorSession.enabledModules`'s own doc comment gives.
function stubFetch(widgetLocale?: string, enabledModules: string[] = []): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          token: "visitor-token",
          visitorId: "99999999-9999-9999-9999-999999999999",
          widgetPrimaryColorHex: null,
          widgetPosition: "BottomRight",
          enabledModules,
          ...(widgetLocale === undefined ? {} : { widgetLocale }),
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function joinResult(): { conversationId: string; isNew: boolean; history: unknown[] } {
  return { conversationId: CONVERSATION_ID, isNew: false, history: [] };
}

/** Mounts, opens (which lazily builds the connection - `5-09`) and joins with a real
 * `conversationId`, without which `dispatchSend` refuses to send anything at all. */
async function mountAndOpen(config: WidgetConfig): Promise<ShadowRoot> {
  joinQueue.push(joinResult());
  const widget = new ChatWidget(config);
  widget.mount(document.body);
  await flush();

  const host = document.querySelector("[data-ago-chat-widget]");
  if (host?.shadowRoot == null) {
    throw new Error("the widget did not mount");
  }

  host.shadowRoot.querySelector<HTMLButtonElement>(".ago-toggle")!.click();
  await flush();

  return host.shadowRoot;
}

beforeEach(() => {
  resetFakeSignalR();
  document.body.innerHTML = "";
  localStorage.clear();
  loadModuleMock.mockClear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the module invocation chip", () => {
  it("is absent and never fetches the lazy module bundle when the site has no calendar grant", async () => {
    const root = await mountAndOpen(config);

    expect(root.querySelector(".ago-module-chip")).toBeNull();
    expect(loadModuleMock).not.toHaveBeenCalled();
  });

  // `23-105`: the exact regression the item exists to close - a page that still carries the old,
  // retired `data-booking="true"` attribute must not get booking without a real grant. `readConfig`
  // is exercised directly here (rather than via `config` above) because that is the one place the
  // attribute could still matter if this fix regressed - `config.ts`'s own remarks explain why it
  // no longer reads the attribute at all.
  it("stays absent for a page that still asserts data-booking=\"true\" with no grant behind it", async () => {
    const script = document.createElement("script");
    script.dataset["site"] = config.siteKey;
    script.dataset["api"] = config.apiBaseUrl;
    script.dataset["booking"] = "true";
    const untouchedPageConfig = readConfig(script);

    const root = await mountAndOpen({ ...untouchedPageConfig, scriptUrl: config.scriptUrl });

    expect(root.querySelector(".ago-module-chip")).toBeNull();
    expect(loadModuleMock).not.toHaveBeenCalled();
  });

  it("loads and shows the chip once the site's handshake response grants the calendar module", async () => {
    stubFetch(undefined, ["calendar"]);
    const root = await mountAndOpen(config);
    await flush();

    expect(loadModuleMock).toHaveBeenCalledWith(config.scriptUrl, "widget-module-booking.js");

    const chip = root.querySelector<HTMLButtonElement>(".ago-module-chip")!;
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe("Book");
    expect(chip.getAttribute("aria-label")).toBe("Book an appointment");
  });

  // `23-105`: a granted site may hold other module keys too (`adr/0065`'s vocabulary is not
  // closed to one entry) - only the presence of `"calendar"` among them decides this chip, never
  // whether the list is merely non-empty.
  it("stays absent when the site's granted modules do not include calendar", async () => {
    stubFetch(undefined, ["some-future-module"]);
    const root = await mountAndOpen(config);
    await flush();

    expect(root.querySelector(".ago-module-chip")).toBeNull();
    expect(loadModuleMock).not.toHaveBeenCalled();
  });

  it("loads the chip's copy in the site's own resolved locale, not always English", async () => {
    stubFetch("Ru", ["calendar"]);
    const root = await mountAndOpen(config);
    await flush();

    const chip = root.querySelector<HTMLButtonElement>(".ago-module-chip")!;
    expect(chip.textContent).toBe("Запись");
    expect(chip.getAttribute("aria-label")).toBe("Записаться на приём");
  });

  it("adds no second launcher and no second panel", async () => {
    stubFetch(undefined, ["calendar"]);
    const root = await mountAndOpen(config);
    expect(root.querySelectorAll(".ago-toggle")).toHaveLength(1);
    expect(root.querySelectorAll(".ago-panel")).toHaveLength(1);
    expect(document.querySelectorAll("[data-ago-chat-widget]")).toHaveLength(1);
  });

  it("clicking it sends the trigger phrase through the same path a typed-and-Entered message uses - not a second code path", async () => {
    stubFetch(undefined, ["calendar"]);
    const root = await mountAndOpen(config);
    await flush();

    root.querySelector<HTMLButtonElement>(".ago-module-chip")!.click();
    await flush();

    // Rendered exactly as any other visitor-sent message - no separate view, no booking-only bubble
    // styling.
    const bubbles = [...root.querySelectorAll(".ago-message--visitor")];
    expect(bubbles.some((bubble) => bubble.textContent?.includes("/booking"))).toBe(true);

    // Plain text, not a structured reply - SendMessageAsync (4 args), the same method and arity a
    // visitor typing "/booking" and pressing Enter would produce, never SendStructuredMessageAsync.
    const invocation = currentHub().invocationAt("SendMessageAsync", 0);
    expect(invocation.args[1]).toBe("/booking");
    expect(invocation.args.length).toBe(4);
  });

  it("never makes a direct HTTP request to AGO Calendar - there is no client left in this bundle that could", async () => {
    stubFetch(undefined, ["calendar"]);
    const fetchMock = vi.mocked(globalThis.fetch);
    const root = await mountAndOpen(config);
    await flush();

    root.querySelector<HTMLButtonElement>(".ago-module-chip")!.click();
    await flush();

    expect(fetchMock.mock.calls.every((call) => !urlOf(call[0]).includes("calendar"))).toBe(true);
  });
});

describe("rendering a step-shaped message from a module", () => {
  it("renders choice_list actions as buttons on an operator-authored message, and replies with contentKind/content/no-actions matching the wire contract exactly", async () => {
    const root = await mountAndOpen(config);

    currentHub().push({
      id: "22222222-2222-2222-2222-222222222222",
      sequence: 2,
      authorKind: "Operator",
      authorId: "op-1",
      body: "What would you like to book?",
      createdAt: "2026-08-29T00:00:00+00:00",
      contentKind: "choice_list",
      content: { prompt: "What would you like to book?" },
      actions: [
        { label: "Haircut (45 min)", value: "svc-1" },
        { label: "Beard trim (20 min)", value: "svc-2" },
      ],
    });
    await flush();

    const choices = [...root.querySelectorAll<HTMLButtonElement>(".ago-primitive-choice")];
    expect(choices.map((choice) => choice.textContent)).toEqual(["Haircut (45 min)", "Beard trim (20 min)"]);

    choices[0]!.click();
    await flush();

    // A structured reply - SendStructuredMessageAsync, not SendMessageAsync: the two are separate
    // hub methods with separate arities (VisitorHub's own arity-rule comment), not one method that
    // grows two more parameters when a reply happens to be structured.
    const invocation = currentHub().invocationAt("SendStructuredMessageAsync", 0);
    expect(invocation.args[1]).toBe("Haircut (45 min)"); // the human-readable body of the reply
    expect(invocation.args[4]).toBe("choice_list");
    // `25-31`: a JSON *string*, not a raw object - `ago-chat`'s own `MessagePayload` is a `string`
    // it parses as JSON (`JsonDocument.Parse`), and SignalR's JSON hub protocol serializes each
    // argument by its own JS shape - an object here reaches the server as a JSON object where the
    // hub method declares `string?`, a binding mismatch SignalR rejects before the method is ever
    // invoked. This fake hub never exercised real wire serialization, which is exactly how this
    // assertion stayed wrong (asserting the bug) until a live click-through found it.
    expect(invocation.args[5]).toBe(JSON.stringify({ value: "svc-1" }));
    expect(invocation.args[6]).toBeNull(); // actions - the widget never populates this
  });

  it("degrades an unrecognised contentKind to the plain body, without throwing", async () => {
    const root = await mountAndOpen(config);

    expect(() =>
      currentHub().push({
        id: "33333333-3333-3333-3333-333333333333",
        sequence: 2,
        authorKind: "Operator",
        authorId: "op-1",
        body: "Here is a map of available drivers.",
        createdAt: "2026-08-29T00:00:00+00:00",
        contentKind: "week_grid",
        content: { anything: "goes" },
        actions: [{ label: "Whatever", value: "x" }],
      }),
    ).not.toThrow();
    await flush();

    expect(root.querySelector(".ago-primitive")).toBeNull();
    const bubbles = [...root.querySelectorAll(".ago-message--operator")];
    expect(bubbles.some((bubble) => bubble.textContent === "Here is a map of available drivers.")).toBe(true);
  });

  it("a numeric-looking form field still submits as free text, not as an action click", async () => {
    const root = await mountAndOpen(config);

    currentHub().push({
      id: "44444444-4444-4444-4444-444444444444",
      sequence: 2,
      authorKind: "System",
      authorId: "system",
      body: "What is your phone number?",
      createdAt: "2026-08-29T00:00:00+00:00",
      contentKind: "form",
      content: { prompt: "What is your phone number?", fieldId: "phone", fieldLabel: "Phone number" },
      actions: [],
    });
    await flush();

    const input = root.querySelector<HTMLInputElement>(".ago-primitive-form-input")!;
    input.value = "12345";
    root.querySelector<HTMLFormElement>(".ago-primitive-form")!.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );
    await flush();

    const invocation = currentHub().invocationAt("SendStructuredMessageAsync", 0);
    expect(invocation.args[1]).toBe("12345");
    expect(invocation.args[4]).toBe("form"); // still a "form" reply, never reinterpreted as a choice
    expect(invocation.args[5]).toBe(JSON.stringify({ value: "12345" })); // `25-31`: a JSON string, not a raw object
  });

  it("does not render primitive content for the visitor's own echoed reply", async () => {
    const root = await mountAndOpen(config);

    // The echo of a reply this same widget just sent - contentKind carries the kind it replied to,
    // content is `{ value }` only, no actions. Rendering it as a fresh prompt would draw a second
    // set of buttons under a bubble that already answered them.
    currentHub().push({
      id: "55555555-5555-5555-5555-555555555555",
      sequence: 3,
      authorKind: "Visitor",
      authorId: "visitor-1",
      body: "Haircut (45 min)",
      createdAt: "2026-08-29T00:00:01+00:00",
      contentKind: "choice_list",
      content: { value: "svc-1" },
      actions: [],
    });
    await flush();

    expect(root.querySelector(".ago-primitive")).toBeNull();
  });
});
