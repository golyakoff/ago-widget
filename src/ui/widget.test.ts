import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageDto, VisitorJoinResult } from "../protocol/types.js";
import type { WidgetConfig } from "../config.js";
import { currentHub, joinQueue, resetFakeSignalR } from "../testing/fakeSignalR.js";
import { en } from "../i18n/en.js";

/**
 * `11-08`: the visitor-facing half of reconnect and resume - what a person looking at the panel sees
 * while the connection is gone and after it comes back. `connection.test.ts` covers the protocol
 * underneath this; the two are complements, and the split matters because the defect class here is a
 * different one: a protocol that resumes correctly behind a composer that stays disabled, or a resume
 * delta that renders twice, are both invisible to a `VisitorConnection` test.
 *
 * The panel is driven through its own DOM - a click on the launcher, typing into the textarea,
 * pressing Enter - rather than by calling private methods, because "the visitor can send again once
 * it reconnects" is a statement about the controls, not about the class.
 */
vi.mock("@microsoft/signalr", () => import("../testing/fakeSignalR.js"));

const { ChatWidget } = await import("./widget.js");

const CONVERSATION_ID = "77777777-7777-7777-7777-777777777777";

const config: WidgetConfig = {
  siteKey: "shop_test",
  apiBaseUrl: "https://api.test.invalid",
  demoNotice: "none",
  bookingModuleEnabled: false,
  scriptUrl: "https://cdn.test.invalid/dist/widget.js",
};

function message(id: string, sequence: number, authorKind: MessageDto["authorKind"] = "Operator"): MessageDto {
  return {
    id,
    sequence,
    authorKind,
    authorId: "88888888-8888-8888-8888-888888888888",
    body: `message ${id}`,
    createdAt: "2026-08-25T09:00:00+00:00",
  };
}

function joinResult(history: MessageDto[]): VisitorJoinResult {
  return { conversationId: CONVERSATION_ID, isNew: false, history };
}

/** Drains the microtask queue the fakes' own resolved promises sit on. No timers are involved in
 * this file, so there is nothing to advance - only pending `.then` callbacks to run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

interface Panel {
  root: ShadowRoot;
  toggle: HTMLButtonElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  status: HTMLDivElement;
  bubbleTexts: () => string[];
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
    bubbleTexts: () => [...root.querySelectorAll(".ago-message")].map((bubble) => bubble.textContent ?? ""),
  };
}

/** Mounts the widget and opens it, which is what builds the connection (`5-09`'s lazy-on-first-open
 * rule). Any `JoinAsync` answers must be queued before this returns to the hub. */
async function openWidget(): Promise<Panel> {
  const widget = new ChatWidget(config);
  widget.mount(document.body);
  await flush();

  const host = document.querySelector("[data-ago-chat-widget]");
  if (host?.shadowRoot == null) {
    throw new Error("the widget did not mount");
  }

  const panel = panelOf(host.shadowRoot);
  panel.toggle.click();
  await flush();
  return panel;
}

function type(panel: Panel, body: string): void {
  panel.input.value = body;
  panel.input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressEnter(panel: Panel, options: { shiftKey?: boolean } = {}): void {
  panel.input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", shiftKey: options.shiftKey ?? false, bubbles: true, cancelable: true }),
  );
}

