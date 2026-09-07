/**
 * `localStorage` under a namespaced key, scoped to one site (embeddable-widget skill: "No cookies
 * on the host domain, no fingerprinting, no reading anything the host page put in storage"). Every
 * key this widget ever touches is prefixed, so it can never collide with the host page's own use
 * of `localStorage` and never needs to read a key it didn't write itself.
 */
const PREFIX = "ago-chat";

function key(siteKey: string, name: string): string {
  return `${PREFIX}:${siteKey}:${name}`;
}

/**
 * `24-15`: what a tenant must be able to declare in their own cookie or privacy notice about what
 * this widget puts on a visitor's device - written for somebody drafting that notice, not for a
 * developer reading this file. **These are not cookies.** `localStorage`, under keys prefixed
 * `ago-chat:<siteKey>:` - a tenant who audits their site for cookies and finds none would otherwise,
 * wrongly, conclude there is nothing to declare.
 *
 * `key` is the suffix after that prefix - every other field is the fact the item asked for: what
 * the key holds, why the widget needs it, and the honest lifetime, including "nothing clears it"
 * where that is the true answer rather than leaving the reader to guess. `survivesTabClose` is `true`
 * on every row because `localStorage` always outlives the tab that wrote it - stated per row rather
 * than once, so the document built from this list never has to assume it.
 *
 * `WidgetStorageDisclosureTests` (`storage.disclosure.test.ts`) is the test `24-15` asked for: it
 * drives every public write path below against a real `localStorage` and asserts the key names
 * actually written are exactly this list's `key` fields (`last-sequence:<conversationId>` matched as
 * a prefix, since it is templated - one physical key per conversation, not one key overall) - so a
 * key added to `writeSafe`/`removeSafe` without a row here fails a test, not a review.
 *
 * `ago-console`'s tenant-facing document (`DeviceStorageDisclosurePage`) renders this same list,
 * translated and formatted for a tenant. It is a hand-maintained copy, not an import: the two
 * repositories build and deploy independently and neither consumes the other's source, so there is
 * no mechanical link between this array and that page's own copy of it - keep the two in step by eye
 * whenever this list changes, the same way `ago-console`'s own `DeviceStorageDisclosurePage.test.tsx`
 * documents the constraint on its side.
 */
export interface StorageDisclosureEntry {
  /** The key suffix, after `ago-chat:<siteKey>:`. */
  key: string;
  /** What the key holds, in plain language a tenant's privacy notice can use directly. */
  holds: string;
  /** Why the widget needs it. */
  why: string;
  /** The honest lifetime: real expiry, renewal, or "nothing clears it" stated as such. */
  lifetime: string;
  /** Whether the record survives the visitor closing the tab. Always `true` for `localStorage`. */
  survivesTabClose: true;
}

