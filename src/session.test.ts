import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetConfig } from "./config.js";
import { WidgetStorage } from "./storage.js";
import {
  RENEWAL_RETRY_THROTTLE_MS,
  VisitorSessionExpiredError,
  VisitorSessionManager,
} from "./session.js";
import { fakeJwt } from "./testing/fakeJwt.js";

/**
 * `17-07`, `testing.md`'s "Component / behaviour" level: the visitor's identity surviving its own
 * token's lifetime, which is the property that lets the lifetime come down to 7 days at all.
 *
 * **Nothing here passes because the test ran quickly.** Time is an injected `now`, moved by the test
 * in whole days, so "the token expired while this page was open" is an actual assertion rather than
 * a hope about scheduling. A test that renewed only because a real clock happened to tick would
 * prove nothing about a visitor who leaves a tab open over a weekend, which is the case that
 * matters.
 */

const SITE_KEY = "shop_test";
const VISITOR_ID = "55555555-5555-5555-5555-555555555555";
const DAY_MS = 24 * 60 * 60 * 1000;
const LIFETIME_MS = 7 * DAY_MS;

const config: WidgetConfig = {
  siteKey: SITE_KEY,
  apiBaseUrl: "https://api.test.invalid",
  isPublicDemo: false,
};

/** The instant every test starts from. A fixed date, never `Date.now()`. */
const T0 = Date.UTC(2026, 7, 25, 9, 0, 0);

let now = T0;
let storage: WidgetStorage;
let fetchImpl: ReturnType<typeof vi.fn>;

/** A token minted at `mintedAt` under the server's current visitor lifetime. */
function tokenMintedAt(mintedAt: number): string {
  return fakeJwt({ issuedAtMs: mintedAt, expiresAtMs: mintedAt + LIFETIME_MS });
}

