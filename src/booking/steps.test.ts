import { describe, expect, it } from "vitest";
import { renderStepAsText, resolveTextReply, type BookingStep } from "./steps.js";

/**
 * **The test `20-06` exists to be judged on.**
 *
 * The item's constraint was that whatever the slot picker renders "must be expressible as
 * conversation content a channel with no UI can also carry ... a grid that only works in a browser
 * is a grid `21-01` cannot reuse". The way to prove that is not to assert that a renderer produces
 * nice text - it is to prove the text renderer **cannot see** what it is rendering.
 *
 * So the central case below takes two steps whose payloads have nothing in common - a list of
 * barbers and a list of times - gives them the same body and the same action labels, and asserts the
 * rendered text is byte-identical. That is the same demonstration `adr/0061`'s own
 * `StructuredContentRenderingTests` makes on the server side, and it is the one that would fail the
 * moment somebody "improves" the text renderer by reading a field.
 */
describe("rendering a booking step on a channel with no UI", () => {
  const workers: BookingStep = {
    kind: "booking.worker",
    body: "Who would you like to see?",
    payload: { workers: [{ workerId: "w1", displayName: "Alex" }, { workerId: "w2", displayName: "Bo" }] },
    actions: [
      { label: "Alex", value: "w1" },
      { label: "Bo", value: "w2" },
    ],
  };

  const slots: BookingStep = {
    kind: "booking.slot",
    body: "Who would you like to see?",
    payload: {
      timeZone: "Europe/Moscow",
      slots: [{ bookingId: "e1", startsAt: "2026-05-05T09:00:00+00:00" }],
      somethingTheRendererHasNeverHeardOf: { nested: [1, 2, 3] },
    },
    actions: [
      { label: "Alex", value: "e1" },
      { label: "Bo", value: "e2" },
    ],
  };

  it("reads no field of the payload", () => {
    // Different kinds, wildly different payloads, same body and same labels - and the output has to
    // be identical, because the renderer is only allowed to look at the two things every channel
    // has.
    expect(renderStepAsText(slots)).toBe(renderStepAsText(workers));
  });

  it("prints the prose and numbers the choices", () => {
    expect(renderStepAsText(workers)).toBe(
      ["Who would you like to see?", "1) Alex", "2) Bo", "Reply with a number."].join("\n"),
    );
  });

  it("prints a step with no choices as plain prose, with no instruction to reply with a number", () => {
    // A free-text prompt and a final confirmation are both this shape. Telling somebody to "reply
    // with a number" when there is nothing numbered is the failure this pins down.
    const prompt: BookingStep = {
      kind: "booking.phone",
      body: "What is your phone number?",
      payload: {},
      actions: [],
    };

    expect(renderStepAsText(prompt)).toBe("What is your phone number?");
  });

  it("survives a payload that is not an object shape the renderer expects", () => {
    // The payload is opaque, which means the renderer must not be able to be broken by its contents.
    const odd: BookingStep = {
      kind: "booking.slot",
      body: "When?",
      payload: { anything: null, deeply: { nested: undefined } },
      actions: [{ label: "Tue 10:00", value: "e1" }],
    };

    expect(renderStepAsText(odd)).toContain("1) Tue 10:00");
  });
});

describe("resolving a reply on a channel with no UI", () => {
  const step: BookingStep = {
    kind: "booking.slot",
    body: "When would you like to come?",
    payload: { irrelevant: true },
    actions: [
      { label: "Tue 10:00", value: "event-a" },
      { label: "Tue 10:45", value: "event-b" },
    ],
  };

  it("turns a digit into the producer's own opaque value, by index", () => {
    expect(resolveTextReply(step, "2")).toBe("event-b");
    expect(resolveTextReply(step, " 1 ")).toBe("event-a");
  });

  it("returns null for anything that is not one of the choices", () => {
    // A person typing a sentence where a digit was expected is an ordinary event over SMS, not an
    // error - so this reports "not a choice" rather than throwing.
    for (const reply of ["0", "3", "-1", "", "tuesday please", "1.5"]) {
      expect(resolveTextReply(step, reply)).toBeNull();
    }
  });
});
