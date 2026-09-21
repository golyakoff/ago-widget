import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetConfig } from "../config.js";
import { WidgetStorage } from "../storage.js";
import { joinQueue, resetFakeSignalR } from "../testing/fakeSignalR.js";
import { fakeJwt } from "../testing/fakeJwt.js";

/**
 * `25-143`: the reload-time half of the closed-launcher unread badge (`25-141`) - what a visitor sees
 * on the toggle *before* the panel ever opens, seeded from `GET .../unread-count` rather than starting
 * at zero. A separate file from `widget.test.ts`, for the identical reason `sessionRenewal.test.ts` is
 * one (that file's own doc comment): every test here needs a session already planted in storage
 * *before* the widget is constructed, and the widget must never be opened for several of them - the
 * whole point is to observe the badge while the panel is still closed.
 */
vi.mock("@microsoft/signalr", () => import("../testing/fakeSignalR.js"));

const { ChatWidget } = await import("./widget.js");

const SITE_KEY = "shop_test";
const CONVERSATION_ID = "77777777-7777-7777-7777-777777777777";
const VISITOR_ID = "99999999-9999-9999-9999-999999999999";
const T0 = Date.UTC(2026, 8, 18, 9, 0, 0);
const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const config: WidgetConfig = {
  siteKey: SITE_KEY,
  apiBaseUrl: "https://api.test.invalid",
  demoNotice: "none",
  policyBaseUrl: "https://office.test.invalid",
  scriptUrl: "https://cdn.test.invalid/dist/widget.js",
};

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

function sessionBody(token: string): string {
  return JSON.stringify({
    token,
    visitorId: VISITOR_ID,
    widgetPrimaryColorHex: null,
    widgetPosition: "BottomRight",
    enabledModules: [],
  });
}

let storage: WidgetStorage;
let fetchMock: ReturnType<typeof vi.fn>;
let unreadCountResponse: () => Response;

function callsTo(path: string): unknown[][] {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(path));
}

/** Mounts the widget without opening it - the badge this file tests is exactly what a visitor sees
 * before ever clicking the toggle. */
async function mountWidget(): Promise<{ toggle: HTMLButtonElement; badge: HTMLElement }> {
  const widget = new ChatWidget(config);
  widget.mount(document.body);
  await flush();

  const host = document.querySelector("[data-ago-chat-widget]");
  if (host?.shadowRoot == null) {
    throw new Error("the widget did not mount");
  }

  const toggle = host.shadowRoot.querySelector<HTMLButtonElement>(".ago-toggle");
  const badge = host.shadowRoot.querySelector<HTMLElement>(".ago-unread-badge");
  if (toggle === null || badge === null) {
    throw new Error("the widget has no toggle/badge");
  }

  return { toggle, badge };
}

function storeValidSession(): string {
  const token = fakeJwt({ issuedAtMs: T0, expiresAtMs: T0 + LIFETIME_MS });
  storage.setVisitorSession({
    token,
    visitorId: VISITOR_ID,
    widgetPrimaryColorHex: null,
    widgetPosition: null,
    widgetLocale: null,
    widgetNoticeText: null,
    widgetNoticeUrl: null,
    enabledModules: [],
    enabledModuleTriggerWords: {},
    channelLinks: [],
    widgetAttractAttention: false,
    widgetAutoOpenEnabled: false,
    widgetAutoOpenDelaySeconds: 30,
    widgetAutoOpenGreetingText: null,
    widgetContactCaptureConfirmationText: null,
    widgetChannelSwitcherPlacement: null,
    widgetChannelSwitcherIconSize: null,
    widgetPanelTitle: null,
  });
  return token;
}

beforeEach(() => {
  resetFakeSignalR();
  document.body.innerHTML = "";
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(T0);

  storage = new WidgetStorage(SITE_KEY);
  unreadCountResponse = () => new Response(JSON.stringify({ count: 0 }), { status: 200 });

  fetchMock = vi.fn((url: string) => {
    if (String(url).includes("/unread-count")) {
      return Promise.resolve(unreadCountResponse());
    }

    return Promise.resolve(
      new Response(sessionBody(fakeJwt({ issuedAtMs: T0, expiresAtMs: T0 + LIFETIME_MS })), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a brand-new visitor", () => {
  it("makes no unread-count call at all and shows no badge", async () => {
    const { badge, toggle } = await mountWidget();

    expect(callsTo("/unread-count")).toHaveLength(0);
    expect(badge.hidden).toBe(true);
    expect(toggle.getAttribute("aria-label")).not.toMatch(/\d/);
  });
});

describe("a returning visitor with a stored conversation", () => {
  it("seeds the closed launcher's badge from the server's own count, before the panel ever opens", async () => {
    storeValidSession();
    storage.setConversationId(CONVERSATION_ID);
    storage.setLastKnownSequence(CONVERSATION_ID, 9);
    storage.setLastReadSequence(CONVERSATION_ID, 6);
    unreadCountResponse = () => new Response(JSON.stringify({ count: 3 }), { status: 200 });

    const { badge, toggle } = await mountWidget();

    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("3");
    expect(toggle.getAttribute("aria-label")).toContain("3");
  });

  it("asks the server with the stored read watermark as afterSequence", async () => {
    storeValidSession();
    storage.setConversationId(CONVERSATION_ID);
    storage.setLastKnownSequence(CONVERSATION_ID, 9);
    storage.setLastReadSequence(CONVERSATION_ID, 6);

    await mountWidget();

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.test.invalid/api/v1/conversations/${CONVERSATION_ID}/unread-count?afterSequence=6`,
      { headers: { Authorization: expect.stringMatching(/^Bearer /) as string } },
    );
  });

  it("omits afterSequence when this browser has never opened the panel on this conversation before", async () => {
    storeValidSession();
    storage.setConversationId(CONVERSATION_ID);
    storage.setLastKnownSequence(CONVERSATION_ID, 9);
    // No setLastReadSequence call at all - this visitor has a conversation but has never opened it.

    await mountWidget();

    const call = callsTo("/unread-count")[0];
    expect(call?.[0]).toBe(`https://api.test.invalid/api/v1/conversations/${CONVERSATION_ID}/unread-count`);
  });

  it("shows no badge, and never throws, when the server call fails", async () => {
    storeValidSession();
    storage.setConversationId(CONVERSATION_ID);
    storage.setLastKnownSequence(CONVERSATION_ID, 9);
    unreadCountResponse = () => new Response("", { status: 500 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { badge } = await mountWidget();

    expect(badge.hidden).toBe(true);
  });

  it("advances the stored read watermark to the last-known sequence the moment the panel opens", async () => {
    storeValidSession();
    storage.setConversationId(CONVERSATION_ID);
    storage.setLastKnownSequence(CONVERSATION_ID, 9);
    storage.setLastReadSequence(CONVERSATION_ID, 6);
    unreadCountResponse = () => new Response(JSON.stringify({ count: 2 }), { status: 200 });
    joinQueue.push({ conversationId: CONVERSATION_ID, isNew: false, history: [] });

    const { toggle } = await mountWidget();
    toggle.click();
    await flush();

    expect(storage.getLastReadSequence(CONVERSATION_ID)).toBe(9);
  });
});
