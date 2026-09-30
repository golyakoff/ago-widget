import { describe, expect, it } from "vitest";
import {
  canonicalPhoneValue,
  canonicalRuPhone,
  digitCountForMaskedOffset,
  editPhoneInput,
  formatRuPhoneForDisplay,
  isExplicitNonRussianPhoneValue,
  isPhoneInputComplete,
  isRuPhoneComplete,
  maskedOffsetForDigitCount,
  maskRuNational,
  normalizeRuNationalDigits,
  ruNationalDigits,
} from "./phoneFormat.js";

// `26-325`/`26-327`: these mirror `ago-android`'s own `RuPhoneFieldTest`-shaped cases (the collapse
// examples the backlog spec itself names) - the point of this item is that the two platforms behave
// identically, so the same inputs are exercised here as would be on Android.
describe("normalizeRuNationalDigits", () => {
  it("keeps digits only", () => {
    expect(normalizeRuNationalDigits("9-1-6")).toBe("916");
  });

  it("drops one leading 8 when the run is longer than 10 digits", () => {
    expect(normalizeRuNationalDigits("89211234567")).toBe("9211234567");
  });

  it("drops one leading 7 when the run is longer than 10 digits", () => {
    expect(normalizeRuNationalDigits("79211234567")).toBe("9211234567");
  });

  it("does not drop a leading digit when the run is exactly 10 digits", () => {
    expect(normalizeRuNationalDigits("9211234567")).toBe("9211234567");
  });

  it("does not drop a leading digit that is not 7 or 8, even when the run is longer than 10", () => {
    // 11 digits, starts with 9 - truncated from the end, never from the front, since only a leading
    // 7/8 is ever read as a country-code marker.
    expect(normalizeRuNationalDigits("92112345678")).toBe("9211234567");
  });

  it("caps at 10 digits", () => {
    expect(normalizeRuNationalDigits("12345678901234")).toBe("1234567890");
  });
});

describe("ruNationalDigits", () => {
  it("strips a literal +7 lead before normalising", () => {
    expect(ruNationalDigits("+79161234567")).toBe("9161234567");
  });

  it("does not miscount a short value as carrying a leading country digit", () => {
    // "+7" + 3 digits is 4 digits total if the prefix were counted as one of them - nowhere near the
    // 11 normalizeRuNationalDigits needs to suspect a leading marker, but the explicit prefix strip
    // still has to remove the "7" itself rather than leaving it as the field's first "digit".
    expect(ruNationalDigits("+7916")).toBe("916");
  });

  it("collapses every shape the backlog spec names to the same 10 digits", () => {
    for (const raw of ["89211234567", "+7 921 123-45-67", "7 9211234567", "9211234567"]) {
      expect(ruNationalDigits(raw)).toBe("9211234567");
    }
  });
});

describe("canonicalRuPhone", () => {
  it("is blank for no digits", () => {
    expect(canonicalRuPhone("")).toBe("");
  });

  it("prefixes whatever digits it is given, complete or not", () => {
    expect(canonicalRuPhone("916")).toBe("+7916");
    expect(canonicalRuPhone("9161234567")).toBe("+79161234567");
  });
});

describe("isRuPhoneComplete", () => {
  it("is false with fewer than 10 national digits", () => {
    expect(isRuPhoneComplete("+791612")).toBe(false);
  });

  it("is true with exactly 10 national digits", () => {
    expect(isRuPhoneComplete("+79161234567")).toBe(true);
  });

  it("is true against a masked display value too, not only the canonical form", () => {
    expect(isRuPhoneComplete("+7 (916) 123-45-67")).toBe(true);
  });
});

describe("maskRuNational", () => {
  it("renders just the fixed prefix with no digits", () => {
    expect(maskRuNational("")).toBe("+7 ");
  });

  it("grows the mask one group at a time, closing punctuation the instant a group fills", () => {
    expect(maskRuNational("9")).toBe("+7 (9");
    expect(maskRuNational("916")).toBe("+7 (916) ");
    expect(maskRuNational("9161")).toBe("+7 (916) 1");
    expect(maskRuNational("916123")).toBe("+7 (916) 123-");
    expect(maskRuNational("91612345")).toBe("+7 (916) 123-45-");
    expect(maskRuNational("9161234567")).toBe("+7 (916) 123-45-67");
  });
});

