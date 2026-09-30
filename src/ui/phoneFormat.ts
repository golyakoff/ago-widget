/**
 * `26-327`/`docs/backlog/26-325-web-phone-input-mirrors-android-ruphonefield.md`: this file used to be
 * a self-contained mask (`25-28`/`25-209`) that emitted only the `(9XX) XXX-XX-XX` subscriber shape,
 * leaving `contactCapture.ts`'s own non-interactive `🇷🇺 +7` chip to assert the country code beside it.
 * `26-325` (author, 2026-09-30) found that inconsistent with Android's `RuPhoneField.kt` - two
 * platforms showing the same fact two different ways - and asked for byte-for-byte parity instead:
 * the fixed `+7` now lives **inside** the mask (`contactCapture.ts` drops the chip entirely), the
 * completeness gate is "exactly 10 national digits" rather than "non-blank", and a
 * `formatRuPhoneForDisplay` equivalent exists for wherever a phone is shown back to a visitor, not
 * only while it is being typed.
 *
 * **Ported from Android, not reinvented.** Every exported name below (`normalizeRuNationalDigits`,
 * `ruNationalDigits`, `canonicalRuPhone`, `maskRuNational`, `isRuPhoneComplete`,
 * `maskedOffsetForDigitCount`/`digitCountForMaskedOffset`, `formatRuPhoneForDisplay`,
 * `NATIONAL_DIGIT_COUNT`, `RU_PREFIX`) is a direct TypeScript port of the identically-named
 * Kotlin function/constant in `ago-android/app/src/main/kotlin/ago/chat/android/ui/components/
 * RuPhoneField.kt` - same algorithm, same edge cases, only the language differs (the item's own
 * framing: "code differs per platform, behaviour must match"). Their doc comments carry the full
 * reasoning for *why* each shape is what it is; this file's own comments only note where the DOM
 * forces a different mechanism for the *same* behaviour.
 *
 * **Why still hand-rolled, not a library.** Unchanged from `25-28`'s own reasoning: this widget has
 * a hard 46 KB gzipped ceiling (`build.mjs`'s own `GZIP_BUDGET_BYTES`, `README.md`'s "Bundle size"),
 * and a masking library's metadata-bearing builds start in the tens of KB for a feature this is
 * ~150 lines of digit-shuffling for. `ADR-0162`
 * (the hand-rolled ZIP writer) is the same precedent `25-28` named; nothing about mirroring Android
 * changes that trade-off; if anything it strengthens it, since Android proves the same ~150-line
 * shape is enough to cover the whole feature on a second platform independently.
 *
 * **The one thing Android's field does not have to solve.** `RuPhoneField` is RU-only - there is no
 * escape hatch in `RuPhoneField.kt` at all, because the app's phone fields never need to accept a
 * foreign number. This widget's own visitor-facing field does (`25-209`'s own finding, kept exactly
 * as-is by `26-325`'s own spec: "keep the existing `isExplicitNonRussianPhoneValue` escape hatch").
 * `editPhoneInput` below is where the two behaviours are stitched together: an explicit `+<non-7>`
 * bypasses the whole Android-mirrored RU mask and is left as free-typed digits, capped at E.164's own
 * 15-digit ceiling - exactly what this file did before, just no longer sharing space with a chip.
 *
 * **Why the DOM needs one more function than Compose does.** Android's `VisualTransformation` keeps
 * the field's *real* text content as bare digits and renders the mask as a pure visual overlay -
 * Compose recomputes the caret's transformed/untransformed position on every recomposition via
 * `OffsetMapping`, so the fixed `+7` is structurally non-deletable (the editable text never contains
 * it) and the caret " stays put as punctuation is inserted ahead of it" for free. A plain HTML
 * `<input>` has no such split: `phoneInput.value` **is** both the model and the display, so there is
 * nowhere else for the mask to live. `editPhoneInput` below is this file's own stand-in for Compose's
 * per-recomposition transform: given the field's current raw text and caret offset (both already
 * mutated by the browser's own default keystroke/paste handling, since intercepting `beforeinput` to
 * fully replicate Compose's separate-model behaviour would cost meaningfully more code for a
 * budget-constrained widget), it rebuilds the correct masked text and reuses
 * `maskedOffsetForDigitCount`/`digitCountForMaskedOffset` - the same two functions
 * `RuPhoneVisualTransformation` calls - to place the caret where Android's own `OffsetMapping` would.
 * This lands caret parity for the common cases (typing, backspacing, pasting at the end or in the
 * middle) but not the one Compose gets structurally for free: deleting exactly the fixed `+7` while
 * the caret sits inside it, with fewer than 10 digits typed, can momentarily re-absorb the stray `7`
 * as though it were a typed digit (self-correcting for a *full* 10-digit number - see
 * `normalizeRuNationalDigits`'s own drop-the-leading-country-digit rule, which happens to also
 * recover a mangled prefix once there are more than 10 digits on the line). A visitor who does that
 * sees one stray extra `7` they can delete like any other character, never a broken field - an
 * accepted, narrow gap against intercepting every keystroke to prevent it outright, matching this
 * item's own "improve to Android parity if feasible within the bundle budget, else keep end-caret and
 * note it" instruction: this goes further than end-caret, short of intercepting every keystroke.
 */

