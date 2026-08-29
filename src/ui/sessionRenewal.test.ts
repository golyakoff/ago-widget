import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageDto, VisitorJoinResult } from "../protocol/types.js";
import type { WidgetConfig } from "../config.js";
import { WidgetStorage } from "../storage.js";
import { currentHub, joinQueue, resetFakeSignalR } from "../testing/fakeSignalR.js";
import { fakeJwt } from "../testing/fakeJwt.js";

/**
 * `17-07`, `testing.md`'s "Component / behaviour" level: what a *visitor* experiences as their token
 * ages out from under them. `session.test.ts` covers the renewal rules themselves; this file covers
 * the three things only the panel can answer - what the next negotiate would carry, what the visitor
 * is told when their session cannot be carried over, and what happens to the conversation cursor.
 *
 * A separate file from `widget.test.ts` for the same reason `reconciliation.test.ts` is
 * (`5-17`): every test here needs the system clock under the test's control and a stored session
 * planted before the widget is constructed, and threading that through a file whose whole point is
 * "no timers are involved" would make both files harder to read.
 *
 * **Time is set, never waited on.** `vi.setSystemTime` moves the clock in days, so "the token
 * expired while this page was open" is asserted rather than approximated - a test that passed only
 * because it ran fast would say nothing about the case this item exists for.
 */
vi.mock("@microsoft/signalr", () => import("../testing/fakeSignalR.js"));

const { ChatWidget } = await import("./widget.js");

const SITE_KEY = "shop_test";
const CONVERSATION_ID = "77777777-7777-7777-7777-777777777777";
const VISITOR_ID = "99999999-9999-9999-9999-999999999999";
const NEW_VISITOR_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DAY_MS = 24 * 60 * 60 * 1000;
const LIFETIME_MS = 7 * DAY_MS;
const T0 = Date.UTC(2026, 7, 25, 9, 0, 0);

const config: WidgetConfig = {
  siteKey: SITE_KEY,
  apiBaseUrl: "https://api.test.invalid",
  demoNotice: "none",
  bookingModuleEnabled: false,
  scriptUrl: "https://cdn.test.invalid/dist/ago-chat.js",
};

function tokenMintedAt(mintedAt: number): string {
  return fakeJwt({ issuedAtMs: mintedAt, expiresAtMs: mintedAt + LIFETIME_MS });
}

function joinResult(history: MessageDto[] = []): VisitorJoinResult {
  return { conversationId: CONVERSATION_ID, isNew: false, history };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

interface Panel {
  root: ShadowRoot;
  input: HTMLTextAreaElement;
  status: HTMLDivElement;
  bubbleTexts: () => string[];
}

/** Mounts the widget and opens it - opening is what builds the connection (`5-09`'s lazy rule). */
async function openWidget(): Promise<Panel> {
  const widget = new ChatWidget(config);
  widget.mount(document.body);
  await flush();

  const host = document.querySelector("[data-ago-chat-widget]");
  if (host?.shadowRoot == null) {
    throw new Error("the widget did not mount");
  }

  const root = host.shadowRoot;
  const query = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (element === null) {
      throw new Error(`the widget has no ${selector}`);
    }

    return element;
  };

  query<HTMLButtonElement>(".ago-toggle").click();
  await flush();

  return {
    root,
    input: query<HTMLTextAreaElement>(".ago-input"),
    status: query<HTMLDivElement>(".ago-status"),
    bubbleTexts: () => [...root.querySelectorAll(".ago-message")].map((bubble) => bubble.textContent ?? ""),
  };
}

let storage: WidgetStorage;
let renewResponse: () => Response;
let mintResponse: () => Response;
let fetchMock: ReturnType<typeof vi.fn>;

function callsTo(path: string): unknown[] {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(path));
}

function sessionBody(token: string, visitorId: string): string {
  return JSON.stringify({ token, visitorId, widgetPrimaryColorHex: null, widgetPosition: "BottomRight" });
}

