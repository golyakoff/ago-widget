import { describe, expect, it } from "vitest";
import { courtesyValidate } from "./attachments.js";

function fakeFile(type: string, size: number): File {
  return new File([new Uint8Array(size)], "test-file", { type });
}

describe("courtesyValidate", () => {
  it("accepts an allowed type under the size ceiling", () => {
    expect(courtesyValidate(fakeFile("image/png", 1024))).toBeNull();
  });

  it("rejects a disallowed content type", () => {
    expect(courtesyValidate(fakeFile("application/zip", 1024))).not.toBeNull();
  });

  it("rejects a file over the courtesy size ceiling", () => {
    expect(courtesyValidate(fakeFile("image/png", 11 * 1024 * 1024))).not.toBeNull();
  });

  it("accepts a file exactly at the size ceiling", () => {
    expect(courtesyValidate(fakeFile("application/pdf", 10 * 1024 * 1024))).toBeNull();
  });
});
