import type { VisitorSessionResponse } from "./protocol/types.js";
import type { WidgetConfig } from "./config.js";
import type { WidgetStorage, VisitorSession } from "./storage.js";
import { jitteredDelayMs } from "./protocol/backoff.js";
import { readTokenLifetime } from "./tokenExpiry.js";

/** A site key that does not exist, or an origin this site never allowed - retrying cannot help
 * either one, so the widget gives up rather than looping forever against a permanent rejection. */
export class VisitorSessionRejectedError extends Error {}

/**
 * `17-07`: the stored token is past saving - the server refused to renew it (`401`/`403`), which
 * for a token means it has expired or its signing key has been rotated out (`17-03`).
 *
 * This is only ever thrown *mid-session*, never at page load: `VisitorSessionManager.start` handles
 * the same condition by minting a new identity instead (see its own doc comment for why the two
 * moments get different answers). A caller seeing this should tell the visitor to reload, not
 * quietly start a second conversation underneath a transcript that belongs to the first.
 */
export class VisitorSessionExpiredError extends Error {
  constructor() {
    super("This visitor session has expired.");
    this.name = "VisitorSessionExpiredError";
  }
}

/**
 * `17-07`: renewal did not happen and the reason might not last - the network is down, the API
 * returned a `5xx`, the rate limiter said no. Distinct from `VisitorSessionExpiredError` because
 * the identity is not gone: the same stored token is worth presenting again later.
 */
export class VisitorSessionRenewalFailedError extends Error {
  constructor(cause?: unknown) {
    super("Could not renew the visitor session.");
    this.name = "VisitorSessionRenewalFailedError";
    this.cause = cause;
  }
}

const MAX_RATE_LIMIT_RETRIES = 3;

/**
 * `17-07`: renew once less than a third of the token's own lifetime is left. Derived from the token
 * (`exp - nbf`), never from a constant mirroring the server's `JwtTokenService.VisitorTokenLifetime`
 * - this widget deliberately does not know that number, so the same code is correct against the 30
 * days deployed today and the 7 days the same item moves it to, and against whatever a later
 * decision makes it. A widget that hard-coded the lifetime would be a second place to change and a
 * silent breakage when only one of the two moved.
 *
 * A third, rather than a half or a tenth, because the useful property is *how many chances a visitor
 * gets to renew before the token dies*. At a third of 7 days the window opens with 2.3 days left, so
 * any visitor who loads the page even once in that window renews, and a visitor who does not was
 * away for five days anyway. A tenth (17 hours) would leave a daily visitor one chance; a half wastes
 * half of every token's life on renewals the visitor did not need.
 */
export const RENEWAL_THRESHOLD_FRACTION = 1 / 3;

/**
 * The window used when a token carries no `nbf`/`iat`, so `exp - nbf` cannot be computed. Not the
 * server's lifetime: it is a floor on "close enough to expiry to bother", chosen to be shorter than
 * any lifetime this project would plausibly choose so the fallback never renews a fresh token.
 */
export const FALLBACK_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * After a renewal fails for a reason that might pass, wait this long before spending another
 * request on it. Without it, `@microsoft/signalr`'s reconnect loop - which calls the token factory
 * on *every* attempt - would turn one dead API into a renewal request per reconnect attempt.
 */
export const RENEWAL_RETRY_THROTTLE_MS = 60 * 1000;

/** What `start()` resolves to. `restarted` is true only when a *stored* session was replaced by a
 * newly minted one, never for a first-ever visitor - the panel says something in that case, and
 * "welcome" is not the thing to say to someone whose conversation just went away. */
export interface VisitorSessionStart {
  session: VisitorSession;
  restarted: boolean;
}

export interface VisitorSessionManagerOptions {
  fetchImpl?: typeof fetch;
  /** Injected so tests can move the clock rather than wait for it. Production passes nothing. */
  now?: () => number;
}

/**
 * Owns the visitor's identity for the life of the page: mints it, renews it before it expires, and
 * is the only place the current token is read from.
 *
 * ## Why this exists at all (`17-07`, and what `adr/0034` recorded)
 *
 * Before this, `getOrCreateVisitorSession` stored the first token it was ever given and reused it
 * forever - it never inspected `exp` and never re-minted. So the token's lifetime *was* "how long a
 * returning visitor still sees their own conversation", and shortening it would only have moved the
 * day the widget silently stops working from day 31 to day 8. That is exactly why `adr/0034` could
 * not lower the number on its own. With renewal, the two stop being the same quantity: the lifetime
 * bounds how long *one token* stays useful, and the visitor's history stays reachable for as long as
 * they keep coming back.
 *
 * ## Renewal happens at use, not on a timer
 *
 * There is no `setInterval` here, deliberately. The token is only ever *presented* in three places -
 * the hub's negotiate, and the attachment REST calls - and each of them goes through `token()`,
 * which renews first if the window is open. That covers the cases a timer covers and two it does
 * not: a laptop that slept through the moment the timer would have fired renews on the next use
 * rather than never, and a background tab costs the host page nothing at all. It also means the
 * widget never renews a token it was not about to use.
 *
 * The case that motivates it: `@microsoft/signalr` calls its `accessTokenFactory` on **every**
 * negotiate, including every automatic-reconnect attempt. A connection that was opened days ago and
 * drops is re-established with whatever that factory returns now - which, because it goes through
 * `token()`, is a token that is valid now rather than the one this page load started with.
 */