beforeEach(() => {
  resetFakeSignalR();
  document.body.innerHTML = "";
  localStorage.clear();

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
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the panel while the connection is gone and after it returns", () => {
  it("stops the visitor typing into a dead socket and lets them type again once it resumes", async () => {
    joinQueue.push(joinResult([]));
    const panel = await openWidget();
    expect(panel.input.disabled).toBe(false);

    currentHub().dropToReconnecting();
    await flush();
    expect(panel.input.disabled).toBe(true);
    expect(panel.send.disabled).toBe(true);
    expect(panel.status.textContent).toBe("Reconnecting…");

    joinQueue.push(joinResult([]));
    currentHub().completeReconnect();
    await flush();

    expect(panel.input.disabled).toBe(false);
    expect(panel.status.textContent).toBe("");
  });

  it("shows what arrived during the gap, once each", async () => {
    joinQueue.push(joinResult([message("m1", 11)]));
    const panel = await openWidget();
    expect(panel.bubbleTexts()).toEqual(["message m1"]);

    // The resume delta overlaps what was already on screen, which is what a cursor written from #11
    // will always produce.
    joinQueue.push(joinResult([message("m1", 11), message("m2", 12), message("m3", 13)]));
    currentHub().dropToReconnecting();
    currentHub().completeReconnect();
    await flush();

    expect(panel.bubbleTexts()).toEqual(["message m1", "message m2", "message m3"]);
  });

  it("tells the visitor a message was not sent rather than dropping it silently", async () => {
    // The widget logs the refusal as well as showing it (`errors.ts` - console.error only, never a
    // throw into the host page). Asserted rather than merely silenced, so the log is part of the
    // contract instead of noise this test happens to produce.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    joinQueue.push(joinResult([]));
    const panel = await openWidget();

    currentHub().dropToReconnecting();
    await flush();

    // The visitor was mid-sentence when the socket went; the composer is disabled now, but the send
    // path must still be honest about the message they had already committed to.
    type(panel, "are you still there?");
    pressEnter(panel);
    await flush();

    expect(panel.bubbleTexts().join(" ")).toContain("are you still there?");
    expect(panel.bubbleTexts().join(" ")).toContain("Not sent - reconnecting.");
    expect(logged).toHaveBeenCalled();
  });

  /**
   * The defect found while writing the test above - one failed send desynchronising every optimistic
   * bubble after it - was fixed by `5-17`, which pairs an echo with its bubble by `clientMessageId`
   * instead of by queue position. `ui/reconciliation.test.ts` is where that pairing is covered, in
   * the sequences that distinguish it from the old positional behaviour.
   *
   * What is left here is the plain case: the sender's own message coming back once, not rendered
   * twice. `5-17` changed the fixture it needs - the echo now has to carry the id the widget sent
   * the message under, because that is what matches it, and it is what the real `VisitorHub` puts on
   * every delivery. Before that fix this test passed with the id omitted, which is precisely the
   * hole: nothing compared the id to anything.
   */
  it("does not re-render the visitor's own message when the server echoes it back", async () => {
    joinQueue.push(joinResult([]));
    const panel = await openWidget();

    type(panel, "hello");
    pressEnter(panel);
    await flush();
    expect(panel.bubbleTexts()).toEqual(["hello"]);

    // realtime.md's fan-out path: the sender's own connection receives its message again.
    const clientMessageId = currentHub().invocationAt("SendMessageAsync", 0).args[3] as string;
    currentHub().push({ ...message("echo", 5, "Visitor"), body: "hello", clientMessageId });
    await flush();

    expect(panel.bubbleTexts()).toEqual(["hello"]);
  });
});

/**
 * `23-53`: "the visitor sees an empty thread while the operator sees the whole conversation".
 * `connection.test.ts` proves the connection layer asks for the right thing on a fresh page load;
 * this proves the *panel* actually renders what comes back, in the order a person wrote it.
 */
describe("reopening the widget on a fresh page load", () => {
  it("renders the visitor's own history in the order it was written, oldest first", async () => {
    // `GetHistoryAsync`'s own "most recent page" shape is newest-first
    // (`IConversationReadStore.GetHistoryAsync`'s own remarks) - the fixture lists it that way, the
    // same order the real server sends. Fails before this item's own fix: `connect()` used to append
    // `joinResult.history` in array order verbatim, which nothing had ever exercised with more than
    // one message before (the conversation this call resolves was always brand new until `23-53`'s
    // own fix to `connection.ts` made a returning visitor's real history reach this loop at all) - so
    // reversing it here is what keeps that first-ever real exercise from rendering upside down.
    joinQueue.push(
      joinResult([message("m3", 3, "Operator"), message("m2", 2, "Visitor"), message("m1", 1, "Visitor")]),
    );
    const panel = await openWidget();

    expect(panel.bubbleTexts()).toEqual(["message m1", "message m2", "message m3"]);
  });
});