/** E.164's own ceiling: a phone number is at most 15 digits, country code included. Governs only the
 * non-Russian escape hatch below - the RU-shaped branch has its own, smaller `NATIONAL_DIGIT_COUNT`. */
const E164_MAX_DIGITS = 15;

/** A Russian mobile number's national part is exactly 10 digits, the mask's own `XXX XXX-XX-XX` -
 * `RuPhoneField.kt`'s own `NATIONAL_DIGIT_COUNT`. */
export const NATIONAL_DIGIT_COUNT = 10;

/** The fixed, non-deletable country prefix this field always shows once it has committed to the RU
 * shape - `RuPhoneField.kt`'s own `RU_PREFIX`. A notation, not language-dependent text, so (like that
 * file's own remarks on the same constant) it is a literal, never a translated string. */
export const RU_PREFIX = "+7";

/**
 * `25-209`: true once `value` carries the non-Russian escape hatch's own shape - an explicit `+`
 * followed by at least one digit whose country code is not Russia's. Exported so a caller holding
 * only the field's current (already-formatted) value can tell whether the escape hatch has engaged
 * without re-deriving this same condition a second time; `editPhoneInput` and `formatRuPhoneForDisplay`
 * below are this function's own callers. Unchanged by `26-325` - the spec's own words are "keep the
 * existing `isExplicitNonRussianPhoneValue` escape hatch".
 */
export function isExplicitNonRussianPhoneValue(value: string): boolean {
  const hasExplicitPlus = value.includes("+");
  const digits = value.replace(/\D/g, "");
  return hasExplicitPlus && digits.length > 0 && !digits.startsWith("7");
}

/**
 * Direct port of `RuPhoneField.kt`'s `normalizeRuNationalDigits`: keeps digits only, drops one
 * leading `8`/`7` country marker when the run is longer than `NATIONAL_DIGIT_COUNT` digits, and caps
 * at `NATIONAL_DIGIT_COUNT` - the paste-normalisation behaviour the backlog spec names as the single
 * most user-visible trait: `89211234567`, `+7 921 123-45-67`, `7 9211234567` and `9211234567` all
 * collapse to the same 10-digit `9211234567`. Runs on every keystroke, not only a paste - a single
 * typed digit is just as much "raw text that might contain punctuation" as a pasted block, so there is
 * no separate paste-only code path to keep in sync (Android's own doc comment on this function, word
 * for word).
 */
export function normalizeRuNationalDigits(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length > NATIONAL_DIGIT_COUNT && (digits.startsWith("8") || digits.startsWith("7"))) {
    digits = digits.slice(1);
  }
  return digits.slice(0, NATIONAL_DIGIT_COUNT);
}

/**
 * Direct port of `RuPhoneField.kt`'s `ruNationalDigits`: the national digits currently held by
 * `value`, recovered whether or not it already carries the fixed `RU_PREFIX` lead. A literal `+7`
 * lead is stripped first, so the ambiguity `normalizeRuNationalDigits` otherwise resolves by
 * digit-counting alone never mis-fires on a short, partial value (`+7` plus 3 digits is 4 digits
 * total if the prefix were counted, nowhere near the 11 that heuristic needs to suspect a leading
 * country digit) - Android's own doc comment on this function explains the same trap.
 */
export function ruNationalDigits(value: string): string {
  const withoutPrefix = value.startsWith(RU_PREFIX) ? value.slice(RU_PREFIX.length) : value;
  return normalizeRuNationalDigits(withoutPrefix);
}

/**
 * Direct port of `RuPhoneField.kt`'s `canonicalRuPhone`: blank while `nationalDigits` is empty,
 * otherwise the fixed `RU_PREFIX` followed by `nationalDigits` verbatim - complete only once there
 * are `NATIONAL_DIGIT_COUNT` of them, but a partial value is a valid canonical value too, just an
 * incomplete one.
 */
export function canonicalRuPhone(nationalDigits: string): string {
  return nationalDigits.length === 0 ? "" : `${RU_PREFIX}${nationalDigits}`;
}