export class VisitorSessionManager {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private session: VisitorSession | null = null;
  /** One renewal at a time: the negotiate and an attachment upload can both ask within the same
   * tick, and two renewals would spend two rate-limit tokens to reach the same place. */
  private renewalInFlight: Promise<VisitorSession> | null = null;
  private lastFailedRenewalAt: number | null = null;
  private expired = false;

  constructor(
    private readonly config: WidgetConfig,
    private readonly storage: WidgetStorage,
    options: VisitorSessionManagerOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
  }

  /** The session as currently known, without touching the network. `null` before `start()`. */
  get current(): VisitorSession | null {
    return this.session;
  }

  /**
   * Resolves the visitor's identity for this page load.
   *
   * Three paths, and the third is `17-07`'s decided answer for the expired case:
   *
   * - **No stored session** - mint one. First-ever visitor; `restarted` is false.
   * - **A stored session with life left in it** - use it, renewing first if it is inside the
   *   renewal window. Same `VisitorId`, so the conversation is still theirs. A renewal that fails
   *   transiently here is not fatal: the stored token is still valid, and `token()` will try again.
   * - **A stored session the server will not renew** (expired, or signed by a rotated-out key) -
   *   **mint a new identity, clear the conversation cursor, and report `restarted: true`.** The
   *   widget must keep working on a stranger's page, so refusing to start is not on the table; and
   *   the cursor has to go, because a `lastKnownSequence` from a conversation this new visitor does
   *   not own would make the resuming `JoinAsync` ask for a delta of somebody else's transcript.
   *   `restarted` exists so the panel can *say* the previous conversation is gone rather than open
   *   blank - `adr/0034`'s note that "the current failure mode is silence" is the thing this item
   *   was told to make observable rather than move.
   *
   * Re-identification only ever happens here, at a page load. `token()` refuses to do it
   * mid-session for the reason stated on `VisitorSessionExpiredError`.
   */
  async start(): Promise<VisitorSessionStart> {
    const stored = this.storage.getVisitorSession();
    if (stored === null) {
      return { session: await this.mint(), restarted: false };
    }

    this.session = stored;
    if (!this.isInRenewalWindow(stored.token)) {
      return { session: stored, restarted: false };
    }

    try {
      return { session: await this.renew(stored.token), restarted: false };
    } catch (error) {
      if (!(error instanceof VisitorSessionExpiredError)) {
        // Transient. The stored token has not expired yet - that is what put it in the *window*
        // rather than past the end - so this page load carries on with it and `token()` retries.
        return { session: stored, restarted: false };
      }

      this.storage.clearConversation();
      this.expired = false;
      return { session: await this.mint(), restarted: true };
    }
  }

  /**
   * The token to present right now, renewed first if it is close enough to expiry to be worth it.
   *
   * Passed to `VisitorConnection` as its `accessTokenFactory` and used for every attachment call,
   * so every presentation of the token in this widget goes through this one method.
   *
   * Throws `VisitorSessionExpiredError` when the server has definitively refused to renew, and
   * `VisitorSessionRenewalFailedError` when it could not be reached and the stored token is itself
   * past `exp` - i.e. only when there is genuinely nothing valid to present. A transient failure
   * with a still-valid token is not an error here: it returns the token.
   */
  async token(): Promise<string> {
    const session = this.session;
    if (session === null) {
      throw new VisitorSessionRenewalFailedError("No visitor session has been started.");
    }

    if (this.expired) {
      throw new VisitorSessionExpiredError();
    }

    if (!this.isInRenewalWindow(session.token)) {
      return session.token;
    }

    const stillValid = !this.hasExpired(session.token);
    if (stillValid && this.isThrottled()) {
      return session.token;
    }

    try {
      return (await this.renew(session.token)).token;
    } catch (error) {
      if (error instanceof VisitorSessionExpiredError || !stillValid) {
        throw error;
      }

      // Transient, and there is still a valid token to present. The API being briefly unreachable
      // is not a reason to stop the visitor using a credential the server would still accept.
      return session.token;
    }
  }

  private isThrottled(): boolean {
    return this.lastFailedRenewalAt !== null && this.now() - this.lastFailedRenewalAt < RENEWAL_RETRY_THROTTLE_MS;
  }

