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

export interface VisitorSession {
  token: string;
  visitorId: string;
  /**
   * `11-03`: cached alongside the identity at mint time, from the same `POST /api/v1/visitor-sessions`
   * response - not fetched separately. `adr/0029`'s "read once, at bootstrap" model is about the
   * *visitor's* handshake, which only ever happens once per visitor identity (`getOrCreateVisitorSession`'s
   * own doc comment: re-minting on every page view would fragment one visitor into many) - so a
   * returning visitor whose identity was already minted keeps whatever config was current then, on
   * every later page load, until their stored session itself is ever refreshed. This is a real,
   * named limitation on top of the ADR's own already-stated one (an *already-open* tab not updating
   * live): here, even a *fresh* page load does not re-request config for a visitor who already has a
   * session, because re-requesting through this endpoint would mint a second identity to get it.
   * Fixing this for real needs a session endpoint that can return current config without minting a
   * new visitor - out of this item's scope (a `ago-chat` API change, and `11-01` is already closed).
   * `null` for a session written before this field existed, or for a site with no override -
   * `ui/appearance.ts`'s `parseWidgetColor`/`parseWidgetPosition` treat both identically to "not set".
   */
  widgetPrimaryColorHex: string | null;
  widgetPosition: string | null;
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
    };
  }

  setVisitorSession(session: VisitorSession): void {
    this.writeSafe("visitor-token", session.token);
    this.writeSafe("visitor-id", session.visitorId);

    // Written as two separate keys, matching every other value this class stores - only written
    // when present, so a stale key from a differently-configured site never lingers past an update.
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
}
