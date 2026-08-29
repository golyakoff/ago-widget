import { describe, expect, it } from "vitest";
import { courtesyValidate } from "./attachments.js";
import { en } from "./i18n/en.js";
import { ru } from "./i18n/ru.js";

function fakeFile(type: string, size: number): File {
  return new File([new Uint8Array(size)], "test-file", { type });
}

describe("courtesyValidate", () => {
  it("accepts an allowed type under the size ceiling", () => {
    expect(courtesyValidate(fakeFile("image/png", 1024), en)).toBeNull();
  });

  it("rejects a disallowed content type", () => {
    expect(courtesyValidate(fakeFile("application/zip", 1024), en)).not.toBeNull();
  });

  it("rejects a file over the courtesy size ceiling", () => {
    expect(courtesyValidate(fakeFile("image/png", 11 * 1024 * 1024), en)).not.toBeNull();
  });

  it("accepts a file exactly at the size ceiling", () => {
    expect(courtesyValidate(fakeFile("application/pdf", 10 * 1024 * 1024), en)).toBeNull();
  });

  // `11-10`: the frame text around a rejection is translated - the type/size themselves are data
  // and stay untranslated (asserted by the numeric interpolation still appearing verbatim).
  it("rejects a disallowed content type in Russian when given the Russian string table", () => {
    const message = courtesyValidate(fakeFile("application/zip", 1024), ru);
    expect(message).toContain("не поддерживается");
    expect(message).toContain("application/zip");
  });

  it("rejects an oversized file in Russian when given the Russian string table, keeping the MB number", () => {
    const message = courtesyValidate(fakeFile("image/png", 11 * 1024 * 1024), ru);
    expect(message).toContain("слишком большой");
    expect(message).toContain("10");
  });
});
