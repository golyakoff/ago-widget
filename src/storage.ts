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

  getVisitorSession(): VisitorSession | null {
    const token = this.readSafe("visitor-token");
    const visitorId = this.readSafe("visitor-id");
    return token && visitorId ? { token, visitorId } : null;
  }

  setVisitorSession(session: VisitorSession): void {
    this.writeSafe("visitor-token", session.token);
    this.writeSafe("visitor-id", session.visitorId);
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