describe("maskedOffsetForDigitCount / digitCountForMaskedOffset", () => {
  it("round-trip for every digit count from 0 to 10", () => {
    for (let count = 0; count <= 10; count += 1) {
      const offset = maskedOffsetForDigitCount(count);
      expect(digitCountForMaskedOffset(offset, 10)).toBe(count);
    }
  });

  it("0 digits sits right after the fixed '+7 ' lead", () => {
    expect(maskedOffsetForDigitCount(0)).toBe("+7 ".length);
  });

  it("an offset landing inside punctuation snaps forward to the next digit slot", () => {
    // Offset 8 sits between "916)" and " " (maskRuNational("916...").indexOf - the closing paren and
    // space after the first group) - the same "digits pushed forward" feel a masked field gives when
    // typing through inserted punctuation.
    const offsetRightAfterGroup1 = maskedOffsetForDigitCount(3);
    expect(digitCountForMaskedOffset(offsetRightAfterGroup1 + 1, 10)).toBe(4);
  });

  it("clamps a count above the national digit ceiling", () => {
    expect(maskedOffsetForDigitCount(999)).toBe(maskedOffsetForDigitCount(10));
  });
});

describe("isExplicitNonRussianPhoneValue", () => {
  it("is false for the empty value", () => {
    expect(isExplicitNonRussianPhoneValue("")).toBe(false);
  });

  it("is false for a bare '+' with no digits yet", () => {
    expect(isExplicitNonRussianPhoneValue("+")).toBe(false);
  });

  it("is false for a plain Russian-shaped value with no leading +", () => {
    expect(isExplicitNonRussianPhoneValue("9161234567")).toBe(false);
  });

  it("is false once an explicit +7 has been typed - still Russia", () => {
    expect(isExplicitNonRussianPhoneValue("+79161234567")).toBe(false);
  });

  it("is true the moment an explicit non-Russian country code is typed", () => {
    expect(isExplicitNonRussianPhoneValue("+1")).toBe(true);
  });

  it("is true for a fully-typed non-Russian number", () => {
    expect(isExplicitNonRussianPhoneValue("+15551234567")).toBe(true);
  });
});

describe("editPhoneInput", () => {
  it("returns blank for an empty field", () => {
    expect(editPhoneInput("", 0)).toEqual({ value: "", caret: 0 });
  });

  it("keeps a bare '+' as the escape hatch's own transitional first character", () => {
    expect(editPhoneInput("+", 1)).toEqual({ value: "+", caret: 1 });
  });

  it("bakes the fixed +7 into the mask from the very first RU-shaped digit", () => {
    // `contactCapture.ts`'s own pre-26-325 mask left "+7" to a separate chip and produced "(9" here -
    // the whole point of this item is that the prefix now lives inside the field itself.
    expect(editPhoneInput("9", 1)).toEqual({ value: "+7 (9", caret: 5 });
  });

  it("builds the full mask as digits accumulate, caret following the last typed digit", () => {
    const raw = "9161234567";
    expect(editPhoneInput(raw, raw.length)).toEqual({
      value: "+7 (916) 123-45-67",
      caret: "+7 (916) 123-45-67".length,
    });
  });

  it("normalises a pasted leading domestic 8, caret at the end", () => {
    const raw = "89161234567";
    expect(editPhoneInput(raw, raw.length)).toEqual({
      value: "+7 (916) 123-45-67",
      caret: "+7 (916) 123-45-67".length,
    });
  });

  it("re-derives the mask from the field's own previous output without doubling the prefix", () => {
    const raw = "+7 (916) 123-45-67";
    expect(editPhoneInput(raw, raw.length)).toEqual({ value: raw, caret: raw.length });
  });

  it("keeps the caret just past the digit that was typed when inserting in the middle", () => {
    // Typing "5" as the 2nd digit of an otherwise-complete number: "+7 (9" + "5" + "16...67" inserted
    // at caret 5 in "+7 (916) 123-45-67" gives 11 raw digits, truncated from the end to 10 - the caret
    // should still land right after the "5" that was just typed (2 digits precede it: "9", "5").
    const raw = "+7 (9516) 123-45-67";
    const edit = editPhoneInput(raw, 6);
    expect(edit.value).toBe("+7 (951) 612-34-56");
    expect(edit.caret).toBe(maskedOffsetForDigitCount(2));
  });

  it("lets an explicit non-Russian country code through unformatted, caret at the end", () => {
    const raw = "+1555";
    expect(editPhoneInput(raw, raw.length)).toEqual({ value: "+1555", caret: 5 });
  });

  it("caps a non-Russian number at the E.164 15-digit ceiling", () => {
    const raw = "+123456789012345678";
    const edit = editPhoneInput(raw, raw.length);
    expect(edit.value).toBe("+123456789012345");
    expect(edit.caret).toBe(edit.value.length);
  });

  it("self-heals if the fixed +7's own '+' is deleted while all 10 digits are present", () => {
    // A backspace landing exactly at offset 1 (right after "+") deletes the "+", leaving
    // "7 (916) 123-45-67" - normalizeRuNationalDigits' own "drop the leading 7/8 once the run exceeds
    // 10 digits" rule recovers the correct 10 national digits regardless, so the field re-renders the
    // untouched, still-complete mask rather than a mangled one.
    const raw = "7 (916) 123-45-67";
    const edit = editPhoneInput(raw, raw.length);
    expect(edit.value).toBe("+7 (916) 123-45-67");
  });
});

