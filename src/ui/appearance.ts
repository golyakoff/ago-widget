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

/**
 * `23-63`: whether the tenant turned on «Привлекать внимание» - the launcher drawing attention to
 * itself while the panel is closed (`ui/widget.ts`'s `scheduleAttractAttention`). Off is the safe
 * fallback for every value this widget cannot positively confirm is `true`: a missing field (a
 * session cached before this setting existed, or a server response this widget's typings expect but
 * a future server bug omits), `false` itself, or anything malformed - the same "courtesy validation,
 * default to the least-surprising behaviour" posture every other parser in this file already takes.
 * A tenant who never opted in gets a silent, motionless launcher, never an accidentally-animated one.
 */
export function parseAttractAttention(value: boolean | null | undefined): boolean {
  return value === true;
}

/**
 * `23-64`: the closed set `Ago.Chat.Domain.AutoOpenDelay` fixes - 15, 30, 45, 60, 90 or 120 seconds.
 * The same "courtesy validation, default to the least-surprising behaviour" posture
 * `parseAttractAttention` already takes: anything not exactly one of those six values (missing, a
 * malformed number, a value this widget's own build predates) falls back to 30 seconds - the server's
 * own default - never `0` or `NaN`, which `scheduleAutoOpen` would otherwise read as "open
 * immediately" or "never open" by accident.
 */
const AUTO_OPEN_DELAY_SECONDS = new Set([15, 30, 45, 60, 90, 120]);

export function parseAutoOpenDelaySeconds(value: number | null | undefined): number {
  return typeof value === "number" && AUTO_OPEN_DELAY_SECONDS.has(value) ? value : 30;
}

/**
 * `23-64`/`adr/0148`: the tenant's own auto-open greeting line - never a default sentence this widget
 * would supply on the tenant's behalf (the backlog item's own Scope: "There is no default sentence we
 * supply"). `undefined` on rejection, matching `parseNoticeText`'s own convention - a missing,
 * whitespace-only, or non-string value means "draw nothing", the same as a site that never configured
 * one at all.
 */
export function parseAutoOpenGreetingText(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * `23-64`: whether the tenant turned on «Раскрывать виджет автоматически» - gated on *both* the
 * enabled flag and a real greeting to draw, since an enabled flag with no usable greeting text
 * (`parseAutoOpenGreetingText` rejected it) has nothing to show and must not schedule a timer that
 * opens an empty panel. The identical "off is the safe fallback for anything not positively
 * confirmed" posture `parseAttractAttention` already takes.
 */
export function parseAutoOpenEnabled(enabled: boolean | null | undefined, greetingText: string | undefined): boolean {
  return enabled === true && greetingText !== undefined;
}

/**
 * `25-129`: the tenant's own override for the contact-capture confirmation sentence
 * (`widgetContactCaptureConfirmationText` - `AuthEndpoints.VisitorSessionResponse`, `ago-chat`). The
 * identical trim-and-reject-empty shape `parseNoticeText`/`parseAutoOpenGreetingText` both already
 * use - a missing, whitespace-only, or non-string value means "this tenant has not configured one",
 * the same as a site that never set it at all. Unlike `parseAutoOpenGreetingText` (whose `undefined`
 * means "draw nothing at all" - there is no default greeting this widget would supply on the
 * tenant's behalf), `undefined` here is not the end of the story: `ui/contactCapture.ts`'s own caller
 * falls back to the widget's own default confirmation sentence, never to silence, since a visitor who
 * just handed over their contact details must always see *some* confirmation that it landed.
 */
export function parseContactCaptureConfirmationText(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * `25-173`: which of the two placements a visitor sees the site's connected channels in
 * (`widgetChannelSwitcherPlacement` - `AuthEndpoints.VisitorSessionResponse`, `ago-chat`). The
 * identical "one non-default value, anything else falls back to the first member" shape
 * `parseWidgetPosition` already takes for `Ago.Chat.Domain.ChannelSwitcherPlacement`'s own sibling
 * enum: `"BelowLauncher"` is the one value that means the icon row beside the toggle, so a missing,
 * malformed, or not-yet-recognised value (a session cached before this field existed, or a future
 * server value this widget's build predates) falls back to `"above-composer"`, never the other
 * placement by accident.
 *
 * `25-204`: `"above-composer"` no longer names `25-149`'s original inside-panel card -
 * `buildChannelSwitcherBanner` (`ui/widget.ts`) replaced that renderer outright with a hover-revealed
 * banner floating above the toggle, outside the panel, making the console's own label for this value
 * ("Banners above the chat window") true. This function's own return value is unchanged by that -
 * `loadChannelSwitcher` is the one place that changed which renderer the `"above-composer"` branch
 * calls.
 */
export type ChannelSwitcherPlacement = "above-composer" | "below-launcher";

export function parseChannelSwitcherPlacement(value: string | null | undefined): ChannelSwitcherPlacement {
  return value === "BelowLauncher" ? "below-launcher" : "above-composer";
}

/**
 * `25-173`: the closed set of three circle sizes `Ago.Chat.Domain.ChannelSwitcherIconSize` fixes - the
 * identical "courtesy validation, default to the least-surprising behaviour" posture every other
 * parser in this file already takes. Anything not exactly one of the three recognised wire values
 * (missing, malformed, or a value this widget's own build predates) falls back to `"medium"` - the
 * server's own default (`WidgetConfig.ChannelSwitcherIconSize`'s own remarks) - meaningful only while
 * `parseChannelSwitcherPlacement` returns `"below-launcher"`, but computed unconditionally the same
 * way every other field on this response is, so there is nothing conditional for a caller to get
 * wrong.
 */
export type ChannelSwitcherIconSize = "large" | "medium" | "small";

export function parseChannelSwitcherIconSize(value: string | null | undefined): ChannelSwitcherIconSize {
  return value === "Large" ? "large" : value === "Small" ? "small" : "medium";
}

/**
 * `25-210`: the chat panel's own `<h1>` (`.ago-header h1`, `ui/widget.ts`) - also read by `25-211`'s
 * channel-switcher header bar, so the two surfaces never show different words. The identical
 * trim-and-reject-empty shape `parseNoticeText`/`parseAutoOpenGreetingText`/
 * `parseContactCaptureConfirmationText` all already use - `Ago.Chat.Domain.WidgetConfig.PanelTitle`'s
 * own constructor already rejects a whitespace-only or over-length value server-side; this is the
 * same courtesy re-check, not a trust boundary the widget relies on.
 *
 * `undefined` on rejection - unlike `parseAutoOpenGreetingText` (whose `undefined` means "draw nothing
 * at all"), the caller here always falls back to `strings.chatWithUs`, the widget's own built-in
 * default greeting, never to silence: a chat panel always needs a title exactly the way it always
 * needs a launcher position (`WidgetConfig.PanelTitle`'s own remarks on why this joins
 * `PrimaryColorHex`/`Position`'s "always renders something" terms, not `NoticeText`'s).
 */
export function parsePanelTitle(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