export const WIDGET_STORAGE_DISCLOSURE: readonly StorageDisclosureEntry[] = [
  {
    key: "visitor-token",
    holds: "A signed session token (JWT) proving this browser belongs to a specific visitor.",
    why: "Presented on every realtime connection and attachment request so the server recognises the same visitor across page loads.",
    lifetime:
      "Issued for 7 days and renewed automatically while the visitor keeps returning (`17-07`/`17-08`, `adr/0048`), so a returning visitor's token effectively never expires. If the visitor never returns, nothing clears the stored value.",
    survivesTabClose: true,
  },
  {
    key: "visitor-id",
    holds: "The visitor's own identifier, matching the token's `sub` claim.",
    why: "Lets the widget recognise the same visitor across a reload without asking the server first, so a returning visitor resumes their own conversation instead of starting a new one.",
    lifetime:
      "Renewed alongside the token above; replaced only if the server refuses to renew (an expired or rotated-out token forces a fresh identity, `17-07`). Otherwise nothing clears it.",
    survivesTabClose: true,
  },
  {
    key: "widget-color",
    holds: "The tenant's configured accent colour for the widget, if they set one.",
    why: "Lets the widget render with the tenant's chosen colour immediately on the next page load, before the server confirms it again.",
    lifetime:
      "Refreshed at least once a day for a returning visitor, and sooner if the identity token above " +
      "is itself due for renewal (`25-05`); removed the moment the tenant unsets the colour - a cache " +
      "of that one setting, not a record about the visitor.",
    survivesTabClose: true,
  },
  {
    key: "widget-position",
    holds: "The tenant's configured on-screen corner for the widget.",
    why: "Same purpose as the colour above - a cached rendering preference, refreshed with the session.",
    lifetime: "Same as the colour above.",
    survivesTabClose: true,
  },
  {
    key: "widget-locale",
    holds: "The tenant's configured widget language.",
    why: "Same purpose as the colour above.",
    lifetime: "Same as the colour above.",
    survivesTabClose: true,
  },
  {
    key: "widget-notice-text",
    holds: "The tenant's own processing-notice text (`16-04`) - words the tenant wrote, not the widget's own.",
    why: "Lets the widget show the tenant's notice without a second round trip once the session is cached.",
    lifetime: "Same as the colour above.",
    survivesTabClose: true,
  },
  {
    key: "widget-notice-url",
    holds: "A link to the tenant's own privacy policy, alongside the notice text above.",
    why: "Same purpose as the notice text above.",
    lifetime: "Same as the colour above.",
    survivesTabClose: true,
  },
  {
    key: "conversation-id",
    holds: "The id of the conversation this browser last held with the tenant.",
    why: "Lets a reload resume the same conversation instead of starting a new one.",
    lifetime:
      "Replaced when a later conversation starts; cleared when the stored visitor identity itself is replaced (`17-07`), because a new identity does not own the old conversation. Otherwise nothing clears it.",
    survivesTabClose: true,
  },
  {
    key: "last-sequence:<conversationId>",
    holds: "The highest message sequence number this browser has seen for one conversation - a cursor, never message text.",
    why: "Lets a dropped connection resume with only what it missed while it was gone, instead of the whole transcript again. `23-53`: a plain reload no longer uses this to ask for less - it always asks for the visitor's own history page, so reopening the widget never comes back empty.",
    lifetime:
      "One entry per conversation the browser has ever resumed. The entry for whichever conversation id was current is removed when the stored identity itself is replaced (`17-07`); an entry for an earlier, already-superseded conversation is not otherwise cleared.",
    survivesTabClose: true,
  },
];

export interface VisitorSession {
  token: string;
  visitorId: string;
  /**
   * `11-03`: cached alongside the identity at mint time, from the same `POST /api/v1/visitor-sessions`
   * response - not fetched separately. `adr/0029`'s "read once, at bootstrap" model is about the
   * *visitor's* handshake, which only ever happens once per visitor identity (`session.ts`'s
   * `VisitorSessionManager`: re-minting on every page view would fragment one visitor into many).
   *
   * **`17-07` largely closed this, and `25-05` narrowed what it left.** The paragraph that stood
   * here said fixing it "needs a session endpoint that can return current config without minting a
   * new visitor", and that is exactly what `POST /api/v1/visitor-sessions/renew` is: it returns the
   * same response shape, so every renewal rewrites these two fields. `17-07` alone still bounded a
   * returning visitor's stale config to the *identity* token's own renewal window - up to `2/3` of
   * its 7-day lifetime, since that window only opens once a third of it remains - which is what
   * produced `25-05`: a visitor whose browser already held a live, out-of-window token (the ordinary
   * case for anyone reloading a page they had open before) saw **no refresh at all** on an ordinary
   * reload, only on `Clear site data` removing the stored token outright. `session.ts`'s
   * `isConfigStale`/`CONFIG_REFRESH_INTERVAL_MS` now renews on a day's own schedule, independent of
   * how much life the identity token has left - and `adr/0029`'s own stated limitation, that an
   * *already-open* tab does not update live without a reload at all, is still untouched by either.
   *
   * `null` for a session written before this field existed, or for a site with no override -
   * `ui/appearance.ts`'s `parseWidgetColor`/`parseWidgetPosition` treat both identically to "not set".
   */
  widgetPrimaryColorHex: string | null;
  widgetPosition: string | null;
  /** `11-10`: cached alongside color/position on the identical terms - the same `POST
   * /api/v1/visitor-sessions`(`/renew`) response, refreshed on the identical schedule (`25-05`).
   * `null` for a session written before this field existed, or for a site with no override -
   * `i18n/resolve.ts`'s `parseWidgetLocale` treats that identically to "not set" and falls back to
   * English. */
  widgetLocale: string | null;
  /** `16-04`: cached alongside the rest on the identical terms - the tenant's own processing-notice
   * text and link, refreshed on the identical schedule (`25-05`). `null` for a session written before
   * this field existed, or for a site that has not configured a notice - `ui/appearance.ts`'s
   * `parseNoticeText`/`parseNoticeUrl` treat that identically to "not set" and render nothing. */
  widgetNoticeText: string | null;
  widgetNoticeUrl: string | null;
}

