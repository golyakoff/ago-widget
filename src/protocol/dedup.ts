/**
 * The sender's own connection receives its message twice by design: once as an immediate local
 * echo, once again when the real fan-out delivery completes (realtime.md's Fan-out path -
 * "the resulting duplicate push back to this same connection is accepted, not special-cased away
 * ... messaging.md's client-side dedupe-by-message-id already covers the duplicate the same way it
 * covers a redelivered broker message"). This is that dedupe, on the client that receives it.
 *
 * Bounded by a fixed capacity rather than growing forever - a widget can stay open on a page for a
 * long session, and nothing here needs to remember a message id from an hour ago.
 */
export class SeenMessageIds {
  private readonly seen = new Set<string>();

  constructor(private readonly capacity = 500) {}

  /** Returns true the first time an id is seen, false on every repeat. */
  markSeen(id: string): boolean {
    if (this.seen.has(id)) {
      return false;
    }

    if (this.seen.size >= this.capacity) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) {
        this.seen.delete(oldest);
      }
    }

    this.seen.add(id);
    return true;
  }
}

/**
 * `clientMessageId` per embeddable-widget skill: a client-generated id attached to every send, so
 * a UI can key its own optimistic bubble before the server ack arrives and reconcile it once the
 * real `MessageDto` shows up. It is a *local* correlation id only - `VisitorHub.SendMessageAsync`
 * does not accept or persist one today (realtime.md's Client protocol section still calls this "a
 * design intent, not wired up" as of `3-03`, and that has not changed here), so it cannot yet
 * de-duplicate a genuine retry after a lost connection the way the skill ultimately wants. See
 * `connection.ts`'s `send` for the conservative retry rule this gap forces in the meantime.
 */
export function newClientMessageId(): string {
  return crypto.randomUUID();
}
