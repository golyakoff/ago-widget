import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetConfig } from "./config.js";
import { WidgetStorage } from "./storage.js";
import {
  CONFIG_REFRESH_INTERVAL_MS,
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
  demoNotice: "none",
  policyBaseUrl: "https://office.test.invalid",
  scriptUrl: "https://cdn.test.invalid/dist/widget.js",
};

/** The instant every test starts from. A fixed date, never `Date.now()`. */
const T0 = Date.UTC(2026, 7, 25, 9, 0, 0);

let now = T0;
let storage: WidgetStorage;
// `vitest` 5 infers a bare `vi.fn()`'s implementation as returning `void`, so a Promise-returning
// mock of `fetch` became a `no-misused-promises` error under `typescript-eslint` 8.69. Typing the mock
// as what it actually stands in for fixes it at the source and retires the cast below.
let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;

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
      widgetLocale: "En",
      enabledModules: [],
      ...body,
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function manager(): VisitorSessionManager {
  return new VisitorSessionManager(config, storage, { fetchImpl, now: () => now });
}

// `fetch` accepts `string | URL | Request`; production code here only ever passes a string, but the
// mock now carries `fetch`'s real signature (see `fetchImpl` above), so `String(url)` would silently
// read `[object Object]` for the other two. Narrowing here rather than suppressing the rule keeps the
// assertion honest for whichever shape a future caller uses.
const urlOf = (url: string | URL | Request): string =>
  typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

function requestsTo(path: string): RequestInit[] {
  return fetchImpl.mock.calls
    .filter(([url]) => urlOf(url).endsWith(path))
    .map(([, init]) => init as RequestInit);
}

/** A stored session as a returning visitor's browser would hold it. */
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
    enabledModules: [],
    widgetAttractAttention: false,
    widgetAutoOpenEnabled: false,
    widgetAutoOpenDelaySeconds: 30,
    widgetAutoOpenGreetingText: null,
  });
  return token;
}

