import type { MessageActionDto, MessageDto } from "../../protocol/types.js";
import type { WidgetStrings } from "../../i18n/strings.js";

/**
 * `20-07` / `adr/0065` §4: the closed primitive vocabulary, rendered.
 *
 * This is what makes the ADR's central claim true rather than asserted - **"the widget is written
 * once and does not grow per module"** - so it lives in the base bundle, permanently, next to
 * `handleIncoming`/`appendMessageBubble` in `ui/widget.ts` rather than in any module directory.
 * `src/booking/` (the `20-06` era's direct-HTTP flow: `calendarClient.ts`, `flow.ts`, `panel.ts`)
 * is retired by this same item, not moved here - this file has never made an HTTP request and never
 * will; it only turns a `MessageDto`'s `contentKind`/`content`/`actions` into DOM, and turns a click
 * or a submit back into an ordinary chat message through the caller's own `onReply`.
 *
 * **Never throws.** An unrecognised `contentKind` - a fifth primitive some future module invents, or
 * simply an older/newer build talking past this one (api-design.md's additive-only rule) - returns
 * `null`, and the caller's existing plain-`body` bubble is the whole fallback
 * (`embeddable-widget` skill: "never break the host page"). Malformed `content` inside a *known*
 * kind degrades field-by-field (`?.`/`??`) rather than throwing, for the same reason: Chat itself
 * never opens this payload (`adr/0065` §1), so this renderer cannot assume a module got its own
 * shape right either.
 */
export type PrimitiveKind = "choice_list" | "form" | "confirmation_card" | "date_time_picker";

const KNOWN_KINDS: readonly PrimitiveKind[] = ["choice_list", "form", "confirmation_card", "date_time_picker"];

function isKnownKind(kind: string | null | undefined): kind is PrimitiveKind {
  return kind != null && (KNOWN_KINDS as readonly string[]).includes(kind);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

interface ConfirmationLine {
  readonly label?: unknown;
  readonly value?: unknown;
}

interface ConfirmationCardContent {
  readonly title?: unknown;
  readonly lines?: readonly ConfirmationLine[];
}

interface FormContent {
  readonly fieldId?: unknown;
  readonly fieldLabel?: unknown;
}

/**
 * Called once per reply the visitor makes through a rendered primitive - a button click for the
 * three choice-shaped kinds, a submitted text input for `form`. `contentKind` is always the kind
 * being replied to (the "reply-by-id, never free text" rule the backlog item names as its most
 * important structural property), `value` is the action's own opaque value or the typed text, and
 * `displayText` is what a human reads back in their own sent bubble (the action's label, or the
 * typed text itself for a form).
 */
export type PrimitiveReplyHandler = (contentKind: string, value: string, displayText: string) => void;

/**
 * Renders the rich form of a step-shaped message, or `null` for anything this build does not
 * recognise. `message.body` is left to the caller - it is the mandatory, every-channel-renders-it
 * fallback (`adr/0061`), shown regardless of whether this function has anything to add.
 */
export function renderPrimitiveContent(
  message: MessageDto,
  strings: WidgetStrings,
  onReply: PrimitiveReplyHandler,
): HTMLElement | null {
  if (!isKnownKind(message.contentKind)) {
    return null;
  }

  const kind = message.contentKind;
  const content = asRecord(message.content);
  const actions = message.actions ?? [];

  const container = document.createElement("div");
  container.className = "ago-primitive";

  const disableAll = (): void => {
    container.querySelectorAll("button, input").forEach((element) => {
      (element as HTMLButtonElement | HTMLInputElement).disabled = true;
    });
  };

  switch (kind) {
    case "choice_list":
    case "date_time_picker":
      // `date_time_picker`'s `slots`/`startsAt` enrichment is deliberately unused here - the backlog
      // item's own instruction is that rendering `actions` as a flat button list is a correct,
      // acceptable slice, and a calendar-grid using `startsAt` is a bonus rather than a requirement.
      appendActionButtons(container, actions, (action) => {
        disableAll();
        onReply(kind, action.value, action.label);
      });
      return container;

    case "confirmation_card": {
      const card = content as ConfirmationCardContent;
      if (typeof card.title === "string" && card.title.length > 0) {
        const title = document.createElement("div");
        title.className = "ago-primitive-title";
        title.textContent = card.title;
        container.appendChild(title);
      }

      for (const line of card.lines ?? []) {
        if (typeof line?.label !== "string" || typeof line.value !== "string") {
          continue;
        }

        const row = document.createElement("div");
        row.className = "ago-primitive-line";
        const label = document.createElement("span");
        label.className = "ago-primitive-line-label";
        label.textContent = line.label;
        const value = document.createElement("span");
        value.className = "ago-primitive-line-value";
        value.textContent = line.value;
        row.append(label, value);
        container.appendChild(row);
      }

      appendActionButtons(container, actions, (action) => {
        disableAll();
        onReply(kind, action.value, action.label);
      });
      return container;
    }

    case "form": {
      const form = content as FormContent;
      const fieldLabel = typeof form.fieldLabel === "string" ? form.fieldLabel : strings.yourAnswer;

      const field = document.createElement("form");
      field.className = "ago-primitive-form";

      const label = document.createElement("label");
      label.className = "ago-primitive-form-label";
      label.textContent = fieldLabel;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "ago-primitive-form-input";
      if (typeof form.fieldId === "string") {
        input.name = form.fieldId;
      }
      input.setAttribute("aria-label", fieldLabel);

      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "ago-primitive-form-submit";
      submit.textContent = strings.continueLabel;

      field.addEventListener("submit", (event) => {
        event.preventDefault();
        // A numeric-looking answer ("2 Main St", a phone number, an age) is still free text on a
        // `form` step - `contentKind` alone decides how a reply is interpreted, never the shape of
        // what was typed. This is the same value on both branches of `onReply`'s call below: what a
        // visitor typed is both what gets sent and what their own bubble shows back to them.
        const value = input.value.trim();
        disableAll();
        onReply(kind, value, value);
      });

      field.append(label, input, submit);
      container.appendChild(field);
      return container;
    }

    default:
      // Unreachable given `isKnownKind`'s guard above and `PrimitiveKind`'s own four members - kept
      // rather than omitted so this function stays total (`HTMLElement | null`, never `undefined`)
      // even if a fifth kind is ever added to `KNOWN_KINDS` without a case here to match.
      return null;
  }
}

function appendActionButtons(
  container: HTMLElement,
  actions: readonly MessageActionDto[],
  onClick: (action: MessageActionDto) => void,
): void {
  if (actions.length === 0) {
    return;
  }

  const list = document.createElement("div");
  list.className = "ago-primitive-choices";
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ago-primitive-choice";
    button.textContent = action.label;
    button.addEventListener("click", () => onClick(action));
    list.appendChild(button);
  }
  container.appendChild(list);
}