describe("canonicalPhoneValue", () => {
  it("is blank for nothing typed", () => {
    expect(canonicalPhoneValue("")).toBe("");
    expect(canonicalPhoneValue("+")).toBe("");
  });

  it("is the fixed prefix plus bare national digits, no punctuation, for a masked RU value", () => {
    expect(canonicalPhoneValue("+7 (916) 123-45-67")).toBe("+79161234567");
  });

  it("is the fixed prefix plus national digits even for a partial value", () => {
    expect(canonicalPhoneValue("+7 (91")).toBe("+791");
  });

  it("passes a foreign escape-hatch value through untouched", () => {
    expect(canonicalPhoneValue("+15551234567")).toBe("+15551234567");
  });

  it("trims surrounding whitespace", () => {
    expect(canonicalPhoneValue("  +7 (916) 123-45-67  ")).toBe("+79161234567");
  });
});

describe("isPhoneInputComplete", () => {
  it("is false for the empty value", () => {
    expect(isPhoneInputComplete("")).toBe(false);
  });

  it("is false for a partial RU number - not isNotBlank, exactly 10 digits", () => {
    expect(isPhoneInputComplete("+7 (91")).toBe(false);
  });

  it("is true once all 10 RU national digits are present", () => {
    expect(isPhoneInputComplete("+7 (916) 123-45-67")).toBe(true);
  });

  it("is true for any non-empty foreign escape-hatch value", () => {
    expect(isPhoneInputComplete("+1555")).toBe(true);
  });

  it("is false for a bare '+' with nothing typed after it", () => {
    expect(isPhoneInputComplete("+")).toBe(false);
  });
});

describe("formatRuPhoneForDisplay", () => {
  it("renders a complete canonical RU number as the grouped mask", () => {
    expect(formatRuPhoneForDisplay("+79162222222")).toBe("+7 (916) 222-22-22");
  });

  it("renders a bare 10-digit RU number (no +7) the same way", () => {
    expect(formatRuPhoneForDisplay("9162222222")).toBe("+7 (916) 222-22-22");
  });

  it("renders an 11-digit number with a leading domestic 8 the same way", () => {
    expect(formatRuPhoneForDisplay("89162222222")).toBe("+7 (916) 222-22-22");
  });

  it("passes a foreign number through unchanged, even though the digit count matches", () => {
    // Digits-only, +4758655828 has 10 digits after the +, the same length a bare RU national number
    // would - only the explicit, different +-prefix tells the two apart.
    expect(formatRuPhoneForDisplay("+4758655828")).toBe("+4758655828");
  });

  it("passes an incomplete value through unchanged", () => {
    expect(formatRuPhoneForDisplay("+7916")).toBe("+7916");
  });

  it("passes a blank value through unchanged", () => {
    expect(formatRuPhoneForDisplay("")).toBe("");
  });

  it("passes a server-side masked preview through unchanged - never real digits", () => {
    expect(formatRuPhoneForDisplay("+7 ··· 08")).toBe("+7 ··· 08");
  });
});
