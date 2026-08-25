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
 * real `MessageDto` shows up. `VisitorHub.SendMessageAsync` accepts and persists it (`5-07`),
 * dedupes a same-id retry server-side, and puts it back on every delivery of that message.
 *
 * `5-17`: `ui/widget.ts` reconciles by matching this id against the echoed
 * `MessageDto.clientMessageId` - it used to pair by queue position, which one failed send was enough
 * to desynchronise permanently. What is still missing is the *retry* half: the widget surfaces "not
 * sure it sent" rather than resending under the same id, which is what `connection.ts`'s
 * `SendOutcomeUnknownError` doc comment describes and deliberately leaves to the caller.
 */
export function newClientMessageId(): string {
  return crypto.randomUUID();
}