export class WidgetStorage {
  constructor(private readonly siteKey: string) {}

  private readSafe(name: string): string | null {
    try {
      return localStorage.getItem(key(this.siteKey, name));
    } catch {
      // Private-browsing modes and disabled storage throw on access, not just on write - treated
      // the same as "nothing stored yet", never a reason to break the widget.
      return null;
    }
  }

  private writeSafe(name: string, value: string): void {
    try {
      localStorage.setItem(key(this.siteKey, name), value);
    } catch {
      // No storage available - the widget still works for this page load, it just can't resume a
      // conversation across a reload.
    }
  }

  private removeSafe(name: string): void {
    try {
      localStorage.removeItem(key(this.siteKey, name));
    } catch {
      // Same as writeSafe - storage unavailable is not this widget's problem to solve.
    }
  }

  getVisitorSession(): VisitorSession | null {
    const token = this.readSafe("visitor-token");
    const visitorId = this.readSafe("visitor-id");
    if (!token || !visitorId) {
      return null;
    }

    return {
      token,
      visitorId,
      widgetPrimaryColorHex: this.readSafe("widget-color"),
      widgetPosition: this.readSafe("widget-position"),
      widgetLocale: this.readSafe("widget-locale"),
      widgetNoticeText: this.readSafe("widget-notice-text"),
      widgetNoticeUrl: this.readSafe("widget-notice-url"),
    };
  }

  setVisitorSession(session: VisitorSession): void {
    this.writeSafe("visitor-token", session.token);
    this.writeSafe("visitor-id", session.visitorId);

    // Written as separate keys, matching every other value this class stores - only written when
    // present, so a stale key from a differently-configured site never lingers past an update.
    if (session.widgetPrimaryColorHex) {
      this.writeSafe("widget-color", session.widgetPrimaryColorHex);
    } else {
      this.removeSafe("widget-color");
    }

    if (session.widgetPosition) {
      this.writeSafe("widget-position", session.widgetPosition);
    } else {
      this.removeSafe("widget-position");
    }

    if (session.widgetLocale) {
      this.writeSafe("widget-locale", session.widgetLocale);
    } else {
      this.removeSafe("widget-locale");
    }

    if (session.widgetNoticeText) {
      this.writeSafe("widget-notice-text", session.widgetNoticeText);
    } else {
      this.removeSafe("widget-notice-text");
    }

    if (session.widgetNoticeUrl) {
      this.writeSafe("widget-notice-url", session.widgetNoticeUrl);
    } else {
      this.removeSafe("widget-notice-url");
    }
  }

  getLastKnownSequence(conversationId: string): number | null {
    const raw = this.readSafe(`last-sequence:${conversationId}`);
    if (raw === null) {
      return null;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  setLastKnownSequence(conversationId: string, sequence: number): void {
    this.writeSafe(`last-sequence:${conversationId}`, String(sequence));
  }

  getConversationId(): string | null {
    return this.readSafe("conversation-id");
  }

  setConversationId(conversationId: string): void {
    this.writeSafe("conversation-id", conversationId);
  }

  /**
   * `17-07`: forgets which conversation this browser was resuming, and the cursor into it.
   *
   * Called on exactly one event - a stored visitor identity the server would no longer renew being
   * replaced by a freshly minted one (`session.ts`'s `start`). The new `VisitorId` does not own the
   * old conversation, and leaving the cursor behind would make the first `JoinAsync` of the new
   * session ask to resume *from a sequence in somebody else's transcript*: the server answers with
   * the delta after that sequence in the conversation it actually resolves for this visitor, so a
   * new conversation whose own messages sit below that number comes back empty and the visitor
   * watches their own messages fail to appear.
   *
   * Removes the cursor before the id, because the cursor's key is derived from the id.
   */
  clearConversation(): void {
    const conversationId = this.getConversationId();
    if (conversationId !== null) {
      this.removeSafe(`last-sequence:${conversationId}`);
    }

    this.removeSafe("conversation-id");
  }
}
