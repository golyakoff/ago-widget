import { describe, expect, it } from "vitest";
import { formatPhoneInput, isExplicitNonRussianPhoneValue } from "./phoneFormat.js";

describe("formatPhoneInput", () => {
  it("returns empty for empty input", () => {
    expect(formatPhoneInput("")).toBe("");
  });

  it("keeps a bare '+' typed as the start of the escape hatch", () => {
    expect(formatPhoneInput("+")).toBe("+");
  });

  it("defaults a bare digit to the Russian shape, without repeating +7", () => {
    expect(formatPhoneInput("9")).toBe("(9");
  });

  it("builds up the full Russian mask as digits accumulate, without repeating +7", () => {
    expect(formatPhoneInput("9161234567")).toBe("(916) 123-45-67");
  });

  it("normalises a leading domestic '8' to the Russian shape, without repeating +7", () => {
    expect(formatPhoneInput("89161234567")).toBe("(916) 123-45-67");
  });

  it("accepts an explicit +7 but does not repeat it in the value", () => {
    expect(formatPhoneInput("+79161234567")).toBe("(916) 123-45-67");
  });

  it("caps a Russian number at 11 digits total, ignoring extra keystrokes", () => {
    expect(formatPhoneInput("+791612345678888")).toBe("(916) 123-45-67");
  });

  it("lets an explicit non-Russian country code through unformatted, digits only", () => {
    expect(formatPhoneInput("+15551234567")).toBe("+15551234567");
  });

  it("caps a non-Russian number at the E.164 15-digit ceiling", () => {
    expect(formatPhoneInput("+123456789012345678")).toBe("+123456789012345");
  });

  it("strips non-digit punctuation the visitor may paste in, without repeating +7", () => {
    expect(formatPhoneInput("+7 (916) 123-45-67")).toBe("(916) 123-45-67");
  });
});

describe("isExplicitNonRussianPhoneValue", () => {
  it("is false for the empty value", () => {
    expect(isExplicitNonRussianPhoneValue("")).toBe(false);
  });

  it("is false for a bare '+' with no digits yet", () => {
    expect(isExplicitNonRussianPhoneValue("+")).toBe(false);
  });

  it("is false for a plain Russian-shaped value with no leading +", () => {
    expect(isExplicitNonRussianPhoneValue("(916) 123-45-67")).toBe(false);
  });

  it("is false once an explicit +7 has been typed - still Russia", () => {
    expect(isExplicitNonRussianPhoneValue("+79161234567")).toBe(false);
  });

  it("is true the moment an explicit non-Russian country code is typed", () => {
    expect(isExplicitNonRussianPhoneValue("+1")).toBe(true);
  });

  it("is true for a fully-typed non-Russian number", () => {
    expect(isExplicitNonRussianPhoneValue("+15551234567")).toBe(true);
  });
});
