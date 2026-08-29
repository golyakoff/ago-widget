import { describe, expect, it } from "vitest";
import { bookingChipSpec } from "./chip.js";

describe("bookingChipSpec", () => {
  it("returns the fixed, unlocalized trigger phrase in both locales", () => {
    expect(bookingChipSpec("en").triggerText).toBe("/booking");
    expect(bookingChipSpec("ru").triggerText).toBe("/booking");
  });

  it("localizes the chip's own label and aria-label", () => {
    expect(bookingChipSpec("en")).toEqual({ label: "Book", ariaLabel: "Book an appointment", triggerText: "/booking" });
    expect(bookingChipSpec("ru").label).toBe("Запись");
  });
});