/**
 * `14-04`: the offline auto-reply, seen from the visitor's side. It arrives as an ordinary message
 * with `authorKind: "System"` - there is no separate transport, which is the point of authoring it as
 * a message at all - and the only thing this side has to get right is not passing it off as a person.
 */
describe("an automatic reply", () => {
  it("renders on the incoming side, labelled, with the reply itself as the bubble's text", async () => {
    // `23-53`: `joinResult.history` is `GetHistoryAsync`'s "most recent page" shape - newest first
    // (`IConversationReadStore.GetHistoryAsync`'s own remarks) - so the fixture is listed newest to
    // oldest, the same order the real server returns; `connect()`'s own reversal is what puts m1
    // before m2 on screen.
    joinQueue.push(joinResult([message("m2", 2, "System"), message("m1", 1, "Visitor")]));
    const panel = await openWidget();

    const bubbles = [...panel.root.querySelectorAll(".ago-message")];
    expect(bubbles.map((b) => b.className)).toEqual([
      "ago-message ago-message--visitor",
      "ago-message ago-message--auto",
    ]);
    // Not `.ago-message--system`, which is this widget's own local status note - see renderBubble.
    expect(panel.root.querySelectorAll(".ago-message--system")).toHaveLength(0);
    // The label is CSS `content`, never a DOM text node - `renderBubble`'s own `bubble.textContent =
    // body` line still writes exactly what the shop scripted and nothing else, proven here against
    // the bubble's own direct text rather than `bubbleTexts()`'s full `textContent`, which now also
    // picks up `23-09`'s contact-capture control appended as a child (see the next test).
    expect(bubbles[1]!.firstChild?.textContent).toBe("message m2");
  });

  it("23-09: offers the out-of-hours contact control under the auto-reply bubble, exactly once", async () => {
    // `23-53`: newest first, matching the real server's own "most recent page" order - see the
    // previous test's own comment.
    joinQueue.push(joinResult([message("m3", 3, "System"), message("m2", 2, "System"), message("m1", 1, "Visitor")]));
    const panel = await openWidget();
    // `24-05`: the control is now appended after an async round trip (getConsentRequirement) rather
    // than synchronously - a second flush lets that promise chain (currentToken -> fetch -> .json())
    // settle before this test looks at the DOM.
    await flush();

    // Two System messages arrive (a contrived case for this test - production never produces a
    // second one, this class's own `contactCaptureShown` remarks), and the control still appears
    // only once, under the first bubble it was attached to.
    expect(panel.root.querySelectorAll(".ago-contact-capture")).toHaveLength(1);
    const bubbles = [...panel.root.querySelectorAll(".ago-message")];
    expect(bubbles[1]!.querySelector(".ago-contact-capture")).not.toBeNull();
    expect(bubbles[2]!.querySelector(".ago-contact-capture")).toBeNull();
    // `23-58`: the online link this test's own first (Visitor) message would otherwise have earned
    // is not left dangling beside the out-of-hours form that superseded it - one control, not two.
    expect(panel.root.querySelectorAll(".ago-contact-capture-intro-link")).toHaveLength(0);
  });
});

/**
 * `23-58`: a visitor writing while an operator is online - no `System` auto-reply ever arrives, which
 * before this item meant no contact control of any kind. The fixture in every test below is exactly
 * that: one `Visitor` message, nothing else, forever - `SendOfflineAutoReplyHandler` simply never
 * fires for an online site, and the widget has no way to be told that other than a `System` message's
 * absence.
 */