beforeEach(() => {
  localStorage.clear();
  now = T0;
  storage = new WidgetStorage(SITE_KEY);
  fetchImpl = vi.fn<typeof fetch>();
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
  it("costs no request at all when the cached config is still fresh", async () => {
    const stored = storeSessionMintedAt(T0);
    // Comfortably inside both budgets: nowhere near the identity's own renewal window (day ~4.67)
    // and nowhere near `CONFIG_REFRESH_INTERVAL_MS` (a day) either.
    now = T0 + CONFIG_REFRESH_INTERVAL_MS / 2;

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

  // `11-10`: the third field a renewal refreshes, on the identical terms `11-03`'s two already do.
  it("takes the refreshed widget locale the renewal returns", async () => {
    storeSessionMintedAt(T0);
    now = T0 + 5 * DAY_MS;
    fetchImpl.mockResolvedValue(sessionResponse(tokenMintedAt(now), 200, { widgetLocale: "Ru" }));

    const start = await manager().start();

    expect(start.session.widgetLocale).toBe("Ru");
  });
});

/**
 * `25-05`: the defect the author actually hit. A returning visitor's browser holds a token nowhere
 * near its own renewal window (day ~4.67 of 7) on almost every ordinary reload - that is the whole
 * point of `17-07`, keeping the identity cheap to keep alive - so before this test's fix existed,
 * `start()` made no request at all here and a changed colour or position sat cached indefinitely
 * short of the visitor clearing their browser's site data outright. These tests fail against the
 * code as it stood before `isConfigStale`/`CONFIG_REFRESH_INTERVAL_MS` existed: at `T0 + 2 * DAY_MS`
 * the identity token above is barely a quarter of the way to its own renewal window, so only a
 * config-specific staleness check makes `start()` ask again.
 */
describe("a visitor returning after the cached config itself has gone stale", () => {
  it("renews well before the identity token's own window opens, and picks up the new config", async () => {
    storeSessionMintedAt(T0);
    // Two days in: comfortably past `CONFIG_REFRESH_INTERVAL_MS` (a day), nowhere near the
    // identity's own renewal window (day ~4.67 of a 7-day lifetime).
    now = T0 + 2 * DAY_MS;
    const renewed = tokenMintedAt(now);
    fetchImpl.mockResolvedValue(
      sessionResponse(renewed, 200, { widgetPrimaryColorHex: "#2c3e50", widgetPosition: "BottomLeft" }),
    );

    const start = await manager().start();

    expect(start.restarted).toBe(false);
    expect(start.session.visitorId).toBe(VISITOR_ID);
    expect(start.session.widgetPrimaryColorHex).toBe("#2c3e50");
    expect(start.session.widgetPosition).toBe("BottomLeft");
    expect(requestsTo("/api/v1/visitor-sessions")).toHaveLength(0);
    expect(requestsTo("/api/v1/visitor-sessions/renew")).toHaveLength(1);
    expect(storage.getVisitorSession()?.widgetPrimaryColorHex).toBe("#2c3e50");
  });

  it("does not renew one tick before the config's own interval is up", async () => {
    storeSessionMintedAt(T0);
    now = T0 + CONFIG_REFRESH_INTERVAL_MS - 1;

    const start = await manager().start();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(start.session.token).toBe(storage.getVisitorSession()?.token);
  });

  it("does not mint a new identity or touch the conversation cursor - this is a refresh, not a restart", async () => {
    storeSessionMintedAt(T0);
    storage.setConversationId("cccccccc-cccc-cccc-cccc-cccccccccccc");
    storage.setLastKnownSequence("cccccccc-cccc-cccc-cccc-cccccccccccc", 7);
    now = T0 + 2 * DAY_MS;
    fetchImpl.mockResolvedValue(sessionResponse(tokenMintedAt(now), 200));

    const start = await manager().start();

    expect(start.restarted).toBe(false);
    expect(storage.getConversationId()).toBe("cccccccc-cccc-cccc-cccc-cccccccccccc");
    expect(storage.getLastKnownSequence("cccccccc-cccc-cccc-cccc-cccccccccccc")).toBe(7);
  });

  it("leaves the visitor on the still-valid stored token when the proactive renewal fails transiently", async () => {
    const stored = storeSessionMintedAt(T0);
    now = T0 + 2 * DAY_MS;
    fetchImpl.mockRejectedValue(new TypeError("Failed to fetch"));

    const start = await manager().start();

    expect(start.restarted).toBe(false);
    expect(start.session.token).toBe(stored);
  });
});

describe("the clock moving while the page stays open", () => {
  it("renews when the token enters its window days later, not when the page loaded", async () => {
    storeSessionMintedAt(T0);
    // Inside both freshness budgets: not yet a day old (`CONFIG_REFRESH_INTERVAL_MS`), nowhere near
    // the identity's own renewal window either.
    now = T0 + CONFIG_REFRESH_INTERVAL_MS / 2;
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
    fetchImpl.mockImplementation((url: string | URL | Request) =>
      Promise.resolve(
        urlOf(url).endsWith("/renew")
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
    fetchImpl.mockImplementation((url: string | URL | Request) =>
      Promise.resolve(
        urlOf(url).endsWith("/renew") ? new Response("", { status: 401 }) : sessionResponse(tokenMintedAt(now), 201),
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
      widgetLocale: null,
      widgetNoticeText: null,
      widgetNoticeUrl: null,
      enabledModules: [],
      widgetAttractAttention: false,
      widgetAutoOpenEnabled: false,
      widgetAutoOpenDelaySeconds: 30,
      widgetAutoOpenGreetingText: null,
    });

    const sessionManager = manager();
    const start = await sessionManager.start();

    expect(start.session.token).toBe("opaque-token-no-jwt-structure");
    expect(await sessionManager.token()).toBe("opaque-token-no-jwt-structure");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
