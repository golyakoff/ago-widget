/**
 * The booking flow's one and only view model: **a prompt, an opaque payload and a list of labelled
 * choices.**
 *
 * This shape is not a UI convenience. It is `adr/0061`'s message contract, written on the client
 * side: *"a message may carry a kind, an opaque payload and a list of actions"*, with the prose body
 * mandatory because it is the fallback every channel can render. The 2026-08-26 boundary review made
 * that a hard constraint on `20-06` in particular - *"whatever the slot picker renders must be
 * expressible as conversation content a channel with no UI can also carry ... a grid that only works
 * in a browser is a grid `21-01` cannot reuse"*.
 *
 * So the picker is not a grid. It is a sequence of these, and the browser is one renderer of them.
 * `renderStepAsText` below is another, and it is deliberately eleven lines that read **no field of
 * the payload at all** - the same demonstration `adr/0061`'s own `StructuredContentRenderingTests`
 * makes on the server side, arrived at here from the other end.
 *
 * What this file does *not* do is wire `14-06` up. Nothing here sends a message; the flow talks to
 * AGO Calendar over HTTP (see `calendarClient.ts`). What it buys is that when `21-01` does drive the
 * same interaction through a conversation, the thing it has to carry already exists in the right
 * shape - and if it did not, that would have been a finding rather than a surprise.
 */

/** One choice. A label a human reads, and a value only the producer understands - `adr/0061`'s
 * "an action is a label and an opaque value, and nothing else". No icon, no styling hint, no
 * "primary": a hint would be an opinion about the choice that a text channel could not honour. */
export interface BookingAction {
  readonly label: string;
  readonly value: string;
}

export interface BookingStep {
  /**
   * `adr/0061`'s `MessageContentKind` shape - lowercase ASCII with `.`/`_`/`-`. A string rather than
   * a union type for the same reason that ADR gives for not using an enum: a closed set would mean
   * every new kind any product ever produced needs a member added to whoever holds the set.
   */
  readonly kind: string;
  /** **Mandatory, and that is the whole rendering contract.** Any renderer on any channel can print
   * it. A step with a beautiful card and no prose is unreadable over SMS. */
  readonly body: string;
  /** The enrichment a rich renderer may use *instead of* the body. Opaque to any renderer that does
   * not know this kind - which is every renderer except the one that produced it. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** The choices. **Empty means the reply is free text**, which is derivable rather than a fourth
   * field: a prompt with no choices is a question, on a screen and on a phone alike. */
  readonly actions: readonly BookingAction[];
}

/**
 * The eleven-line renderer that proves the point.
 *
 * It reads `body` and `actions` and nothing else - notably not `payload`, whose schema it is
 * forbidden to know. Give it a step for choosing a barber and a step for choosing a time and it
 * behaves identically, because from here they are the same object with different strings in it.
 *
 * The numbering is what makes an action reachable without a pointing device: a digit coming back
 * resolves to the producer's own opaque value by index, exactly as `adr/0061` describes.
 */
export function renderStepAsText(step: BookingStep): string {
  const lines = [step.body];
  step.actions.forEach((action, index) => lines.push(`${index + 1}) ${action.label}`));
  if (step.actions.length > 0) {
    lines.push("Reply with a number.");
  }
  return lines.join("\n");
}

/** Resolves a reply of "2" back to the producer's own value. Returns `null` for anything that is
 * not a choice on this step - a person typing a sentence instead of a digit is an ordinary event,
 * not an error. */
export function resolveTextReply(step: BookingStep, reply: string): string | null {
  const trimmed = reply.trim();

  // Digits only, and the *whole* reply. `parseInt` alone would read "1.5" as 1 and "1 please" as 1,
  // which is a guess about what somebody meant - and on this particular question a wrong guess books
  // the wrong appointment. Found by a test that expected "1.5" to be refused and got a slot.
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const index = Number.parseInt(trimmed, 10);
  if (index < 1 || index > step.actions.length) {
    return null;
  }

  return step.actions[index - 1]!.value;
}