describe("23-58: the online entry point", () => {
  function introLink(root: ShadowRoot): HTMLButtonElement {
    const link = root.querySelector<HTMLButtonElement>(".ago-contact-capture-intro-link");
    if (link === null) {
      throw new Error("no intro link");
    }

    return link;
  }

  function requiredFieldsOf(root: ParentNode): { name: HTMLInputElement; phone: HTMLInputElement; email: HTMLInputElement } {
    const name = root.querySelector<HTMLInputElement>('input[type="text"]');
    const phone = root.querySelector<HTMLInputElement>('input[type="tel"]');
    const email = root.querySelector<HTMLInputElement>('input[type="email"]');
    if (name === null || phone === null || email === null) {
      throw new Error("the contact form is missing one of its three fields");
    }

    return { name, phone, email };
  }

  it("offers «Представиться…» under the visitor's own first message, and nothing else", async () => {
    joinQueue.push(joinResult([message("m1", 1, "Visitor")]));
    const panel = await openWidget();
    await flush();

    const link = introLink(panel.root);
    expect(link.textContent).toBe(en.contactCaptureIntroLink);
    expect(link.type).toBe("button");
    // Not rendered yet - only the link is, until it is clicked (unlike the out-of-hours path, which
    // renders the form itself directly).
    expect(panel.root.querySelectorAll(".ago-contact-capture")).toHaveLength(0);
  });

  it("does not grow a second link under a later visitor message", async () => {
    joinQueue.push(joinResult([message("m1", 1, "Visitor")]));
    const panel = await openWidget();
    await flush();
    expect(panel.root.querySelectorAll(".ago-contact-capture-intro-link")).toHaveLength(1);

    currentHub().push(message("m2", 2, "Visitor"));
    await flush();

    expect(panel.root.querySelectorAll(".ago-contact-capture-intro-link")).toHaveLength(1);
  });

  it("clicking the link opens the identical three-field, all-required form the out-of-hours path opens", async () => {
    joinQueue.push(joinResult([message("m1", 1, "Visitor")]));
    const panel = await openWidget();
    await flush();

    introLink(panel.root).click();
    await flush();
    await flush();

    expect(panel.root.querySelectorAll(".ago-contact-capture-intro-link")).toHaveLength(0);
    const forms = panel.root.querySelectorAll(".ago-contact-capture");
    expect(forms).toHaveLength(1);
    const { name, phone, email } = requiredFieldsOf(forms[0]!);
    expect(name.required).toBe(true);
    expect(phone.required).toBe(true);
    expect(email.required).toBe(true);
  });

  it("the control disappears once a contact has been left, and does not come back in that conversation", async () => {
    joinQueue.push(joinResult([message("m1", 1, "Visitor")]));
    const panel = await openWidget();
    await flush();

    introLink(panel.root).click();
    await flush();
    await flush();

    const { name, phone, email } = requiredFieldsOf(panel.root.querySelector(".ago-contact-capture")!);
    name.value = "Ivan";
    phone.value = "+7 000 000-00-01";
    email.value = "ivan@example.invalid";
    panel.root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    await flush();
    await flush();

    expect(panel.root.textContent).toContain(en.contactCaptureConfirmation);
    expect(panel.root.querySelectorAll(".ago-contact-capture-intro-link")).toHaveLength(0);
    expect(panel.root.querySelectorAll("form.ago-contact-capture-form")).toHaveLength(0);

    // A further visitor message must not resurrect the link - `visitorIntroControlOffered` fires
    // once, for the *first* message, and `contactCaptureShown` is now true besides.
    currentHub().push(message("m2", 2, "Visitor"));
    await flush();
    expect(panel.root.querySelectorAll(".ago-contact-capture-intro-link")).toHaveLength(0);
  });

  it("both entry points render the identical set of three required fields", async () => {
    // Online: the link, clicked.
    joinQueue.push(joinResult([message("m1", 1, "Visitor")]));
    const onlinePanel = await openWidget();
    await flush();
    introLink(onlinePanel.root).click();
    await flush();
    await flush();
    const online = requiredFieldsOf(onlinePanel.root.querySelector(".ago-contact-capture")!);

    // A second, independent mount - `openWidget` finds its host via the same
    // `[data-ago-chat-widget]` selector every other test in this file uses, so the first widget's
    // markup has to be gone before this one looks for it (`beforeEach`'s own `document.body.innerHTML
    // = ""` does the identical thing between tests; this is the same reset, mid-test, on purpose).
    document.body.innerHTML = "";

    // Out of hours: the System auto-reply, unclicked - the form renders itself.
    joinQueue.push(joinResult([message("m2", 2, "System"), message("m1", 1, "Visitor")]));
    const offlinePanel = await openWidget();
    await flush();
    const offline = requiredFieldsOf(offlinePanel.root.querySelector(".ago-contact-capture")!);

    for (const pair of [
      [online.name, offline.name],
      [online.phone, offline.phone],
      [online.email, offline.email],
    ] as const) {
      expect(pair[0].type).toBe(pair[1].type);
      expect(pair[0].required).toBe(true);
      expect(pair[1].required).toBe(true);
    }
  });
});

