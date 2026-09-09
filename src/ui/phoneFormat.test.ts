import { describe, expect, it } from "vitest";
import { formatPhoneInput } from "./phoneFormat.js";

describe("formatPhoneInput", () => {
  it("returns empty for empty input", () => {
    expect(formatPhoneInput("")).toBe("");
  });

  it("keeps a bare '+' typed as the start of the escape hatch", () => {
    expect(formatPhoneInput("+")).toBe("+");
  });

  it("defaults a bare digit to +7 - the Russia default", () => {
    expect(formatPhoneInput("9")).toBe("+7 (9");
  });

  it("builds up the full Russian mask as digits accumulate", () => {
    expect(formatPhoneInput("9161234567")).toBe("+7 (916) 123-45-67");
  });

  it("normalises a leading domestic '8' to '+7'", () => {
    expect(formatPhoneInput("89161234567")).toBe("+7 (916) 123-45-67");
  });

  it("accepts an explicit +7 unchanged in shape", () => {
    expect(formatPhoneInput("+79161234567")).toBe("+7 (916) 123-45-67");
  });

  it("caps a Russian number at 11 digits total, ignoring extra keystrokes", () => {
    expect(formatPhoneInput("+791612345678888")).toBe("+7 (916) 123-45-67");
  });

  it("lets an explicit non-Russian country code through unformatted, digits only", () => {
    expect(formatPhoneInput("+15551234567")).toBe("+15551234567");
  });

  it("caps a non-Russian number at the E.164 15-digit ceiling", () => {
    expect(formatPhoneInput("+123456789012345678")).toBe("+123456789012345");
  });

  it("strips non-digit punctuation the visitor may paste in", () => {
    expect(formatPhoneInput("+7 (916) 123-45-67")).toBe("+7 (916) 123-45-67");
  });
});
