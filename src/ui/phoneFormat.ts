/**
 * `25-28`: a small, hand-rolled Russian-mobile phone mask for `contactCapture.ts`'s phone field -
 * pure and DOM-free so it is unit-testable without `jsdom`, the same reason `moduleLoader.ts`'s
 * `moduleBundleUrl` is split out from the thing that calls it.
 *
 * **Why hand-rolled, not a library.** The backlog item names `libphonenumber-js` by name and asks
 * for a measurement before reaching for it. `libphonenumber-js`'s own metadata-bearing builds start
 * in the tens of KB gzipped even for a single-country subset - measured against this widget's own
 * 45 KB hard ceiling (`README.md`'s "Bundle size", 32.3 KB already spent before this item), that is
 * not a plausible fit for "default one country, let anything else through unformatted". This file is
 * ~50 lines of digit-shuffling; `ADR-0162` (the hand-rolled ZIP writer over `jszip`/`fflate`) is the
 * precedent this item follows for the same reason: the library would spend real, permanent bundle
 * bytes on generality (every country's numbering plan) this field never uses, for a feature whose
 * entire job is "guide typing toward one shape, and get out of the way otherwise."
 *
 * **The escape hatch this item's own spec requires.** "Defaults to Russia, +7" must not become
 * "cannot enter anything else" - the mechanism here is the leading `+`. A visitor who types a bare
 * digit gets `+7` assumed and RU-shaped from then on (the common case, and the whole point of
 * defaulting). A visitor who explicitly types `+` followed by a country code other than `7` is taken
 * at their word: digits are kept, capped at the 15-digit maximum any E.164 number can have, and no
 * further RU-shaped punctuation is imposed. Clearing the field and starting again with `+<code>` is
 * the stated, discoverable way to override the default - nothing is hidden behind a separate control.
 *
 * **What this does not attempt.** It shapes input, it does not validate it - a string that matches
 * `+7 (9XX) XXX-XX-XX` is not thereby proven to be a real, reachable number, and this file makes no
 * claim otherwise (`VisitorContactDetail`'s own "unverified free text" nature is unchanged by this
 * item). It also does not preserve cursor position through a mid-string edit - the caller always
 * places the caret at the end after reformatting, a deliberate simplification a hand-rolled mask this
 * small is allowed to make; a visitor correcting a typo in the middle retypes the tail, which is a
 * real but small cost against the alternative of a much larger, general-purpose input-mask library.
 */

/** E.164's own ceiling: a phone number is at most 15 digits, country code included. */
const E164_MAX_DIGITS = 15;

/** Russian mobile/landline numbers, country code included, are 11 digits: `7` + 10. */
const RU_TOTAL_DIGITS = 11;

export function formatPhoneInput(raw: string): string {
  const hasExplicitPlus = raw.includes("+");
  const digits = raw.replace(/\D/g, "");

  if (digits.length === 0) {
    // Nothing typed yet but the visitor has already reached for the escape hatch (a bare "+") - keep
    // it rather than snapping back to empty, so the next digit lands after their own "+".
    return hasExplicitPlus ? "+" : "";
  }

  if (hasExplicitPlus && !digits.startsWith("7")) {
    // The stated override: an explicit country code that is not Russia's. Kept as digits only,
    // capped at E.164's own ceiling - no RU-shaped punctuation forced onto a shape it does not fit.
    return `+${digits.slice(0, E164_MAX_DIGITS)}`;
  }

  // Russian shape from here down. A leading "8" is the familiar domestic-dialling convention for
  // "+7" and is normalised to it; anything else without an explicit "+" is assumed to already be a
  // subscriber number missing its country code, which is what "defaults to Russia" means in practice.
  const ruDigits = digits.startsWith("8") ? `7${digits.slice(1)}` : digits.startsWith("7") ? digits : `7${digits}`;

  return formatRussianDigits(ruDigits.slice(0, RU_TOTAL_DIGITS));
}

/** `digits` always starts with the "7" country code here; formats the remaining up-to-10 subscriber
 * digits into `+7 (9XX) XXX-XX-XX`, growing the punctuation only as far as digits actually typed
 * reach - so a partial number never shows a placeholder character for a digit not yet entered. */
function formatRussianDigits(digits: string): string {
  const subscriber = digits.slice(1);
  let out = "+7";

  if (subscriber.length === 0) {
    return out;
  }

  out += ` (${subscriber.slice(0, 3)}`;
  if (subscriber.length >= 3) {
    out += ")";
  }

  if (subscriber.length > 3) {
    out += ` ${subscriber.slice(3, 6)}`;
  }

  if (subscriber.length > 6) {
    out += `-${subscriber.slice(6, 8)}`;
  }

  if (subscriber.length > 8) {
    out += `-${subscriber.slice(8, 10)}`;
  }

  return out;
}
