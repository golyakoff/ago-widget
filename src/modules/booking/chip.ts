import type { SupportedLocale } from "../../i18n/resolve.js";

/**
 * `20-07`: what is left of `src/booking/` once booking runs *through the conversation* instead of
 * beside it.
 *
 * `calendarClient.ts`'s whole HTTP client, `flow.ts`'s whole step machine and `panel.ts`'s whole
 * rendering are gone entirely, not moved here - AGO Calendar's real flow now arrives as ordinary
 * chat messages carrying `contentKind`/`content`/`actions`, rendered by the generic, permanent
 * `ui/primitives/render.ts` in the base bundle, and answered through the same `sendMessage` a typed
 * reply already uses. There is no direct network call to AGO Calendar left anywhere in this
 * repository, base bundle or lazy module alike.
 *
 * What is genuinely still calendar-specific, and the entire reason this file exists as its own
 * lazily-loaded chunk (`build.mjs`'s third entry point) rather than a few lines inside `ui/widget.ts`:
 * **the words on the chip that starts a booking**, and the trigger phrase a visitor typing it
 * directly would use instead. That is copy, not mechanism - `ui/moduleLoader.ts` and the chip's own
 * click wiring in `ui/widget.ts` are the mechanism, and neither one says "booking" anywhere.
 */
export interface ModuleChipSpec {
  readonly label: string;
  readonly ariaLabel: string;
  /** `18-03`'s own interaction shape, as a UX convention rather than shared code (`ago-console`'s
   * `Composer.tsx`: `pickerOpen` derived purely from `draft.startsWith("/")`, no separate open/closed
   * state). Clicking the chip inserts this text into the composer and sends it - structurally
   * identical to a visitor typing it themselves, not a second code path (`ui/widget.ts`'s
   * `invokeModule`). Fixed and unlocalized on purpose: it is a command word a visitor might also type
   * directly, and a translated trigger would mean two words did the same thing depending on which one
   * a visitor happened to read first.
   */
  readonly triggerText: string;
}

const COPY: Record<SupportedLocale, ModuleChipSpec> = {
  en: { label: "Book", ariaLabel: "Book an appointment", triggerText: "/booking" },
  ru: { label: "Запись", ariaLabel: "Записаться на приём", triggerText: "/booking" },
};

export function bookingChipSpec(locale: SupportedLocale): ModuleChipSpec {
  return COPY[locale];
}
