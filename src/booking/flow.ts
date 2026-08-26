import {
  BookingRateLimitedError,
  BookingUnavailableError,
  SlotTakenError,
  type BookableCalendar,
  type BookableService,
  type CalendarClient,
  type OpenSlot,
} from "./calendarClient.js";
import type { BookingAction, BookingStep } from "./steps.js";

/**
 * Turns answers into the next step, and nothing else.
 *
 * **It renders nothing and knows nothing about a DOM.** Every state it can be in is a
 * `BookingStep` - `adr/0061`'s (kind, body, payload, actions) - so the browser panel and the
 * eleven-line text renderer in `steps.ts` are two consumers of the same object, and `21-01` would be
 * a third. If any state here needed a shape a numbered list could not express, that would be the
 * finding `20-06` was told to report; none does, and the one place it came close is worth naming:
 * **the contact details.** Name and phone are not a choice among options, so they are two free-text
 * prompts rather than one form with two fields - a form is a browser concept and a prompt is not.
 *
 * **No calendar step in v1's normal path.** A tenant with one published calendar - which is every
 * tenant this product currently has a screen to create - would otherwise be asking the visitor a
 * question with one answer. With several, the step appears.
 */
export type FlowOutcome =
  | { readonly kind: "step"; readonly step: BookingStep }
  | { readonly kind: "done"; readonly step: BookingStep };

interface Choice {
  calendar?: BookableCalendar;
  service?: BookableService;
  workerId?: string | null;
  slot?: OpenSlot;
  phone?: string;
}

type Stage = "calendar" | "service" | "worker" | "slot" | "phone" | "name" | "done";

export class BookingFlow {
  private surface: BookableCalendar[] = [];
  private workers: readonly { workerId: string; displayName: string }[] = [];
  private slots: readonly OpenSlot[] = [];
  private stage: Stage = "calendar";
  private readonly choice: Choice = {};

  constructor(
    private readonly client: CalendarClient,
    /** Injected so a test can pin the rendering of a time without pinning the machine's zone. The
     * server sends an instant with an explicit offset (CLAUDE.md rule 11); how it reads to a person
     * is the renderer's business, and this is the seam. */
    private readonly formatSlot: (slot: OpenSlot) => string = defaultSlotLabel,
  ) {}

  /** Reads the tenant's surface and produces the first question. */
  async start(signal?: AbortSignal): Promise<FlowOutcome> {
    const surface = await this.client.getSurface(signal);
    this.surface = surface.calendars.filter((calendar) => calendar.services.length > 0);

    if (this.surface.length === 0) {
      // A published calendar nobody performs anything on is a real configuration state, not an
      // error - the shop's own doing, and said plainly rather than dressed up as a failure.
      return this.terminal("booking.unavailable", "There is nothing to book here yet.");
    }

    if (this.surface.length === 1) {
      this.choice.calendar = this.surface[0]!;
      return this.serviceStep();
    }

    this.stage = "calendar";
    return step("booking.calendar", "Which calendar would you like to book?", {
      calendars: this.surface.map((calendar) => ({ calendarId: calendar.calendarId, name: calendar.name })),
    }, this.surface.map((calendar) => ({ label: calendar.name, value: calendar.calendarId })));
  }

  /**
   * Answers the current step. `value` is an action's opaque value for a step with choices, and the
   * visitor's own text for a step without - the same one-way door `adr/0061` describes, where "the
   * return direction is an ordinary message".
   */
  async answer(value: string, signal?: AbortSignal): Promise<FlowOutcome> {
    switch (this.stage) {
      case "calendar": {
        const calendar = this.surface.find((candidate) => candidate.calendarId === value);
        if (!calendar) {
          return this.retry("That is not one of the options.");
        }
        this.choice.calendar = calendar;
        return this.serviceStep();
      }

      case "service": {
        const service = this.choice.calendar?.services.find((candidate) => candidate.serviceId === value);
        if (!service) {
          return this.retry("That is not one of the options.");
        }
        this.choice.service = service;
        return this.workerStep(signal);
      }

      case "worker": {
        // The empty string is "anyone" - the choice a visitor who does not care makes. It is a value
        // like any other rather than a flag, so a numbered list can offer it as an option.
        this.choice.workerId = value === "" ? null : value;
        if (this.choice.workerId !== null && !this.workers.some((worker) => worker.workerId === value)) {
          return this.retry("That is not one of the options.");
        }
        return this.slotStep(signal);
      }

      case "slot": {
        const slot = this.slots.find((candidate) => candidate.bookingId === value);
        if (!slot) {
          return this.retry("That is not one of the options.");
        }
        this.choice.slot = slot;
        this.stage = "phone";
        return step(
          "booking.phone",
          `${this.formatSlot(slot)} with ${slot.workerDisplayName}. What is your phone number?`,
          { bookingId: slot.bookingId, startsAt: slot.startsAt },
          [],
        );
      }

      case "phone": {
        const phone = value.trim();
        if (phone.length === 0) {
          return this.retry("A phone number is how the shop reaches you, so it cannot be left out.");
        }
        this.choice.phone = phone;
        this.stage = "name";
        return step("booking.name", "And your name? Leave it blank if you would rather not say.", {}, []);
      }

      case "name":
        return this.confirm(value.trim(), signal);

      case "done":
      default:
        return this.terminal("booking.done", "This booking is finished.");
    }
  }

