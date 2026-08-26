import { describe, expect, it } from "vitest";
import { BookingFlow } from "./flow.js";
import { renderStepAsText, resolveTextReply } from "./steps.js";
import {
  BookingRateLimitedError,
  SlotTakenError,
  type BookableWorker,
  type BookingConfirmation,
  type BookingSurface,
  type CalendarClient,
  type OpenSlot,
} from "./calendarClient.js";

/**
 * The flow with a fake AGO Calendar behind it.
 *
 * The last test in this file is the one that matters most: it drives the **entire** booking to
 * completion using only `renderStepAsText` and digits, with no DOM anywhere - which is the concrete
 * form of `20-06`'s constraint that the picker be expressible as conversation content. If that test
 * could not be written, the answer to "could `21-01` reuse this?" would be no.
 */
describe("the booking flow", () => {
  it("skips the calendar question when a tenant has one calendar, and asks for the service", async () => {
    const flow = new BookingFlow(fakeClient(), stableLabel);

    const first = await flow.start();

    expect(first.step.kind).toBe("booking.service");
    expect(first.step.actions.map((action) => action.label)).toEqual(["Haircut (45 min)", "Beard (20 min)"]);
  });

  it("asks which calendar when there is more than one", async () => {
    const client = fakeClient({
      surface: {
        tenantName: "Barbershop",
        calendars: [calendar("cal-1", "Main"), calendar("cal-2", "Second chair")],
      },
    });

    const first = await new BookingFlow(client, stableLabel).start();

    expect(first.step.kind).toBe("booking.calendar");
    expect(first.step.actions.map((action) => action.value)).toEqual(["cal-1", "cal-2"]);
  });

  it("skips the worker question when only one person performs the service", async () => {
    // One name is not a choice. Asking anyway is bureaucracy on a screen and worse in a numbered
    // list.
    const flow = new BookingFlow(fakeClient({ workers: [{ workerId: "w1", displayName: "Alex" }] }), stableLabel);
    await flow.start();

    const next = await flow.answer("svc-haircut");

    expect(next.step.kind).toBe("booking.slot");
  });

  it("offers 'Anyone' as an ordinary choice when several people perform the service", async () => {
    const flow = new BookingFlow(fakeClient(), stableLabel);
    await flow.start();

    const workers = await flow.answer("svc-haircut");

    expect(workers.step.kind).toBe("booking.worker");
    // A value like any other, not a flag - which is exactly what lets a numbered list offer it.
    expect(workers.step.actions.at(-1)).toEqual({ label: "Anyone", value: "" });
  });

  it("says so plainly when the shop has published nothing bookable", async () => {
    const client = fakeClient({ surface: { tenantName: "Barbershop", calendars: [] } });

    const outcome = await new BookingFlow(client, stableLabel).start();

    expect(outcome.kind).toBe("done");
    expect(outcome.step.body).toContain("nothing to book");
  });

  it("re-offers the remaining times when the chosen slot was taken first", async () => {
    // `adr/0059`: losing this race is an ordinary Tuesday, so it is the one failure the flow acts on
    // rather than reports.
    let attempts = 0;
    const client = fakeClient({
      book: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new SlotTakenError();
        }
        return confirmation();
      },
    });

    const flow = new BookingFlow(client, stableLabel);
    await flow.start();
    await flow.answer("svc-haircut");
    await flow.answer("");
    await flow.answer("e1");
    await flow.answer("+79990000001");
    const afterRace = await flow.answer("Anna");

    expect(afterRace.kind).toBe("step");
    expect(afterRace.step.kind).toBe("booking.slot");
    expect(afterRace.step.body).toContain("just been taken");
  });

  it("ends with a message that never mentions a pending state", async () => {
    // The product's central decision: the customer is told they are booked, unconditionally. The
    // server's own response has no field that could say otherwise, and neither may this.
    const flow = await aFlowAtTheNameQuestion();

    const done = await flow.answer("Anna");

    expect(done.kind).toBe("done");
    expect(done.step.kind).toBe("booking.confirmed");
    expect(done.step.body.toLowerCase()).not.toContain("pending");
    expect(done.step.body.toLowerCase()).not.toContain("deadline");
    expect(done.step.body.toLowerCase()).not.toContain("confirm");
  });

  it("reports a rate limit as an end rather than throwing", async () => {
    const flow = await aFlowAtTheNameQuestion({
      book: () => {
        throw new BookingRateLimitedError();
      },
    });

    const outcome = await flow.answer("Anna");

    expect(outcome.kind).toBe("done");
    expect(outcome.step.body).toContain("Too many booking attempts");
  });

  it("refuses to continue without a phone number", async () => {
    const flow = new BookingFlow(fakeClient(), stableLabel);
    await flow.start();
    await flow.answer("svc-haircut");
    await flow.answer("");
    await flow.answer("e1");

    const outcome = await flow.answer("   ");

    expect(outcome.step.body).toContain("cannot be left out");
  });

  it("completes end to end over plain text, with no DOM and no field of any payload read", async () => {
    // **The constraint `20-06` was given, executed.** Everything below is `renderStepAsText` and a
    // digit; the only free text is a phone number and a name, which are answers a person types on
    // any channel. If a step needed a browser, this test could not be written.
    const client = fakeClient();
    const flow = new BookingFlow(client, stableLabel);
    const transcript: string[] = [];

    let outcome = await flow.start();
    transcript.push(renderStepAsText(outcome.step));

    while (outcome.kind === "step") {
      const reply = outcome.step.actions.length > 0 ? "1" : nextFreeTextAnswer(transcript.length);
      const value =
        outcome.step.actions.length > 0
          ? // Resolving a digit back to the producer's own opaque value, by index - the whole
            // mechanism, and note that nothing here knows what the value means.
            resolveTextReply(outcome.step, reply)!
          : reply;

      outcome = await flow.answer(value);
      transcript.push(renderStepAsText(outcome.step));
    }

    expect(outcome.step.kind).toBe("booking.confirmed");
    expect(transcript[0]).toContain("1) Haircut (45 min)");
    expect(transcript.at(-1)).toContain("You are booked");
  });
});

