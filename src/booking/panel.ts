import { guardAsync } from "../errors.js";
import { BookingFlow, type FlowOutcome } from "./flow.js";
import { BookingUnavailableError, CalendarClient, type BookingConfig } from "./calendarClient.js";
import type { BookingStep } from "./steps.js";

/**
 * The last stop for anything the flow could not turn into a step.
 *
 * <b>Says the same thing for a network failure and for a refused origin, because it has to.</b> A
 * browser deliberately tells JavaScript nothing about a response it was not allowed to read, so a
 * page whose origin the tenant never approved cannot know that is why - and a message that guessed
 * would be wrong exactly when the visitor most needed it to be right.
 */
function unavailable(reason: unknown): FlowOutcome {
  const message =
    reason instanceof BookingUnavailableError ? reason.message : new BookingUnavailableError().message;

  return { kind: "done", step: { kind: "booking.unavailable", body: message, payload: {}, actions: [] } };
}

/**
 * The browser's renderer for a `BookingStep`.
 *
 * **It is one of two, and that is the point.** `renderStepAsText` in `steps.ts` is the other, and
 * neither knows anything the other does not: both read `body` and `actions`, and this one
 * additionally *may* use `payload` for polish. Today it does not need to - a step's actions already
 * carry everything a person picks from - which is the strongest available evidence that the model is
 * genuinely channel-neutral rather than a browser shape with a text fallback bolted on.
 *
 * Buttons, not a grid. A grid is a layout; a list of labelled choices is the thing `21-01` can
 * re-render as `1) … 2) …` without knowing what any of them mean.
 */
export class BookingPanel {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLParagraphElement;
  private readonly choices: HTMLDivElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private flow: BookingFlow | null = null;
  private busy = false;

  constructor(private readonly config: BookingConfig) {
    this.root = document.createElement("div");
    this.root.className = "ago-booking";
    this.root.hidden = true;

    this.body = document.createElement("p");
    this.body.className = "ago-booking-body";
    // Polite, not assertive: a step arrives because the visitor just chose something, so it is an
    // answer rather than an interruption.
    this.body.setAttribute("aria-live", "polite");

    this.choices = document.createElement("div");
    this.choices.className = "ago-booking-choices";

    this.form = document.createElement("form");
    this.form.className = "ago-booking-form";
    this.form.hidden = true;
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submit(this.input.value);
    });

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "ago-booking-input";
    this.input.setAttribute("aria-label", "Your answer");

    const send = document.createElement("button");
    send.type = "submit";
    send.className = "ago-booking-send";
    send.textContent = "Continue";

    this.form.append(this.input, send);
    this.root.append(this.body, this.choices, this.form);
  }

  get element(): HTMLDivElement {
    return this.root;
  }

  show(): void {
    this.root.hidden = false;
    this.restart();
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Starts a fresh flow. Called on every open rather than resumed: availability changes under a
   * visitor who left the panel open, and a half-finished flow holding a slot id from ten minutes ago
   * would offer a time somebody else has taken. */
  restart(): void {
    this.flow = new BookingFlow(new CalendarClient(this.config));
    this.render({
      kind: "step",
      step: { kind: "booking.loading", body: "Loading available times…", payload: {}, actions: [] },
    });
    // The loading step has no actions, which would otherwise show the free-text box - suppressed
    // here because nothing is being asked yet.
    this.form.hidden = true;

    const flow = this.flow;
    guardAsync(async () => {
      // **Caught here, not left to `guardAsync`.** Found live: driving the built bundle from an
      // origin the tenant never approved leaves the server refusing the surface, the rejection
      // reaching `guardAsync`, and the panel sitting on "Loading available times…" for ever - a
      // spinner that is really an error. `guardAsync`'s job is to stop a throw escaping onto the host
      // page; it is not a way to tell the visitor anything.
      const outcome = await flow.start().catch((reason: unknown) => unavailable(reason));
      if (this.flow === flow) {
        this.render(outcome);
      }
    });
  }

  private submit(value: string): void {
    if (this.busy || this.flow === null) {
      return;
    }

    const flow = this.flow;
    this.busy = true;
    this.setDisabled(true);

    guardAsync(async () => {
      try {
        // Same reason as `restart`: a step that fails mid-flow (the slot list, say) must end in a
        // sentence rather than in a panel that stops responding.
        const outcome = await flow.answer(value).catch((reason: unknown) => unavailable(reason));
        if (this.flow === flow) {
          this.render(outcome);
        }
      } finally {
        this.busy = false;
        this.setDisabled(false);
      }
    });
  }

  private render(outcome: FlowOutcome): void {
    const step: BookingStep = outcome.step;
    this.body.textContent = step.body;
    this.choices.replaceChildren();
    this.input.value = "";

    for (const action of step.actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ago-booking-choice";
      button.textContent = action.label;
      button.addEventListener("click", () => this.submit(action.value));
      this.choices.appendChild(button);
    }

    // No actions and not finished means a free-text answer. Derived rather than carried on the step,
    // because it is the same rule a numbered-list renderer applies: a prompt with no choices is a
    // question.
    this.form.hidden = step.actions.length > 0 || outcome.kind === "done";
    if (!this.form.hidden) {
      this.input.focus();
    }
  }

  private setDisabled(disabled: boolean): void {
    this.input.disabled = disabled;
    for (const child of Array.from(this.choices.children)) {
      (child as HTMLButtonElement).disabled = disabled;
    }
  }
}