  /**
   * True once less than `RENEWAL_THRESHOLD_FRACTION` of the token's own lifetime remains, and true
   * for a token already past `exp`.
   *
   * False for a token this widget cannot read (`readTokenLifetime` returning `null`), which is the
   * behaviour the widget had before renewal existed: present it and let the server judge. Guessing
   * "unreadable, therefore renew" would put every opaque token into a renewal loop.
   */
  private isInRenewalWindow(token: string): boolean {
    const lifetime = readTokenLifetime(token);
    if (lifetime === null) {
      return false;
    }

    const window =
      lifetime.issuedAtMs === null
        ? FALLBACK_RENEWAL_WINDOW_MS
        : (lifetime.expiresAtMs - lifetime.issuedAtMs) * RENEWAL_THRESHOLD_FRACTION;

    return this.now() >= lifetime.expiresAtMs - window;
  }

  private hasExpired(token: string): boolean {
    const lifetime = readTokenLifetime(token);
    return lifetime !== null && this.now() >= lifetime.expiresAtMs;
  }

  /**
   * `POST /api/v1/visitor-sessions/renew` - a fresh token for the **same** `VisitorId`. Re-minting
   * through the public endpoint instead would "work" and is exactly what loses the history, which is
   * why preserving the identity is the whole point of a separate endpoint rather than a flag on the
   * existing one.
   *
   * The response carries the same shape as the mint, so a renewal also refreshes the cached
   * `widgetPrimaryColorHex`/`widgetPosition`/`widgetLocale` (`11-10`'s own addition to this same
   * shape). That closes `storage.ts`'s own `11-03` limitation as a
   * side effect: it says fixing it "needs a session endpoint that can return current config without
   * minting a new visitor", and this is that endpoint. The config a returning visitor sees is now at
   * most one renewal window stale instead of frozen at the moment their identity was first minted.
   */
  private renew(token: string): Promise<VisitorSession> {
    const inFlight = this.renewalInFlight;
    if (inFlight !== null) {
      return inFlight;
    }

    const attempt = this.renewOnce(token)
      .then((session) => {
        this.lastFailedRenewalAt = null;
        return session;
      })
      .catch((error: unknown) => {
        if (error instanceof VisitorSessionExpiredError) {
          this.expired = true;
        } else {
          this.lastFailedRenewalAt = this.now();
        }

        throw error;
      })
      .finally(() => {
        this.renewalInFlight = null;
      });

    this.renewalInFlight = attempt;
    return attempt;
  }

  private async renewOnce(token: string): Promise<VisitorSession> {
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.config.apiBaseUrl}/api/v1/visitor-sessions/renew`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ publicKey: this.config.siteKey }),
        });
      } catch (error) {
        throw new VisitorSessionRenewalFailedError(error);
      }

      if (response.status === 200) {
        return this.store((await response.json()) as VisitorSessionResponse);
      }

      // The two the server uses to say "this token is finished": `401` from the Visitor scheme
      // itself (expired, or signed by a key that is no longer accepted - `17-03`'s rotation), and
      // `403` for a token whose `site_id` is not this embed's site. Neither improves with a retry,
      // and neither is a reason to keep presenting the token.
      if (response.status === 401 || response.status === 403) {
        throw new VisitorSessionExpiredError();
      }

      if (response.status === 429 && attempt <= MAX_RATE_LIMIT_RETRIES) {
        await this.sleepForRetryAfter(response, attempt);
        continue;
      }

      throw new VisitorSessionRenewalFailedError(`Visitor session renewal rejected: ${response.status}`);
    }
  }

  /**
   * `POST /api/v1/visitor-sessions` (api-design.md, Widget-facing constraints): rate-limited per
   * site, `429` + `Retry-After` honoured with jittered backoff rather than hammered
   * (embeddable-widget skill's Connection behaviour). This mints a *new* `VisitorId`, so it runs
   * exactly twice in a visitor's life at most: the first time they arrive, and once more if they
   * come back after their token could no longer be renewed. Everything in between is `renew`.
   */
  private async mint(): Promise<VisitorSession> {
    for (let attempt = 1; ; attempt++) {
      const response = await this.fetchImpl(`${this.config.apiBaseUrl}/api/v1/visitor-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: this.config.siteKey }),
      });

      if (response.status === 201) {
        return this.store((await response.json()) as VisitorSessionResponse);
      }

      if (response.status === 429 && attempt <= MAX_RATE_LIMIT_RETRIES) {
        await this.sleepForRetryAfter(response, attempt);
        continue;
      }

      throw new VisitorSessionRejectedError(`Visitor session request rejected: ${response.status}`);
    }
  }

  private store(body: VisitorSessionResponse): VisitorSession {
    const session: VisitorSession = {
      token: body.token,
      visitorId: body.visitorId,
      widgetPrimaryColorHex: body.widgetPrimaryColorHex,
      widgetPosition: body.widgetPosition,
      widgetLocale: body.widgetLocale,
      widgetNoticeText: body.widgetNoticeText,
      widgetNoticeUrl: body.widgetNoticeUrl,
    };
    this.storage.setVisitorSession(session);
    this.session = session;
    return session;
  }

  private async sleepForRetryAfter(response: Response, attempt: number): Promise<void> {
    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : jitteredDelayMs(attempt);
    await sleep(Number.isFinite(retryAfterMs) ? retryAfterMs : jitteredDelayMs(attempt));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