describe("the panel's composer", () => {
  it("sends on Enter", async () => {
    joinQueue.push(joinResult([]));
    const panel = await openWidget();

    type(panel, "hello");
    pressEnter(panel);
    await flush();

    expect(currentHub().invocationsOf("SendMessageAsync")).toHaveLength(1);
    expect(currentHub().invocationAt("SendMessageAsync", 0).args[1]).toBe("hello");
    expect(panel.input.value).toBe("");
  });

  it("starts a new line on Shift+Enter instead", async () => {
    joinQueue.push(joinResult([]));
    const panel = await openWidget();

    type(panel, "first line");
    pressEnter(panel, { shiftKey: true });
    await flush();

    expect(currentHub().invocationsOf("SendMessageAsync")).toHaveLength(0);
    expect(panel.input.value).toBe("first line");
  });

  it("refuses to send a draft that is only whitespace", async () => {
    joinQueue.push(joinResult([]));
    const panel = await openWidget();

    type(panel, "   ");
    expect(panel.send.disabled).toBe(true);
    pressEnter(panel);
    await flush();

    expect(currentHub().invocationsOf("SendMessageAsync")).toHaveLength(0);
  });
});

/**
 * `8-11`: which sentence the panel renders, and the fact that it renders none by default.
 *
 * Mounted rather than opened - the notice is built in the constructor and sits above `.ago-messages`,
 * so it exists before anything connects and none of these need a hub.
 */
describe("the panel's demo notice", () => {
  function noticeFor(demoNotice: WidgetConfig["demoNotice"]): string | null {
    const widget = new ChatWidget({ ...config, demoNotice });
    widget.mount(document.body);

    const host = document.querySelector("[data-ago-chat-widget]");
    const notice = host?.shadowRoot?.querySelector(".ago-notice");
    return notice === null || notice === undefined ? null : (notice.textContent ?? "");
  }

  // 8-06, unchanged and unweakened. This item made the warning conditional, never softer.
  it("renders 8-06's warning word for word on a public demo tenant", () => {
    expect(noticeFor("public")).toBe(
      "This is a public demo. Anyone who opens the demo operator console can read what you type here. "
      + "Do not type anything real.",
    );
  });

  /**
   * The answer to `8-11`'s open question: the widget says something rather than nothing. `8-06`
   * argued the warning belongs where the typing happens because the launcher floats over every
   * scroll position; the reassurance belongs there for the same reason, and the tenant's lifetime is
   * stated nowhere else in the widget.
   */
  it("renders the private counterpart on a minted tenant, and claims no more than is enforced", () => {
    const notice = noticeFor("private") ?? "";

    expect(notice).toContain("your own demo tenant");
    expect(notice).toContain("deletes itself after about a day");

    // Precise, not generous: the visitor holds a link and a password and can pass either on, so the
    // claim is scoped to the login rather than to "nobody", which is where 8-09's panel over-claims.
    expect(notice).toContain("Only the operator login you were given");
    expect(notice).not.toContain("Nobody else");

    // The thing this item exists to delete from a private tenant.
    expect(notice).not.toContain("public demo");
    expect(notice).not.toContain("Do not type anything real");
  });

  // The default, and the one that matters most: a real shop's widget must never mention a demo.
  it("renders no notice at all for an ordinary embed", () => {
    expect(noticeFor("none")).toBeNull();
  });
});