beforeEach(() => {
  resetFakeSignalR();
  document.body.innerHTML = "";
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(T0);

  storage = new WidgetStorage(SITE_KEY);
  mintResponse = () =>
    new Response(sessionBody(tokenMintedAt(Date.now()), NEW_VISITOR_ID), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  renewResponse = () =>
    new Response(sessionBody(tokenMintedAt(Date.now()), VISITOR_ID), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  fetchMock = vi.fn((url: string) => Promise.resolve(String(url).endsWith("/renew") ? renewResponse() : mintResponse()));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function storeSessionMintedAt(mintedAt: number): string {
  const token = tokenMintedAt(mintedAt);
  storage.setVisitorSession({
    token,
    visitorId: VISITOR_ID,
    widgetPrimaryColorHex: null,
    widgetPosition: null,
    widgetLocale: null,
    widgetNoticeText: null,
    widgetNoticeUrl: null,
  });
  return token;
}

describe("a token that runs out while the panel is open", () => {
  it("is not what the next negotiate carries - the connection asks again and gets a live one", async () => {
    const stale = storeSessionMintedAt(T0);
    joinQueue.push(joinResult());
    const panel = await openWidget();
    expect(panel.input.disabled).toBe(false);
    expect(await currentHub().negotiateToken()).toBe(stale);

    // Six days later, still the same page load. This is the exact case `5-17` flagged as harmless
    // "only because the token never rotates".
    vi.setSystemTime(T0 + 6 * DAY_MS);

    const presented = await currentHub().negotiateToken();
    expect(presented).not.toBe(stale);
    expect(callsTo("/api/v1/visitor-sessions/renew")).toHaveLength(1);
    expect(storage.getVisitorSession()?.token).toBe(presented);
    expect(storage.getVisitorSession()?.visitorId).toBe(VISITOR_ID);
  });

  it("keeps the visitor working when the renewal cannot be reached but the token is still valid", async () => {
    const stored = storeSessionMintedAt(T0);
    joinQueue.push(joinResult());
    const panel = await openWidget();

    vi.setSystemTime(T0 + 6 * DAY_MS);
    renewResponse = () => new Response("", { status: 503 });

    expect(await currentHub().negotiateToken()).toBe(stored);
    expect(panel.input.disabled).toBe(false);
    expect(panel.status.textContent).toBe("");
  });

  it("ends the session visibly when the server refuses to renew, instead of becoming a second visitor", async () => {
    storeSessionMintedAt(T0);
    joinQueue.push(joinResult());
    const panel = await openWidget();

    vi.setSystemTime(T0 + LIFETIME_MS + DAY_MS);
    renewResponse = () => new Response("", { status: 401 });

    await expect(currentHub().negotiateToken()).rejects.toThrow("This visitor session has expired.");
    await flush();

    expect(panel.status.textContent).toBe("This chat session has expired. Reload the page to start a new one.");
    expect(panel.input.disabled).toBe(true);
    expect(callsTo("/api/v1/visitor-sessions")).toHaveLength(0);
    expect(storage.getVisitorSession()?.visitorId).toBe(VISITOR_ID);
  });
});

describe("a visitor coming back after their token has already expired", () => {
  beforeEach(() => {
    storeSessionMintedAt(T0 - LIFETIME_MS - DAY_MS);
    storage.setConversationId(CONVERSATION_ID);
    storage.setLastKnownSequence(CONVERSATION_ID, 4200);
    renewResponse = () => new Response("", { status: 401 });
  });

  it("gets a working widget and is told the previous conversation is not coming back", async () => {
    joinQueue.push(joinResult());
    const panel = await openWidget();

    expect(panel.bubbleTexts()).toEqual([
      "Your previous chat has expired, so this is a new conversation. Anything you sent before is no longer shown here.",
    ]);
    expect(panel.input.disabled).toBe(false);
    expect(storage.getVisitorSession()?.visitorId).toBe(NEW_VISITOR_ID);
  });

  it("does not ask to resume from a cursor into a conversation the new identity does not own", async () => {
    joinQueue.push(joinResult());
    await openWidget();

    expect(currentHub().invocationAt("JoinAsync", 0).args).toEqual([undefined]);
  });

  it("presents the newly minted token, not the expired one it arrived with", async () => {
    joinQueue.push(joinResult());
    await openWidget();

    const presented = await currentHub().negotiateToken();
    expect(presented).toBe(storage.getVisitorSession()?.token);
    expect(callsTo("/api/v1/visitor-sessions")).toHaveLength(1);
  });
});

describe("a visitor whose token is nowhere near expiring", () => {
  it("costs no renewal request, so this is not a per-page-load round trip", async () => {
    storeSessionMintedAt(T0 - DAY_MS);
    joinQueue.push(joinResult());
    await openWidget();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
