import { describe, expect, it } from "vitest";
import { parseNoticeText, parseNoticeUrl, parseWidgetColor, parseWidgetPosition } from "./appearance.js";

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

describe("parseNoticeText", () => {
  it("accepts an ordinary sentence", () => {
    expect(parseNoticeText("We use your messages to answer your questions.")).toBe(
      "We use your messages to answer your questions.",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(parseNoticeText("  We read what you send us.  ")).toBe("We read what you send us.");
  });

  it("falls back to undefined for null - no notice configured server-side", () => {
    expect(parseNoticeText(null)).toBeUndefined();
  });

  it("falls back to undefined for undefined", () => {
    expect(parseNoticeText(undefined)).toBeUndefined();
  });

  it("falls back to undefined for an empty string", () => {
    expect(parseNoticeText("")).toBeUndefined();
  });

  it("falls back to undefined for a whitespace-only string", () => {
    expect(parseNoticeText("   ")).toBeUndefined();
  });
});

describe("parseNoticeUrl", () => {
  it("accepts an absolute https:// URL", () => {
    expect(parseNoticeUrl("https://tenant.example/privacy")).toBe("https://tenant.example/privacy");
  });

  it("falls back to undefined for null - no notice link configured server-side", () => {
    expect(parseNoticeUrl(null)).toBeUndefined();
  });

  it("falls back to undefined for undefined", () => {
    expect(parseNoticeUrl(undefined)).toBeUndefined();
  });

  it("falls back to undefined for an empty string", () => {
    expect(parseNoticeUrl("")).toBeUndefined();
  });

  it("falls back to undefined for plain http://", () => {
    expect(parseNoticeUrl("http://tenant.example/privacy")).toBeUndefined();
  });

  // The same injection-attempt guard `parseWidgetColor`'s own test proves - not just "invalid", but
  // "the specific dangerous shape a naive check might let through" (a URL constructor accepts a
  // `javascript:` value as syntactically well-formed; only the scheme check catches it).
  it("falls back to undefined for a javascript: URL, not just any invalid one", () => {
    expect(parseNoticeUrl("javascript:alert(1)")).toBeUndefined();
  });

  it("falls back to undefined for a relative path", () => {
    expect(parseNoticeUrl("/privacy")).toBeUndefined();
  });

  it("falls back to undefined for a value with no scheme at all", () => {
    expect(parseNoticeUrl("tenant.example/privacy")).toBeUndefined();
  });
});
