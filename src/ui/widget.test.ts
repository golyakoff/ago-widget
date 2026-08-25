import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageDto, VisitorJoinResult } from "../protocol/types.js";
import type { WidgetConfig } from "../config.js";
import { currentHub, joinQueue, resetFakeSignalR } from "../testing/fakeSignalR.js";

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
  isPublicDemo: false,
};

function message(id: string, sequence: number, authorKind: "Visitor" | "Operator" = "Operator"): MessageDto {
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