/**
 * The web equivalent of `RuPhoneField.kt`'s `isRuPhoneComplete`: true once `value` carries all
 * `NATIONAL_DIGIT_COUNT` national digits. `contactCapture.ts`'s submit gate uses this - never
 * `Boolean(phone)` - because a fixed `+7` with one digit typed is already non-blank but nowhere near
 * dialable (26-325's own "Completeness = exactly 10 national digits" requirement).
 */
export function isRuPhoneComplete(value: string): boolean {
  return ruNationalDigits(value).length === NATIONAL_DIGIT_COUNT;
}

/**
 * Direct port of `RuPhoneField.kt`'s `maskRuNational`: renders `digits` (0-10, already normalised) as
 * `+7 (XXX) XXX-XX-XX`, growing one group at a time - closing punctuation for a group appears the
 * instant that group is full, not only once the next group's first digit arrives, so typing the
 * 3rd/6th/8th digit immediately shows the `)`/`-`/`-` that follows it. Also this widget's own
 * `formatRuPhoneForDisplay` renderer below, so a saved number is grouped identically to one still
 * being typed.
 */
export function maskRuNational(digits: string): string {
  let out = `${RU_PREFIX} `;
  if (digits.length === 0) {
    return out;
  }

  out += `(${digits.slice(0, 3)}`;
  if (digits.length >= 3) {
    out += ") ";
  }
  if (digits.length > 3) {
    out += digits.slice(3, Math.min(6, digits.length));
  }
  if (digits.length >= 6) {
    out += "-";
  }
  if (digits.length > 6) {
    out += digits.slice(6, Math.min(8, digits.length));
  }
  if (digits.length >= 8) {
    out += "-";
  }
  if (digits.length > 8) {
    out += digits.slice(8, Math.min(NATIONAL_DIGIT_COUNT, digits.length));
  }

  return out;
}

/**
 * Direct port of `RuPhoneField.kt`'s `maskedOffsetForDigitCount`: the masked-string offset immediately
 * after the `count`-th national digit (`0` = right after the fixed `+7 ` lead, with no digits typed
 * yet). Depends only on how many digits precede that point, not their values, so a run of `"0"`s
 * stands in for the real digits - `maskRuNational`'s own punctuation placement is a pure function of
 * digit *count*. `editPhoneInput` below uses this the same way `RuPhoneVisualTransformation` uses it
 * for `originalToTransformed`.
 */
export function maskedOffsetForDigitCount(count: number): number {
  const clamped = Math.min(Math.max(count, 0), NATIONAL_DIGIT_COUNT);
  return maskRuNational("0".repeat(clamped)).length;
}

/**
 * Direct port of `RuPhoneField.kt`'s `digitCountForMaskedOffset`: the inverse of
 * `maskedOffsetForDigitCount` - how many national digits (0..`totalDigits`) precede a given offset
 * into the masked string. An offset that lands inside punctuation snaps forward to the next digit
 * slot, the same direction a masked field's own inserted characters "push" the caret when typing
 * through them.
 */
export function digitCountForMaskedOffset(maskedOffset: number, totalDigits: number): number {
  for (let count = 0; count <= totalDigits; count += 1) {
    if (maskedOffsetForDigitCount(count) >= maskedOffset) {
      return count;
    }
  }
  return totalDigits;
}

/** The result of one `editPhoneInput` call: the field's new displayed text and where the caret
 * belongs within it. */
export interface PhoneInputEdit {
  readonly value: string;
  readonly caret: number;
}

/**
 * This file's own stand-in for Compose's per-recomposition mask transform - see this file's own top
 * doc comment ("Why the DOM needs one more function than Compose does") for the full reasoning. Called
 * from `contactCapture.ts`'s `input` handler with the field's raw text and caret offset *after* the
 * browser has already applied the keystroke or paste; returns the text/caret the field should be set
 * to instead.
 *
 * Three shapes, checked in order:
 * - Empty: nothing typed (or everything just deleted) - blank, caret at start.
 * - A bare `"+"`: the escape hatch's own transitional first character, kept as-is so the next
 *   keystroke can still go either way (`formatPhoneInput`'s own `25-209` behaviour, unchanged).
 * - `isExplicitNonRussianPhoneValue`: the foreign escape hatch has engaged - digits only, capped at
 *   `E164_MAX_DIGITS`, no RU-shaped punctuation forced onto a shape it does not fit, caret at the end
 *   (this branch never had mid-string editing support even before `26-325`).
 * - Otherwise: the Android-mirrored RU mask. `ruNationalDigits` recovers the true digit string from
 *   the *whole* raw text (self-healing against a mangled `+7`, per this file's own top doc comment);
 *   the identical function applied to the text *before* the caret gives the digit count the caret
 *   should stay just past, and `maskedOffsetForDigitCount` places it there in the freshly-rebuilt mask.
 */
