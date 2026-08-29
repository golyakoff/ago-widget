import { en } from "./en.js";
import { ru } from "./ru.js";
import type { WidgetStrings } from "./strings.js";

export type SupportedLocale = "en" | "ru";

/**
 * `11-10`: mirrors `ui/appearance.ts`'s `parseWidgetPosition` exactly in shape, not in content - the
 * same "courtesy re-check, never trust the wire value blindly" posture (`ui/appearance.ts`'s own
 * remarks), applied to a new field. Pure and total: **never throws, for any input**, because a
 * malformed or unrecognised locale value must never be the reason a widget fails to render
 * (embeddable-widget skill: "every entry point wrapped so an internal failure degrades to no-widget,
 * never a broken host page" - the same discipline one level down, at a single response field).
 *
 * `"Ru"` is the one non-default value `Ago.Chat.Domain.Locale` defines - anything else (missing,
 * `"En"`, or a malformed string a future server version might send) resolves to `"en"`, the widget's
 * own existing, only-ever language before this item. This mirrors `Locale.En` being the enum's first
 * member specifically so a value this widget has never heard of still renders in the language every
 * visitor has always seen, the same reasoning `Locale`'s own doc comment states for the server-side
 * default.
 */
export function parseWidgetLocale(value: string | null | undefined): SupportedLocale {
  return value === "Ru" ? "ru" : "en";
}

/** The locale's own string table - `resolve.ts` is the one place that maps `SupportedLocale` to a
 * `WidgetStrings` object, so a caller never imports `en.js`/`ru.js` directly. */
export function getStrings(locale: SupportedLocale): WidgetStrings {
  return locale === "ru" ? ru : en;
}
