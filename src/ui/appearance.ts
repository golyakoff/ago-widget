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

/**
 * `16-04`: the tenant's own sentence about who processes what a visitor is about to write
 * (`widgetNoticeText` - `AuthEndpoints.VisitorSessionResponse`, `ago-chat`). `Ago.Chat.Domain.WidgetConfig`'s
 * own constructor already rejects a whitespace-only or over-length value server-side; this is the same
 * courtesy re-check every other field in this file already does, not a trust boundary the widget relies
 * on - a value that somehow reaches the wire malformed anyway (a future server bug, a proxy in between)
 * falls back to rendering no notice at all rather than an empty-looking bar or a thrown exception.
 * `undefined` on rejection, matching `parseWidgetColor`'s own convention for "render nothing".
 */
export function parseNoticeText(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * `16-04`: where the notice points for detail - validated `https://`-only, the identical reflex
 * `Ago.Chat.Domain.WidgetConfig`'s own constructor already applies server-side (its own remarks explain
 * why this is the `6-03` webhook-URL scheme check without that validator's SSRF/private-range half: a
 * notice link is only ever handed to the visitor's own browser as an `<a href>`, never fetched by any
 * server). Re-checked here anyway for the same reason `parseWidgetColor` re-checks a hex color it
 * trusts the server to have already validated: this widget runs on a page it does not control, and
 * "the server already validated it" is not a promise the field on the wire can enforce - a malformed
 * or unsafe-scheme value (an empty string, `javascript:`, a relative path) must never become the
 * `href` of a link this widget renders into a stranger's page. Falls back to `undefined` - "render no
 * link" - rather than throwing, matching every other parser in this file.
 */
export function parseNoticeUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}
