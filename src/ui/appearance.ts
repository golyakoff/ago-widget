/**
 * `11-03`: turns `POST /api/v1/visitor-sessions`'s two new fields (`widgetPrimaryColorHex`,
 * `widgetPosition` - `AuthEndpoints.VisitorSessionResponse`, `ago-chat`) into values `ui/widget.ts`
 * can apply directly. Both functions are pure and total - no throw, ever - matching the "courtesy
 * validation, never trust the wire value blindly" posture `attachments.ts`'s own `courtesyValidate`
 * already takes: a missing, malformed, or out-of-range value falls back to the widget's own built-in
 * default silently (embeddable-widget skill: "every entry point wrapped so an internal failure
 * degrades to no-widget, never a broken host page" - the same discipline applies one level down, to a
 * single field within an otherwise-successful response).
 */

export type WidgetPosition = "bottom-right" | "bottom-left";

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * Mirrors `Ago.Chat.Domain.WidgetConfig`'s own constructor pattern (`^#[0-9A-Fa-f]{6}$`) - a courtesy
 * re-check, not a trust boundary the server relies on the widget to enforce. `undefined` (not `null`)
 * on rejection: the caller passes this straight to `CSSStyleDeclaration.setProperty`, where "do not
 * set this property, let the stylesheet's own default apply" is exactly what omitting the call means.
 */
export function parseWidgetColor(value: string | null | undefined): string | undefined {
  if (typeof value !== "string" || !HEX_COLOR_PATTERN.test(value)) {
    return undefined;
  }

  return value;
}

/**
 * `"BottomLeft"` is the one non-default value `Ago.Chat.Domain.Position` defines - anything else
 * (missing, `"BottomRight"`, or a malformed string a future server version might send) resolves to
 * `"bottom-right"`, the widget's own existing default placement. This mirrors `Position.BottomRight`
 * being the enum's first member specifically so a value this widget has never heard of still renders
 * exactly where every visitor already expects it, the same reasoning `Position`'s own doc comment
 * states for the server-side default.
 */
export function parseWidgetPosition(value: string | null | undefined): WidgetPosition {
  return value === "BottomLeft" ? "bottom-left" : "bottom-right";
}