/**
 * `16-04`: the tenant's own processing notice - who processes what a visitor is about to write, and
 * a link to read more. Unlike the demo notice above, this one is server/handshake-driven, not
 * config-time, so every test here stubs the handshake response and mounts (not opens) the widget -
 * proving the notice is present as soon as the panel exists, before the visitor has typed anything
 * and without ever needing a connection or an open panel.
 */
describe("the panel's processing notice", () => {
  function stubHandshake(overrides: Record<string, unknown> = {}): void {
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
              widgetNoticeText: null,
              widgetNoticeUrl: null,
              ...overrides,
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          ),
        ),
      ),
    );
  }

  async function mountAndWait(): Promise<ShadowRoot> {
    const widget = new ChatWidget(config);
    widget.mount(document.body);
    await flush();

    const host = document.querySelector("[data-ago-chat-widget]");
    if (host?.shadowRoot == null) {
      throw new Error("the widget did not mount");
    }

    return host.shadowRoot;
  }

  it("renders the tenant's notice text before any message is typed, with no open panel and no connection", async () => {
    stubHandshake({ widgetNoticeText: "We use your messages to answer your questions." });

    const root = await mountAndWait();

    const notice = root.querySelector<HTMLDivElement>(".ago-processing-notice");
    expect(notice?.textContent).toContain("We use your messages to answer your questions.");
    // Never opened, never typed into, never connected (no HubConnection exists at all yet - the
    // widget only builds one on first open, `5-09`'s lazy-on-first-open rule) - the notice does not
    // depend on any of that.
    expect(root.querySelector<HTMLDivElement>(".ago-panel")?.hidden).toBe(true);
    expect(root.querySelector<HTMLTextAreaElement>(".ago-input")?.disabled).toBe(true);
  });

  it("renders the notice link with an href, opened in a new context, never following the host page", async () => {
    stubHandshake({
      widgetNoticeText: "We read what you send us.",
      widgetNoticeUrl: "https://tenant.example/privacy",
    });

    const root = await mountAndWait();

    const link = root.querySelector<HTMLAnchorElement>(".ago-processing-notice__link");
    if (link === null) {
      throw new Error("no notice link rendered");
    }
    expect(link.getAttribute("href")).toBe("https://tenant.example/privacy");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders text with no link when only the text is configured", async () => {
    stubHandshake({ widgetNoticeText: "We read what you send us." });

    const root = await mountAndWait();

    expect(root.querySelector<HTMLDivElement>(".ago-processing-notice")?.hidden).toBe(false);
    expect(root.querySelector(".ago-processing-notice__link")).toBeNull();
  });

  it("renders a link with no text when only the link is configured", async () => {
    stubHandshake({ widgetNoticeUrl: "https://tenant.example/privacy" });

    const root = await mountAndWait();

    expect(root.querySelector<HTMLDivElement>(".ago-processing-notice")?.hidden).toBe(false);
    expect(root.querySelector(".ago-processing-notice__text")).toBeNull();
    expect(root.querySelector(".ago-processing-notice__link")).not.toBeNull();
  });

  // The default, and the one that matters most: every site that predates this item, and every tenant
  // who deliberately leaves both fields empty, gets no notice - never an AGO-authored placeholder.
  it("shows nothing when neither field is configured", async () => {
    stubHandshake();

    const root = await mountAndWait();

    expect(root.querySelector<HTMLDivElement>(".ago-processing-notice")?.hidden).toBe(true);
    expect(root.querySelector<HTMLDivElement>(".ago-processing-notice")?.textContent).toBe("");
  });

  // 16-04's own Scope: text is text, escaped, never HTML. A value containing markup-shaped characters
  // must render as literal text, not be interpreted - proven the same way `attachments.ts`/`renderBubble`
  // are already trusted, by asserting textContent (which never parses markup) rather than innerHTML.
  it("renders notice text containing markup-shaped characters as literal text, never as HTML", async () => {
    const dangerous = '<img src=x onerror=alert(1)> & "quotes" & <b>bold</b>';
    stubHandshake({ widgetNoticeText: dangerous });

    const root = await mountAndWait();

    const textNode = root.querySelector(".ago-processing-notice__text");
    expect(textNode?.textContent).toBe(dangerous);
    expect(textNode?.querySelector("img")).toBeNull();
    expect(textNode?.querySelector("b")).toBeNull();
    expect(root.querySelector<HTMLDivElement>(".ago-processing-notice")?.innerHTML).not.toContain("<img");
  });

  // A malformed URL from the wire (never trusted blindly, even though the server already validates
  // it) must never become an href - falls back to "no link", the same posture every other field in
  // ui/appearance.ts already takes, and never throws on the host page.
  it("falls back to no link for a non-https URL, without dropping the text", async () => {
    stubHandshake({
      widgetNoticeText: "We read what you send us.",
      widgetNoticeUrl: "javascript:alert(1)",
    });

    const root = await mountAndWait();

    expect(root.querySelector(".ago-processing-notice__text")?.textContent).toBe("We read what you send us.");
    expect(root.querySelector(".ago-processing-notice__link")).toBeNull();
  });

  it("renders the link text in the resolved locale", async () => {
    stubHandshake({
      widgetLocale: "Ru",
      widgetNoticeText: "Мы читаем то, что вы нам присылаете.",
      widgetNoticeUrl: "https://tenant.example/privacy",
    });

    const root = await mountAndWait();

    expect(root.querySelector(".ago-processing-notice__link")?.textContent).toBe("Подробнее");
  });
});

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