function nextFreeTextAnswer(index: number): string {
  // Phone first, then name - the order the flow asks in. Invented numbers belonging to nobody.
  return index === 3 ? "+79990000001" : "Anna";
}

function calendar(calendarId: string, name: string) {
  return {
    calendarId,
    name,
    timeZone: "Europe/Moscow",
    services: [
      { serviceId: "svc-haircut", name: "Haircut", durationMinutes: 45 },
      { serviceId: "svc-beard", name: "Beard", durationMinutes: 20 },
    ],
  };
}

function confirmation(): BookingConfirmation {
  return {
    bookingId: "e1",
    workerId: "w1",
    startsAt: "2026-05-05T09:00:00+00:00",
    endsAt: "2026-05-05T09:45:00+00:00",
    localDate: "2026-05-05",
  };
}

async function aFlowAtTheNameQuestion(overrides: Parameters<typeof fakeClient>[0] = {}): Promise<BookingFlow> {
  const flow = new BookingFlow(fakeClient(overrides), stableLabel);
  await flow.start();
  await flow.answer("svc-haircut");
  await flow.answer("");
  await flow.answer("e1");
  await flow.answer("+79990000001");
  return flow;
}

/** A label that does not depend on the machine's own time zone - the flow's `formatSlot` seam exists
 * so a test can pin this without pinning the environment. */
function stableLabel(slot: OpenSlot): string {
  return `Tue ${slot.startsAt.slice(11, 16)}`;
}

function fakeClient(
  overrides: {
    surface?: BookingSurface;
    workers?: readonly BookableWorker[];
    slots?: readonly OpenSlot[];
    book?: () => BookingConfirmation;
  } = {},
): CalendarClient {
  const surface: BookingSurface = overrides.surface ?? {
    tenantName: "Barbershop",
    calendars: [calendar("cal-1", "Main")],
  };

  const workers: readonly BookableWorker[] = overrides.workers ?? [
    { workerId: "w1", displayName: "Alex" },
    { workerId: "w2", displayName: "Bo" },
  ];

  const slots: readonly OpenSlot[] = overrides.slots ?? [
    {
      bookingId: "e1",
      workerId: "w1",
      workerDisplayName: "Alex",
      startsAt: "2026-05-05T09:00:00+00:00",
      endsAt: "2026-05-05T09:45:00+00:00",
      localDate: "2026-05-05",
    },
    {
      bookingId: "e2",
      workerId: "w2",
      workerDisplayName: "Bo",
      startsAt: "2026-05-05T10:00:00+00:00",
      endsAt: "2026-05-05T10:45:00+00:00",
      localDate: "2026-05-05",
    },
  ];

  // A hand-written fake rather than a mocking library, matching the rest of this repository: what
  // the tests assert on is what the flow asked for, and a field holding the calls says that in the
  // language the test is already written in.
  return {
    getSurface: () => Promise.resolve(surface),
    getWorkers: () => Promise.resolve(workers),
    getSlots: () => Promise.resolve(slots),
    book: () => Promise.resolve((overrides.book ?? confirmation)()),
  } as unknown as CalendarClient;
}
