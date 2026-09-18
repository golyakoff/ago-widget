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

// `25-131`: the fake mirrors the real `bookingChipSpec`'s own new signature - it takes the caller's
// trigger word and echoes it back, rather than inventing `/booking` itself, so a test that stubs a
// different word actually exercises the real wiring (`loadBookingModuleChip` reading
// `enabledModuleTriggerWords` and passing it through) instead of a fake that would pass regardless.
const loadModuleMock = vi.fn((_scriptUrl: string, _fileName: string) => ({
  bookingChipSpec: (locale: string, triggerWord: string) =>
    locale === "ru"
      ? { label: "Записаться", ariaLabel: "Записаться на приём", triggerText: triggerWord }
      : { label: "Book", ariaLabel: "Book an appointment", triggerText: triggerWord },
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
//
// `25-131`: `enabledModuleTriggerWords` joins beside it - defaulted to `{ calendar: ["/booking"] }`
// whenever `calendar` is granted (so every pre-existing test in this file, which never customized a
// trigger word, keeps seeing the same `/booking` it always did - the item's own "additive, no
// behavior change for a site that never customized its trigger words" requirement) and overridable
// per-test for the real reported scenario: a site whose calendar module's trigger word is something
// else entirely.
function stubFetch(
  widgetLocale?: string,
  enabledModules: string[] = [],
  enabledModuleTriggerWords: Record<string, string[]> = enabledModules.includes("calendar")
    ? { calendar: ["/booking"] }
    : {},
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          token: "visitor-token",
          visitorId: "99999999-9999-9999-9999-999999999999",
          widgetPrimaryColorHex: null,
          widgetPosition: "BottomRight",
          enabledModules,
          enabledModuleTriggerWords,
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
    expect(chip.textContent).toBe("Записаться");
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

  // `25-131`'s own fails-before proof: the exact real-tenant scenario found live, a calendar module
  // whose only configured trigger word is `/записаться` - `/booking` is nowhere in that site's own
  // list. Before this item the chip always sent the hardcoded `/booking`, which `TriggerCommandMatcher`
  // (`ago-chat`) would refuse to open this module for on a real site shaped exactly like this fixture.
  it("`25-131`: sends the site's own configured trigger word, not a hardcoded /booking, when they differ", async () => {
    stubFetch(undefined, ["calendar"], { calendar: ["/записаться"] });
    const root = await mountAndOpen(config);
    await flush();

    const chip = root.querySelector<HTMLButtonElement>(".ago-module-chip")!;
    // The visible copy is unaffected by the site's own trigger word - only the invisible command
    // text changes (this item's own scope: "the chip's own visible label/ariaLabel are unaffected").
    expect(chip.textContent).toBe("Book");
    chip.click();
    await flush();

    const bubbles = [...root.querySelectorAll(".ago-message--visitor")];
    expect(bubbles.some((bubble) => bubble.textContent?.includes("/записаться"))).toBe(true);
    expect(bubbles.some((bubble) => bubble.textContent?.includes("/booking"))).toBe(false);

    const invocation = currentHub().invocationAt("SendMessageAsync", 0);
    expect(invocation.args[1]).toBe("/записаться");
  });

  // `25-131`'s own decision for the state `EnabledModule`'s own constructor (`ago-chat`) never
  // actually allows to be written (it throws on an empty trigger-word list) - a defensive re-check
  // this widget takes anyway, the same "never trust the wire value blindly" posture every other field
  // on this response already gets: treated identically to "module not enabled" rather than sending a
  // trigger word nobody configured.
  it("`25-131`: stays absent when the handshake grants calendar but carries no trigger word for it", async () => {
    stubFetch(undefined, ["calendar"], { calendar: [] });
    const root = await mountAndOpen(config);
    await flush();

    expect(root.querySelector(".ago-module-chip")).toBeNull();
    expect(loadModuleMock).not.toHaveBeenCalled();
  });

  it("`25-131`: stays absent when the handshake grants calendar but the trigger-word map has no entry for it at all", async () => {
    stubFetch(undefined, ["calendar"], {});
    const root = await mountAndOpen(config);
    await flush();

    expect(root.querySelector(".ago-module-chip")).toBeNull();
    expect(loadModuleMock).not.toHaveBeenCalled();
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
    // `25-136`/`25-146`: harmless rather than load-bearing now - `25-146` moved the contact-capture
    // gate off "the first module step, whatever kind it is" (which this `choice_list` service-choice
    // step used to be) and onto a `form` step whose own `fieldId` is `"phone"`, so a `choice_list`
    // step is no longer a candidate for it at all, known contact detail or not. This line is here
    // only for parity with this file's other wire-contract tests now. The gate itself has its own
    // dedicated describe block further down.
    localStorage.setItem(`ago-chat:${config.siteKey}:has-known-contact-detail`, "true");
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

    // `25-133`/`25-154`: the prompt shows exactly once, from the rendered primitive's own title
    // (`.ago-primitive-title`, mirroring `confirmation_card`'s title) - never a second time as the
    // operator bubble's own plain-`body` text underneath it. Before `25-154`, `choice_list`'s
    // bare-buttons rendering never read `content.prompt` at all, so `25-133`'s body-suppression left
    // this step with no text whatsoever - the real bug this item closes, not merely a duplicate.
    const operatorBubbles = [...root.querySelectorAll(".ago-message--operator")];
    expect(operatorBubbles).toHaveLength(1);
    expect(operatorBubbles[0]!.querySelector(".ago-primitive-title")?.textContent).toBe(
      "What would you like to book?",
    );
    expect(operatorBubbles[0]!.textContent?.match(/What would you like to book\?/g)).toHaveLength(1);

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

  // `25-133`: the backlog item's own named risk - `verified_phone_form`/`escalate` are real,
  // documented members of `adr/0065`'s vocabulary that `ui/primitives/render.ts`'s own `KNOWN_KINDS`
  // does not (yet) build a control for, so `renderPrimitiveContent` returns `null` for them exactly
  // as it would for a kind it has never heard of. Typing into the ordinary composer is the only way a
  // visitor can currently answer either, so the plain `body` text is not a redundant fallback here -
  // it is the whole of what the visitor sees, and must keep showing exactly as before this item.
  it.each(["verified_phone_form", "escalate"])(
    "still shows the body text bubble for a recognised-but-not-yet-built contentKind (%s)",
    async (contentKind) => {
      const root = await mountAndOpen(config);

      currentHub().push({
        id: "66666666-6666-6666-6666-666666666666",
        sequence: 2,
        authorKind: "System",
        authorId: "system",
        body: "Please confirm the phone number ending in 1234.",
        createdAt: "2026-08-29T00:00:00+00:00",
        contentKind,
        content: {},
        actions: [],
      });
      await flush();

      expect(root.querySelector(".ago-primitive")).toBeNull();
      // `.toContain`, not exact equality - this `authorKind: "System"` message with no rendered
      // primitive is indistinguishable, by this file's own detection rule, from an ordinary
      // out-of-hours auto-reply, so it also (unchanged, pre-existing behaviour) grows the
      // out-of-hours contact-capture control as a further child of the same bubble.
      const bubbles = [...root.querySelectorAll(".ago-message--auto")];
      expect(
        bubbles.some((bubble) => bubble.textContent?.includes("Please confirm the phone number ending in 1234.")),
      ).toBe(true);
    },
  );

  it("renders date_time_picker actions as buttons only - no duplicate numbered-list text bubble underneath", async () => {
    localStorage.setItem(`ago-chat:${config.siteKey}:has-known-contact-detail`, "true");
    const root = await mountAndOpen(config);

    currentHub().push({
      id: "77777777-7777-7777-7777-777777777777",
      sequence: 2,
      authorKind: "Operator",
      authorId: "op-1",
      body: "When would you like to come in?\n1) Tomorrow 10:00\n2) Tomorrow 14:00\nReply with the number.",
      createdAt: "2026-08-29T00:00:00+00:00",
      contentKind: "date_time_picker",
      content: { prompt: "When would you like to come in?" },
      actions: [
        { label: "Tomorrow 10:00", value: "slot-1" },
        { label: "Tomorrow 14:00", value: "slot-2" },
      ],
    });
    await flush();

    const choices = [...root.querySelectorAll<HTMLButtonElement>(".ago-primitive-choice")];
    expect(choices.map((choice) => choice.textContent)).toEqual(["Tomorrow 10:00", "Tomorrow 14:00"]);

    const operatorBubbles = [...root.querySelectorAll(".ago-message--operator")];
    expect(operatorBubbles).toHaveLength(1);
    expect(operatorBubbles[0]!.textContent).not.toContain("Reply with the number.");
    expect(operatorBubbles[0]!.textContent).not.toContain("1) Tomorrow 10:00");
  });

  it("a numeric-looking form field still submits as free text, not as an action click", async () => {
    // `25-136`/`25-146`: irrelevant to what this test actually checks (numeric-vs-text
    // interpretation), so a known contact detail keeps the contact-capture gate out of the way -
    // this step's own `fieldId` is `"phone"` (below), which after `25-146` would otherwise answer
    // with the rich control instead of the plain input this test exercises.
    localStorage.setItem(`ago-chat:${config.siteKey}:has-known-contact-detail`, "true");
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

/**
 * `25-146`: the contact-capture form now answers the module's own phone-collection step - a
 * `form`-kind step whose `content.fieldId === "phone"` - instead of gating whichever step happened to
 * arrive first (`25-136`'s own "gate the first step", a `choice_list`, for booking). The gate itself
 * still lives in `ui/widget.ts`'s `appendMessageBubble`, keyed on `contentKind`/`fieldId` alone now,
 * never on "is this a module step at all" - the describe block above ("rendering a step-shaped
 * message from a module") already proves an ordinary `choice_list`/`date_time_picker` step never
 * grows this control, which is this item's own first Done-when, restated here as a control against
 * the specific step the form used to glue onto.
 */
describe("answering the phone-collection step with the contact-capture form (25-146)", () => {
  function pushServiceChoiceStep(): void {
    currentHub().push({
      id: "88888888-8888-8888-8888-888888888888",
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
  }

  function pushPhoneCollectionStep(): void {
    currentHub().push({
      id: "99999999-9999-9999-9999-999999999999",
      sequence: 2,
      authorKind: "Operator",
      authorId: "op-1",
      body: "What's the best phone number to reach you on?",
      createdAt: "2026-08-29T00:00:00+00:00",
      contentKind: "form",
      content: {
        prompt: "What's the best phone number to reach you on?",
        fieldId: "phone",
        fieldLabel: "Phone number",
      },
      actions: [],
    });
  }

  it("no longer appears on a service-choice step - the step's own buttons render ungated", async () => {
    const root = await mountAndOpen(config);

    pushServiceChoiceStep();
    await flush();

    expect(root.querySelector(".ago-contact-capture-form")).toBeNull();
    const choices = [...root.querySelectorAll<HTMLButtonElement>(".ago-primitive-choice")];
    expect(choices).toHaveLength(2);
    expect(choices.every((choice) => choice.disabled)).toBe(false);

    choices[0]!.click();
    await flush();

    const invocation = currentHub().invocationAt("SendStructuredMessageAsync", 0);
    expect(invocation.args[4]).toBe("choice_list");
  });

  it("appears exactly once, as its own standalone message, when the phone-collection step arrives with no known contact detail - never the generic bare-input form", async () => {
    const root = await mountAndOpen(config);

    pushPhoneCollectionStep();
    await flush();

    // "In place of, not alongside" (this item's own words): the generic single-field form
    // `renderPrimitiveContent` would otherwise build for a `form` step never reaches the DOM at all.
    expect(root.querySelector(".ago-primitive-form")).toBeNull();
    expect(root.querySelectorAll(".ago-contact-capture-form")).toHaveLength(1);
  });

  it("submitting it records the contact detail and sends the phone number as the step's own reply", async () => {
    const root = await mountAndOpen(config);
    pushPhoneCollectionStep();
    await flush();

    const form = root.querySelector<HTMLFormElement>(".ago-contact-capture-form")!;
    form.querySelector<HTMLInputElement>('input[type="text"]')!.value = "Ivan";
    form.querySelector<HTMLInputElement>('input[type="tel"]')!.value = "+7 000 000-00-01";
    form.querySelector<HTMLInputElement>('input[type="email"]')!.value = "ivan@example.invalid";
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();

    // Recorded exactly as `25-136` already did.
    const fetchMock = vi.mocked(globalThis.fetch);
    const contactDetailCalls = fetchMock.mock.calls.filter((call) => urlOf(call[0]).includes("/contact-details"));
    const sentKinds = contactDetailCalls.map((call) => {
      const body = (call[1] as RequestInit).body;
      const parsed = JSON.parse(typeof body === "string" ? body : "") as { kind: string };
      return parsed.kind;
    });
    expect(sentKinds).toEqual(["Phone", "Name", "Email"]);

    // And the step's own reply - the identical `SendStructuredMessageAsync` shape a plain `form`
    // step's own submit already uses (the "renders choice_list..." test above proves the shape;
    // `contentKind` here is `"form"`, the kind actually being answered), with the just-submitted
    // phone number as both the wire value and the visitor's own displayed text.
    const invocation = currentHub().invocationAt("SendStructuredMessageAsync", 0);
    expect(invocation.args[1]).toBe("+7 000 000-00-01");
    expect(invocation.args[4]).toBe("form");
    expect(invocation.args[5]).toBe(JSON.stringify({ value: "+7 000 000-00-01" }));

    // `17-07`/`25-136`: the same stored-identity flag `submitContactCapture` always sets, unchanged by
    // this item's own move.
    expect(localStorage.getItem(`ago-chat:${config.siteKey}:has-known-contact-detail`)).toBe("true");
  });

  it("a form-kind step with a different fieldId still renders the plain generic input, unchanged", async () => {
    const root = await mountAndOpen(config);

    currentHub().push({
      id: "10101010-1010-1010-1010-101010101010",
      sequence: 2,
      authorKind: "Operator",
      authorId: "op-1",
      body: "What's your postcode?",
      createdAt: "2026-08-29T00:00:00+00:00",
      contentKind: "form",
      content: { prompt: "What's your postcode?", fieldId: "postcode", fieldLabel: "Postcode" },
      actions: [],
    });
    await flush();

    expect(root.querySelector(".ago-contact-capture-form")).toBeNull();
    expect(root.querySelector(".ago-primitive-form-input")).not.toBeNull();
  });

  it("a visitor with a known contact detail never sees the rich control, even if the step arrives anyway", async () => {
    // `25-146`'s own note: in the common configuration `ago-calendar` already skips sending this step
    // once a contact detail is known, so this test simulates it arriving anyway - the widget's own
    // defensive check, independent of that server-side skip.
    localStorage.setItem(`ago-chat:${config.siteKey}:has-known-contact-detail`, "true");
    const root = await mountAndOpen(config);

    pushPhoneCollectionStep();
    await flush();

    expect(root.querySelector(".ago-contact-capture-form")).toBeNull();
    // Falls through to the ordinary generic form, ungated - never stranding the visitor with nothing
    // to answer the step with.
    expect(root.querySelector(".ago-primitive-form-input")).not.toBeNull();
  });
});