interface BeaconBody {
  publicKey: string;
  kind: string;
}

function beaconBodiesSent(): BeaconBody[] {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([url]) => urlOf(url).endsWith("/api/v1/widget-activity"))
    .map(([, init]) => JSON.parse(init?.body as string) as BeaconBody);
}

/**
 * `23-07`: the funnel's own beacon, sent from `mount`/`open` - `sendBeacon` itself is tested in
 * isolation (`beacon.test.ts`); this describes the two call sites' own behaviour, which a pure
 * function test cannot reach.
 */
describe("the funnel beacon", () => {
  it("fires a load beacon from mount, independently of the session bootstrap", async () => {
    const widget = new ChatWidget(config);
    widget.mount(document.body);
    await flush();

    const bodies = beaconBodiesSent();
    expect(bodies).toEqual([{ publicKey: config.siteKey, kind: "load" }]);
  });

  it("fires an open beacon the first time the panel opens", async () => {
    joinQueue.push(joinResult([]));
    await openWidget();

    expect(beaconBodiesSent().filter((body) => body.kind === "open")).toHaveLength(1);
  });

  /** The item's own Done-when: "Opening the panel twice in one session counts one open." */
  it("does not fire a second open beacon when the panel is closed and reopened", async () => {
    joinQueue.push(joinResult([]));
    const panel = await openWidget();

    panel.toggle.click(); // close
    await flush();
    panel.toggle.click(); // open again
    await flush();

    expect(beaconBodiesSent().filter((body) => body.kind === "open")).toHaveLength(1);
  });
});
