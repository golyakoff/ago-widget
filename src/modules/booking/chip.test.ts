import { describe, expect, it } from "vitest";
import { bookingChipSpec } from "./chip.js";

describe("bookingChipSpec", () => {
  // `25-131`: the whole point of the change - this function no longer invents a trigger word, it
  // passes through whichever one the caller (a site's own real configuration) supplied.
  it("uses the caller-supplied trigger word, verbatim, regardless of locale", () => {
    expect(bookingChipSpec("en", "/booking").triggerText).toBe("/booking");
    expect(bookingChipSpec("ru", "/записаться").triggerText).toBe("/записаться");
  });

  // The exact real-tenant scenario `docs/backlog/25-131-*.md` found live: a site's calendar module
  // configured `/записаться` and nothing resembling `/booking` at all.
  it("does not fall back to a hardcoded /booking when the site configured a different word", () => {
    expect(bookingChipSpec("ru", "/записаться").triggerText).not.toBe("/booking");
  });

  it("localizes the chip's own label and aria-label independently of the trigger word", () => {
    expect(bookingChipSpec("en", "/записаться")).toEqual({
      label: "Book",
      ariaLabel: "Book an appointment",
      triggerText: "/записаться",
    });
    expect(bookingChipSpec("ru", "/booking").label).toBe("Записаться");
  });
});
