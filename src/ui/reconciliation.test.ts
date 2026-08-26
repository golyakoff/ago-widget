import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageDto, VisitorJoinResult } from "../protocol/types.js";
import type { WidgetConfig } from "../config.js";
import { HubConnectionState, currentHub, joinQueue, resetFakeSignalR } from "../testing/fakeSignalR.js";

/**
 * `5-17`: which optimistic bubble an echo belongs to.
 *
 * A separate file from `widget.test.ts` on purpose. That one covers the panel as a visitor
 * experiences it - the composer, the connection states, what is on screen while the socket is gone.
 * This one covers a single invariant underneath all of that: **an echo resolves the bubble for its
 * own `clientMessageId` and no other**. It was previously resolved by queue position, which held
 * only while every send succeeded; `11-08` found the failure by driving the panel through an
 * ordinary drop-send-reconnect sequence and watching it end up showing `["second", "second"]`.
 *
 * Every test here fails against the pre-`5-17` code. Each one is a sequence a visitor can actually
 * produce, driven through the panel's own DOM rather than by calling private methods, so what is
 * asserted is what a person would see.
 */
vi.mock("@microsoft/signalr", () => import("../testing/fakeSignalR.js"));

const { ChatWidget } = await import("./widget.js");

const CONVERSATION_ID = "77777777-7777-7777-7777-777777777777";
const VISITOR_ID = "99999999-9999-9999-9999-999999999999";

const config: WidgetConfig = {
  siteKey: "shop_test",
  apiBaseUrl: "https://api.test.invalid",
  demoNotice: "none",
  booking: null,
};

/** The server's own copy of a message coming back over the connection. `clientMessageId` is what
 * `VisitorHub` puts on every delivery of a visitor's message - the local echo, the fan-out copy and
 * the resume delta a reconnect replays all carry it (`Ago.Chat.Contracts.MessageDto`). */
function echo(id: string, sequence: number, body: string, clientMessageId: string | null): MessageDto {
  return {
    id,
    sequence,
    authorKind: "Visitor",
    authorId: VISITOR_ID,
    body,
    createdAt: "2026-08-25T09:00:00+00:00",
    clientMessageId,
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
  input: HTMLTextAreaElement;
  bubbleTexts: () => string[];
}

/** Deliberately a local copy of `widget.test.ts`'s own panel helpers rather than something both
 * files import: this file was added by a different change than that one, and lifting them into a
 * shared module means editing a file that is not this change's to edit. Worth consolidating the
 * next time either file is opened for its own reasons. */
function panelOf(root: ShadowRoot): Panel {
  const input = root.querySelector<HTMLTextAreaElement>(".ago-input");
  if (input === null) {
    throw new Error("the widget has no .ago-input");
  }

  return {
    input,
    bubbleTexts: () => [...root.querySelectorAll(".ago-message")].map((bubble) => bubble.textContent ?? ""),
  };
}

async function openWidget(): Promise<Panel> {
  const widget = new ChatWidget(config);
  widget.mount(document.body);
  await flush();

  const host = document.querySelector("[data-ago-chat-widget]");
  if (host?.shadowRoot == null) {
    throw new Error("the widget did not mount");
  }

  const toggle = host.shadowRoot.querySelector<HTMLButtonElement>(".ago-toggle");
  toggle?.click();
  await flush();
  return panelOf(host.shadowRoot);
}

/** Types `body` into the composer and presses Enter, which is the only send path a visitor has. */
async function send(panel: Panel, body: string): Promise<void> {
  panel.input.value = body;
  panel.input.dispatchEvent(new Event("input", { bubbles: true }));
  panel.input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", shiftKey: false, bubbles: true, cancelable: true }),
  );
  await flush();
}

/** The `clientMessageId` the widget generated for the `index`-th `SendMessageAsync` that reached the
 * hub - the 4th positional argument (`5-12`). A send that failed before invoking is not one of
 * these, which is the point: there is no id on the wire for a message the server never saw. */
function sentClientMessageId(index: number): string {
  const id = currentHub().invocationAt("SendMessageAsync", index).args[3];
  if (typeof id !== "string") {
    throw new Error(`SendMessageAsync #${index} carried no clientMessageId`);
  }

  return id;
}

/** A send that reaches the hub and is rejected while the socket goes away underneath it -
 * `VisitorConnection` turns exactly this into `SendOutcomeUnknownError`. */