export function editPhoneInput(raw: string, caret: number): PhoneInputEdit {
  if (raw.length === 0) {
    return { value: "", caret: 0 };
  }

  if (raw === "+") {
    return { value: "+", caret: 1 };
  }

  if (isExplicitNonRussianPhoneValue(raw)) {
    const digits = raw.replace(/\D/g, "");
    const value = `+${digits.slice(0, E164_MAX_DIGITS)}`;
    return { value, caret: value.length };
  }

  const nationalDigits = ruNationalDigits(raw);
  const digitsBeforeCaret = ruNationalDigits(raw.slice(0, caret));
  return {
    value: maskRuNational(nationalDigits),
    caret: maskedOffsetForDigitCount(digitsBeforeCaret.length),
  };
}

/**
 * The value `contactCapture.ts` actually submits - the canonical form described above (`RU_PREFIX` +
 * up to `NATIONAL_DIGIT_COUNT` digits, no punctuation) for the RU shape, or the foreign escape hatch's
 * own free-typed value verbatim. This is what changed most visibly for this item's own server-facing
 * behaviour: before `26-325` the field's value never carried a `+7` at all (the now-removed chip
 * showed it, but the two were never concatenated before `recordContactDetail` sent it), so a visitor's
 * recorded phone was missing its own country code. Mirroring Android's "already what a search/
 * submit/save call sends the server: no separate convert-to-E.164 step" fixes that as a direct
 * consequence of the mask living inside the field instead of beside it.
 */
export function canonicalPhoneValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed === "+") {
    return "";
  }
  if (isExplicitNonRussianPhoneValue(trimmed)) {
    return trimmed;
  }
  return canonicalRuPhone(ruNationalDigits(trimmed));
}

/**
 * `26-325`'s own submit/search-enable gate: true once `raw` is dialable - a complete 10-digit RU
 * number, or a non-empty foreign escape-hatch value (this field has no length rule for a foreign
 * number, matching `25-209`'s own original, unchanged stance: the escape hatch's whole point is to
 * get out of the way once engaged). Used in place of `Boolean(phone)`/`phone.trim().length > 0`.
 */
export function isPhoneInputComplete(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (isExplicitNonRussianPhoneValue(trimmed)) {
    return trimmed.replace(/\D/g, "").length > 0;
  }
  return isRuPhoneComplete(trimmed);
}

/**
 * Direct port of `RuPhoneField.kt`'s `formatRuPhoneForDisplay` (`26-307` on Android, `26-325` here):
 * the read-only counterpart to the live mask above - every full-phone *display* site (this widget's
 * own visitor-bubble echo of a just-submitted phone, `widget.ts`'s `sendStructuredReply` call in
 * `appendMessageBubble`) renders through this rather than the raw wire string, so a number reads
 * `+7 (916) 222-22-22` wherever it is shown, not only while it is being typed. Reuses `maskRuNational`
 * - the identical grouping the live field itself renders - rather than a second, drifting notation.
 *
 * Anything that is not unambiguously a complete Russian number comes back unchanged - a foreign
 * number, an incomplete or malformed value, or a blank string. `ruNationalDigitsForDisplay` is the one
 * place that judgment is made; this function only asks it and falls back to `phone` verbatim on
 * `null` - never guesses a `+7` onto a number this widget did not itself establish as Russian.
 */
export function formatRuPhoneForDisplay(phone: string): string {
  const national = ruNationalDigitsForDisplay(phone);
  return national === null ? phone : maskRuNational(national);
}

/**
 * Direct port of `RuPhoneField.kt`'s private `ruNationalDigitsForDisplay`: `null` unless `raw`
 * unambiguously names a complete Russian number. A leading `+` has to be exactly `RU_PREFIX` to be
 * considered at all - a real, different country code (`+4758655828`, a Norwegian number whose digits,
 * stripped of the leading `+`, happen to also run exactly `NATIONAL_DIGIT_COUNT` long) must never be
 * reinterpreted as Russian just because digit-counting alone cannot otherwise tell the two apart. A
 * value with no `+` at all is judged on digit count alone, exactly as `ruNationalDigits` already does
 * for a value mid-edit: this widget's own canonical output, or a bare domestic number, never a
 * foreign number that also chose to omit its own country code.
 */
function ruNationalDigitsForDisplay(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) {
    if (!trimmed.startsWith(RU_PREFIX)) {
      return null;
    }
    const digits = trimmed.slice(RU_PREFIX.length).replace(/\D/g, "");
    return digits.length === NATIONAL_DIGIT_COUNT ? digits : null;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === NATIONAL_DIGIT_COUNT + 1 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return digits.slice(1);
  }
  if (digits.length === NATIONAL_DIGIT_COUNT) {
    return digits;
  }
  return null;
}