function sessionResponse(token: string, status: number, body: Partial<Record<string, unknown>> = {}): Response {
  return new Response(
    JSON.stringify({
      token,
      visitorId: VISITOR_ID,
      widgetPrimaryColorHex: null,
      widgetPosition: "BottomRight",
      ...body,
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function manager(): VisitorSessionManager {
  return new VisitorSessionManager(config, storage, { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => now });
}

function requestsTo(path: string): RequestInit[] {
  return fetchImpl.mock.calls
    .filter(([url]) => String(url).endsWith(path))
    .map(([, init]) => init as RequestInit);
}

/** A stored session as a returning visitor's browser would hold it. */
function storeSessionMintedAt(mintedAt: number): string {
  const token = tokenMintedAt(mintedAt);
  storage.setVisitorSession({ token, visitorId: VISITOR_ID, widgetPrimaryColorHex: null, widgetPosition: null });
  return token;
}

beforeEach(() => {
  localStorage.clear();
  now = T0;
  storage = new WidgetStorage(SITE_KEY);
  fetchImpl = vi.fn();
});

describe("a visitor arriving for the first time", () => {
  it("mints an identity and does not report anything as lost", async () => {
    fetchImpl.mockResolvedValue(sessionResponse(tokenMintedAt(T0), 201));

    const start = await manager().start();

    expect(start.restarted).toBe(false);
    expect(start.session.visitorId).toBe(VISITOR_ID);
    expect(requestsTo("/api/v1/visitor-sessions")).toHaveLength(1);
    expect(requestsTo("/api/v1/visitor-sessions/renew")).toHaveLength(0);
    expect(storage.getVisitorSession()?.token).toBe(start.session.token);
  });
});

describe("a visitor returning with a token that has life left in it", () => {
  it("costs no request at all", async () => {
    const stored = storeSessionMintedAt(T0);
    now = T0 + DAY_MS;

    const start = await manager().start();

    expect(start.session.token).toBe(stored);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps the same VisitorId when the token is close enough to expiry to exchange", async () => {
    storeSessionMintedAt(T0);
    // Five days in: less than a third of a seven-day lifetime is left.
    now = T0 + 5 * DAY_MS;
    const renewed = tokenMintedAt(now);
    fetchImpl.mockResolvedValue(sessionResponse(renewed, 200));

    const start = await manager().start();

    expect(start.restarted).toBe(false);
    expect(start.session.visitorId).toBe(VISITOR_ID);
    expect(start.session.token).toBe(renewed);
    expect(storage.getVisitorSession()?.token).toBe(renewed);
    expect(requestsTo("/api/v1/visitor-sessions")).toHaveLength(0);
    expect(requestsTo("/api/v1/visitor-sessions/renew")).toHaveLength(1);
  });

  it("presents the token it is renewing, so the server can answer for the same visitor", async () => {
    const stored = storeSessionMintedAt(T0);
    now = T0 + 5 * DAY_MS;
    fetchImpl.mockResolvedValue(sessionResponse(tokenMintedAt(now), 200));

    await manager().start();

    const [renewal] = requestsTo("/api/v1/visitor-sessions/renew");
    expect((renewal?.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${stored}`);
    expect(JSON.parse(renewal?.body as string)).toEqual({ publicKey: SITE_KEY });
  });

  it("takes the refreshed widget config the renewal returns", async () => {
    storeSessionMintedAt(T0);
    now = T0 + 5 * DAY_MS;
    fetchImpl.mockResolvedValue(
      sessionResponse(tokenMintedAt(now), 200, { widgetPrimaryColorHex: "#123456", widgetPosition: "BottomLeft" }),
    );

    const start = await manager().start();

    expect(start.session.widgetPrimaryColorHex).toBe("#123456");
    expect(start.session.widgetPosition).toBe("BottomLeft");
  });
});

describe("the clock moving while the page stays open", () => {
  it("renews when the token enters its window days later, not when the page loaded", async () => {
    storeSessionMintedAt(T0);
    now = T0 + DAY_MS;
    const sessionManager = manager();
    await sessionManager.start();
    expect(fetchImpl).not.toHaveBeenCalled();

    // The visitor left the tab open. Nothing about this page load changed; the calendar did.
    now = T0 + 6 * DAY_MS;
    const renewed = tokenMintedAt(now);
    fetchImpl.mockResolvedValue(sessionResponse(renewed, 200));

    expect(await sessionManager.token()).toBe(renewed);
    expect(requestsTo("/api/v1/visitor-sessions/renew")).toHaveLength(1);
  });

  it("renews a token that has already run out under an open page rather than presenting it", async () => {
    storeSessionMintedAt(T0);
    const sessionManager = manager();
    await sessionManager.start();

    now = T0 + LIFETIME_MS + DAY_MS;
    const renewed = tokenMintedAt(now);
    fetchImpl.mockResolvedValue(sessionResponse(renewed, 200));

    expect(await sessionManager.token()).toBe(renewed);
  });

  it("spends one renewal, not two, when the negotiate and an upload ask in the same tick", async () => {
    storeSessionMintedAt(T0);
    now = T0 + 6 * DAY_MS;
    fetchImpl.mockResolvedValue(sessionResponse(tokenMintedAt(now), 200));
    const sessionManager = manager();
    await sessionManager.start();
    fetchImpl.mockClear();

    now = T0 + LIFETIME_MS + 6 * DAY_MS;
    fetchImpl.mockResolvedValue(sessionResponse(tokenMintedAt(now), 200));
    const [first, second] = await Promise.all([sessionManager.token(), sessionManager.token()]);

    expect(first).toBe(second);
    expect(requestsTo("/api/v1/visitor-sessions/renew")).toHaveLength(1);
  });
});

describe("a renewal that fails for a reason that might pass", () => {
  it("leaves the visitor on the token they still have", async () => {
    const stored = storeSessionMintedAt(T0);
    now = T0 + 5 * DAY_MS;
    fetchImpl.mockRejectedValue(new TypeError("Failed to fetch"));

    const sessionManager = manager();
    const start = await sessionManager.start();

    expect(start.restarted).toBe(false);
    expect(start.session.token).toBe(stored);
    expect(await sessionManager.token()).toBe(stored);
    expect(storage.getVisitorSession()?.token).toBe(stored);
  });

  it("does not mint a second identity, which would silently orphan the conversation", async () => {
    storeSessionMintedAt(T0);
    now = T0 + 5 * DAY_MS;
    fetchImpl.mockResolvedValue(new Response("", { status: 503 }));

    await manager().start();

    expect(requestsTo("/api/v1/visitor-sessions")).toHaveLength(0);
  });

  it("is not retried on every single call, so a dead API costs one request per minute, not per attempt", async () => {
    storeSessionMintedAt(T0);
    now = T0 + 5 * DAY_MS;
    fetchImpl.mockResolvedValue(new Response("", { status: 503 }));
    const sessionManager = manager();
    await sessionManager.start();
    expect(requestsTo("/api/v1/visitor-sessions/renew")).toHaveLength(1);

    await sessionManager.token();
    await sessionManager.token();
    expect(requestsTo("/api/v1/visitor-sessions/renew")).toHaveLength(1);

    now += RENEWAL_RETRY_THROTTLE_MS + 1;
    await sessionManager.token();
    expect(requestsTo("/api/v1/visitor-sessions/renew")).toHaveLength(2);
  });

  it("refuses to answer with an expired token when it could not be renewed", async () => {
    storeSessionMintedAt(T0);
    const sessionManager = manager();
    await sessionManager.start();

    now = T0 + LIFETIME_MS + DAY_MS;
    fetchImpl.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(sessionManager.token()).rejects.toThrow("Could not renew the visitor session.");
  });
});

describe("a token the server will not renew", () => {
  it("at page load, starts a new conversation and says one was lost", async () => {
    storeSessionMintedAt(T0 - LIFETIME_MS - DAY_MS);
    fetchImpl.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).endsWith("/renew")
          ? new Response("", { status: 401 })
          : sessionResponse(tokenMintedAt(now), 201, { visitorId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
      ),
    );

    const start = await manager().start();

    expect(start.restarted).toBe(true);
    expect(start.session.visitorId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(storage.getVisitorSession()?.visitorId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });

  it("at page load, forgets the conversation cursor the new visitor does not own", async () => {
    storeSessionMintedAt(T0 - LIFETIME_MS - DAY_MS);
    storage.setConversationId("dddddddd-dddd-dddd-dddd-dddddddddddd");
    storage.setLastKnownSequence("dddddddd-dddd-dddd-dddd-dddddddddddd", 4200);
    fetchImpl.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).endsWith("/renew") ? new Response("", { status: 401 }) : sessionResponse(tokenMintedAt(now), 201),
      ),
    );

    await manager().start();

    expect(storage.getConversationId()).toBeNull();
    expect(storage.getLastKnownSequence("dddddddd-dddd-dddd-dddd-dddddddddddd")).toBeNull();
  });

  it("mid-session, ends the session instead of quietly becoming a different visitor", async () => {
    storeSessionMintedAt(T0);
    const sessionManager = manager();
    await sessionManager.start();

    now = T0 + LIFETIME_MS + DAY_MS;
    fetchImpl.mockResolvedValue(new Response("", { status: 401 }));

    await expect(sessionManager.token()).rejects.toBeInstanceOf(VisitorSessionExpiredError);
    expect(requestsTo("/api/v1/visitor-sessions")).toHaveLength(0);
    expect(storage.getVisitorSession()?.visitorId).toBe(VISITOR_ID);
  });

  it("stays ended, without spending a request per reconnect attempt", async () => {
    storeSessionMintedAt(T0);
    const sessionManager = manager();
    await sessionManager.start();

    now = T0 + LIFETIME_MS + DAY_MS;
    fetchImpl.mockResolvedValue(new Response("", { status: 401 }));
    await expect(sessionManager.token()).rejects.toBeInstanceOf(VisitorSessionExpiredError);

    await expect(sessionManager.token()).rejects.toBeInstanceOf(VisitorSessionExpiredError);
    await expect(sessionManager.token()).rejects.toBeInstanceOf(VisitorSessionExpiredError);
    expect(requestsTo("/api/v1/visitor-sessions/renew")).toHaveLength(1);
  });

  it("treats a 403 - this token belongs to another site - the same way, and does not retry it", async () => {
    storeSessionMintedAt(T0);
    const sessionManager = manager();
    await sessionManager.start();

    now = T0 + LIFETIME_MS;
    fetchImpl.mockResolvedValue(new Response("", { status: 403 }));

    await expect(sessionManager.token()).rejects.toBeInstanceOf(VisitorSessionExpiredError);
  });
});

describe("a stored token this widget cannot read", () => {
  it("is presented rather than renewed, which is what the widget did before renewal existed", async () => {
    storage.setVisitorSession({
      token: "opaque-token-no-jwt-structure",
      visitorId: VISITOR_ID,
      widgetPrimaryColorHex: null,
      widgetPosition: null,
    });

    const sessionManager = manager();
    const start = await sessionManager.start();

    expect(start.session.token).toBe("opaque-token-no-jwt-structure");
    expect(await sessionManager.token()).toBe("opaque-token-no-jwt-structure");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