function failNextSendWithUnknownOutcome(): void {
  currentHub().failNextSend = {
    error: new Error("connection closed mid-invoke"),
    leavingState: HubConnectionState.Reconnecting,
  };
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
            visitorId: VISITOR_ID,
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

describe("pairing an echo with the bubble it belongs to", () => {
  it("keeps the notice on a send that never left, and renders the next message exactly once", async () => {
    // The exact sequence `11-08` reproduced. Before `5-17` the panel ended holding
    // `["second", "second"]`: the failed send's entry stayed in the queue, so "second"'s echo
    // removed the failure notice instead of its own optimistic bubble.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    joinQueue.push(joinResult([]));
    const panel = await openWidget();

    currentHub().dropToReconnecting();
    await flush();
    await send(panel, "first");
    expect(panel.bubbleTexts().join(" ")).toContain("Not sent - reconnecting.");

    joinQueue.push(joinResult([]));
    currentHub().completeReconnect();
    await flush();

    await send(panel, "second");
    currentHub().push(echo("e1", 1, "second", sentClientMessageId(0)));
    await flush();

    expect(panel.bubbleTexts()).toEqual([
      "firstNot sent - reconnecting. It will not be retried automatically.",
      "second",
    ]);
    expect(logged).toHaveBeenCalled();
  });

  it("resolves each send's own bubble when the echoes arrive out of order", async () => {
    joinQueue.push(joinResult([]));
    const panel = await openWidget();

    await send(panel, "alpha");
    await send(panel, "beta");
    expect(panel.bubbleTexts()).toEqual(["alpha", "beta"]);

    // Nothing guarantees the sender's own two echoes come back in send order - realtime.md only
    // promises ordering by `sequence` per conversation, and the widget's local echo and the
    // broker's fan-out copy are two different deliveries of the same message.
    currentHub().push(echo("e-beta", 2, "beta", sentClientMessageId(1)));
    await flush();
    expect(panel.bubbleTexts()).toEqual(["alpha", "beta"]);

    currentHub().push(echo("e-alpha", 1, "alpha", sentClientMessageId(0)));
    await flush();

    // Each body appears once. DOM order follows arrival, since an echo is appended at the end -
    // `Thread`-style re-sorting by `sequence` is the console's job, not this panel's.
    expect(panel.bubbleTexts()).toEqual(["beta", "alpha"]);
  });

  it("treats a visitor message it did not send as a new message, not as somebody's echo", async () => {
    joinQueue.push(joinResult([]));
    const panel = await openWidget();

    await send(panel, "from this tab");

    // The same visitor typing in a second tab, and any message predating `clientMessageId`
    // (`5-07` did not back-fill), both arrive as a visitor DTO this panel has no pending entry for.
    currentHub().push(echo("other-tab", 3, "from another tab", "11111111-1111-1111-1111-111111111111"));
    currentHub().push(echo("legacy", 4, "sent before clientMessageId existed", null));
    await flush();

    expect(panel.bubbleTexts()).toEqual(["from this tab", "from another tab", "sent before clientMessageId existed"]);
  });

  it("holds an unconfirmed send's warning until the server's own copy of that message arrives", async () => {
    // `SendOutcomeUnknownError`: the invoke was in flight when the socket went, so nobody knows
    // whether it landed. The entry is kept rather than dropped precisely so this can be resolved by
    // evidence - and no other message's echo may resolve it in the meantime.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    joinQueue.push(joinResult([]));
    const panel = await openWidget();

    failNextSendWithUnknownOutcome();
    await send(panel, "unconfirmed");
    expect(panel.bubbleTexts().join(" ")).toContain("Not sure this was sent");
    expect(logged).toHaveBeenCalled();

    joinQueue.push(joinResult([]));
    currentHub().completeReconnect();
    await flush();

    await send(panel, "later");
    currentHub().push(echo("e-later", 6, "later", sentClientMessageId(1)));
    await flush();

    // The unrelated echo resolved its own bubble and left the warning where it was.
    expect(panel.bubbleTexts()).toEqual([
      "unconfirmedNot sure this was sent - the connection dropped mid-request.",
      "later",
    ]);

    // It had landed after all, and comes back with the id the widget sent it under - the one case
    // where removing the warning is a fact rather than a guess.
    currentHub().push(echo("e-unconfirmed", 5, "unconfirmed", sentClientMessageId(0)));
    await flush();

    expect(panel.bubbleTexts()).toEqual(["later", "unconfirmed"]);
  });
});
