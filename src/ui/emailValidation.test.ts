import { describe, expect, it } from "vitest";
import { isValidEmail } from "./emailValidation.js";

describe("isValidEmail", () => {
  it("accepts a plain address", () => {
    expect(isValidEmail("ivan@example.invalid")).toBe(true);
  });

  it("accepts a subdomain and a plus-tag", () => {
    expect(isValidEmail("ivan+support@mail.example.invalid")).toBe(true);
  });

  it("rejects a string with no @", () => {
    expect(isValidEmail("ivan.example.invalid")).toBe(false);
  });

  it("rejects a missing domain", () => {
    expect(isValidEmail("ivan@")).toBe(false);
  });

  it("rejects a missing local part", () => {
    expect(isValidEmail("@example.invalid")).toBe(false);
  });

  // The WHATWG pattern this file uses does not require a dot in the domain at all - deliberately;
  // that is the spec's own reference implementation, not a gap this item introduces. A single-label
  // domain like this is a real, if unusual, address (an internal network's own mail host).
  it("accepts a single-label domain - the WHATWG pattern does not require a TLD", () => {
    expect(isValidEmail("ivan@localhost")).toBe(true);
  });

  it("rejects embedded whitespace", () => {
    expect(isValidEmail("ivan test@example.invalid")).toBe(false);
  });

  it("rejects a trailing dot on the domain", () => {
    expect(isValidEmail("ivan@example.invalid.")).toBe(false);
  });

  it("rejects two consecutive dots in the domain", () => {
    expect(isValidEmail("ivan@example..invalid")).toBe(false);
  });
});
