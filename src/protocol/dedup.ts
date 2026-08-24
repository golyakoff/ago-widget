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
 * real `MessageDto` shows up. `VisitorHub.SendMessageAsync` does accept and persist it (`5-07`) and
 * dedupes a same-id retry server-side - but `ui/widget.ts` still reconciles its own optimistic
 * bubble by queue order, not by matching this id against the echoed `MessageDto.clientMessageId`,
 * and does not yet build a same-id retry path either. See `connection.ts`'s `SendOutcomeUnknownError`
 * for the conservative rule that gap forces in the meantime.
 */
export function newClientMessageId(): string {
  return crypto.randomUUID();
}
