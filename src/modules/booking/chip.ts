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
   * `invokeModule`).
   *
   * `25-131`: no longer a fixed, unlocalized `/booking` this file invents. A real, live tenant's
   * `calendar` module carries `["/записаться"]` as its own configured trigger word and nothing else -
   * `/booking` was never in that site's own list, so the chip sent a command word
   * `TriggerCommandMatcher.Match` (`ago-chat`) could never open the module for, and clicking it did
   * nothing. `bookingChipSpec`'s own caller (`ui/widget.ts`'s `loadBookingModuleChip`) now supplies
   * the site's own real, first configured word, read off the visitor handshake response's
   * `enabledModuleTriggerWords` - this field is that word, verbatim, never re-localized here.
   */
  readonly triggerText: string;
}

const COPY: Record<SupportedLocale, { label: string; ariaLabel: string }> = {
  en: { label: "Book", ariaLabel: "Book an appointment" },
  // `25-126`: `label` renamed from "Запись" to "Записаться" - the noun read as a plain schedule
  // entry, not an invitation to act, on a chip that is now a real, prominent button rather than a
  // header link. `ariaLabel` already said "Записаться на приём" and needs no change.
  ru: { label: "Записаться", ariaLabel: "Записаться на приём" },
};

/**
 * `25-131`: `triggerWord` is the site's own real, first configured trigger word - the caller's job to
 * supply, never this function's to invent. `label`/`ariaLabel` are unaffected by which word is passed:
 * the chip's own visible copy (`25-126`'s restyled Russian/English wording) stays exactly what the
 * resolved locale says regardless of what a site happened to configure as its command word.
 */
export function bookingChipSpec(locale: SupportedLocale, triggerWord: string): ModuleChipSpec {
  return { ...COPY[locale], triggerText: triggerWord };
}