  private serviceStep(): FlowOutcome {
    const calendar = this.choice.calendar!;
    this.stage = "service";
    return step(
      "booking.service",
      "What would you like to book?",
      { calendarId: calendar.calendarId, timeZone: calendar.timeZone, services: calendar.services },
      calendar.services.map((service) => ({
        label: `${service.name} (${service.durationMinutes} min)`,
        value: service.serviceId,
      })),
    );
  }

  private async workerStep(signal?: AbortSignal): Promise<FlowOutcome> {
    const calendar = this.choice.calendar!;
    const service = this.choice.service!;
    this.workers = await this.client.getWorkers(calendar.calendarId, service.serviceId, signal);

    if (this.workers.length === 0) {
      return this.terminal("booking.unavailable", "Nobody is available for that at the moment.");
    }

    if (this.workers.length === 1) {
      // One name is not a choice. Asking anyway would be a question whose answer is already known,
      // which reads as bureaucracy on a screen and is worse over a numbered list.
      this.choice.workerId = this.workers[0]!.workerId;
      return this.slotStep(signal);
    }

    this.stage = "worker";
    const actions: BookingAction[] = this.workers.map((worker) => ({
      label: worker.displayName,
      value: worker.workerId,
    }));
    actions.push({ label: "Anyone", value: "" });

    return step("booking.worker", "Who would you like to see?", { workers: this.workers }, actions);
  }

  private async slotStep(signal?: AbortSignal): Promise<FlowOutcome> {
    const calendar = this.choice.calendar!;
    const service = this.choice.service!;
    this.slots = await this.client.getSlots(
      calendar.calendarId,
      service.serviceId,
      this.choice.workerId ?? null,
      signal,
    );

    if (this.slots.length === 0) {
      return this.terminal("booking.unavailable", "There are no free times for that at the moment.");
    }

    this.stage = "slot";
    return step(
      "booking.slot",
      "When would you like to come?",
      { timeZone: calendar.timeZone, slots: this.slots },
      this.slots.map((slot) => ({ label: this.slotLabel(slot), value: slot.bookingId })),
    );
  }

  private async confirm(displayName: string, signal?: AbortSignal): Promise<FlowOutcome> {
    const calendar = this.choice.calendar!;
    const service = this.choice.service!;
    const slot = this.choice.slot!;

    try {
      const confirmation = await this.client.book(
        calendar.calendarId,
        slot.bookingId,
        service.serviceId,
        this.choice.phone!,
        displayName.length === 0 ? null : displayName,
        signal,
      );

      this.stage = "done";
      return {
        kind: "done",
        step: {
          kind: "booking.confirmed",
          // Nothing here says "pending", and nothing may: the server's own
          // BookingConfirmedResponse has no field that could, and the two-step mechanic exists
          // precisely so the customer is told they are booked.
          body: `You are booked: ${this.formatSlot(slot)} with ${slot.workerDisplayName}.`,
          payload: confirmation as unknown as Record<string, unknown>,
          actions: [],
        },
      };
    } catch (error) {
      if (error instanceof SlotTakenError) {
        // The one failure the flow acts on instead of reporting: go back to the times, which have
        // just changed, and let the visitor pick again. Losing this race is ordinary (`adr/0059`).
        const next = await this.slotStep(signal);
        return withBody(next, `${new SlotTakenError().message} Here is what is still free.`);
      }

      if (error instanceof BookingRateLimitedError || error instanceof BookingUnavailableError) {
        return this.terminal("booking.unavailable", error.message);
      }

      throw error;
    }
  }

  /** Re-asks the current question. Reached when a text reply resolves to no action - a person typing
   * a sentence where a digit was expected, which is an ordinary event over a channel with no
   * buttons. */
  private retry(reason: string): FlowOutcome {
    return this.terminal("booking.invalid_choice", reason);
  }

  private terminal(kind: string, body: string): FlowOutcome {
    this.stage = "done";
    return { kind: "done", step: { kind, body, payload: {}, actions: [] } };
  }

  private slotLabel(slot: OpenSlot): string {
    return `${this.formatSlot(slot)}${this.choice.workerId === null ? ` · ${slot.workerDisplayName}` : ""}`;
  }
}

function step(
  kind: string,
  body: string,
  payload: Record<string, unknown>,
  actions: readonly BookingAction[],
): FlowOutcome {
  return { kind: "step", step: { kind, body, payload, actions } };
}

function withBody(outcome: FlowOutcome, body: string): FlowOutcome {
  return { kind: outcome.kind, step: { ...outcome.step, body } };
}

/**
 * The default label for a time. `Intl` is in every browser this widget supports and costs the bundle
 * nothing, and it renders in the *reader's* own zone - which is right for a visitor booking near
 * home and is the honest default when the widget is not told otherwise. The calendar's own IANA zone
 * travels in the payload for a renderer that would rather use it.
 */
function defaultSlotLabel(slot: OpenSlot): string {
  const at = new Date(slot.startsAt);
  return at.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
