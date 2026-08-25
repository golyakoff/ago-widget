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
   * *visitor's* handshake, which only ever happens once per visitor identity (`session.ts`'s
   * `VisitorSessionManager`: re-minting on every page view would fragment one visitor into many).
   *
   * **`17-07` largely closed this.** The paragraph that stood here said fixing it "needs a session
   * endpoint that can return current config without minting a new visitor", and that is exactly what
   * `POST /api/v1/visitor-sessions/renew` is: it returns the same response shape, so every renewal
   * rewrites these two fields. What is left of the limitation is bounded rather than permanent - a
   * returning visitor's cached config is at most one renewal window stale (a third of the token
   * lifetime), instead of frozen at the moment their identity was first minted - and `adr/0029`'s
   * own stated limitation, that an *already-open* tab does not update live, is untouched.
   *
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
