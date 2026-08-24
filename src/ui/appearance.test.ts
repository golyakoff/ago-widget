import { describe, expect, it } from "vitest";
import { parseWidgetColor, parseWidgetPosition } from "./appearance.js";

describe("parseWidgetColor", () => {
  it("accepts a well-formed six-digit hex color", () => {
    expect(parseWidgetColor("#2F6FED")).toBe("#2F6FED");
  });

  it("accepts lowercase hex digits", () => {
    expect(parseWidgetColor("#2f6fed")).toBe("#2f6fed");
  });

  it("falls back to undefined for null - no override set server-side", () => {
    expect(parseWidgetColor(null)).toBeUndefined();
  });

  it("falls back to undefined for undefined", () => {
    expect(parseWidgetColor(undefined)).toBeUndefined();
  });

  it("falls back to undefined for a missing #", () => {
    expect(parseWidgetColor("2F6FED")).toBeUndefined();
  });

  it("falls back to undefined for a three-digit shorthand", () => {
    expect(parseWidgetColor("#2FE")).toBeUndefined();
  });

  it("falls back to undefined for a non-hex character", () => {
    expect(parseWidgetColor("#2F6FEZ")).toBeUndefined();
  });

  it("falls back to undefined for an empty string", () => {
    expect(parseWidgetColor("")).toBeUndefined();
  });

  it("falls back to undefined for a CSS injection attempt, not just an invalid color", () => {
    expect(parseWidgetColor("red; background: url(javascript:alert(1))")).toBeUndefined();
  });
});

describe("parseWidgetPosition", () => {
  it("maps 'BottomLeft' to 'bottom-left'", () => {
    expect(parseWidgetPosition("BottomLeft")).toBe("bottom-left");
  });

  it("maps 'BottomRight' to 'bottom-right'", () => {
    expect(parseWidgetPosition("BottomRight")).toBe("bottom-right");
  });

  it("falls back to 'bottom-right' for null", () => {
    expect(parseWidgetPosition(null)).toBe("bottom-right");
  });

  it("falls back to 'bottom-right' for undefined", () => {
    expect(parseWidgetPosition(undefined)).toBe("bottom-right");
  });

  it("falls back to 'bottom-right' for an unrecognised value", () => {
    expect(parseWidgetPosition("TopLeft")).toBe("bottom-right");
  });
});
