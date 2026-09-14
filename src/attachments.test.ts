import { describe, expect, it } from "vitest";
import { AttachmentRejectedError, courtesyValidate, getAttachmentDownload } from "./attachments.js";
import { en } from "./i18n/en.js";
import { ru } from "./i18n/ru.js";
import type { WidgetConfig } from "./config.js";

function fakeFile(type: string, size: number): File {
  return new File([new Uint8Array(size)], "test-file", { type });
}

const config: WidgetConfig = {
  siteKey: "shop_test",
  apiBaseUrl: "https://api.test.invalid",
  demoNotice: "none",
  policyBaseUrl: "https://office.test.invalid",
  scriptUrl: "https://cdn.test.invalid/dist/widget.js",
};

function fakeFetch(response: Response): typeof fetch {
  return () => Promise.resolve(response);
}

describe("courtesyValidate", () => {
  it("accepts an allowed type under the size ceiling", () => {
    expect(courtesyValidate(fakeFile("image/png", 1024), en)).toBeNull();
  });

  it("rejects a disallowed content type", () => {
    expect(courtesyValidate(fakeFile("application/zip", 1024), en)).not.toBeNull();
  });

  it("rejects a file over the courtesy size ceiling", () => {
    expect(courtesyValidate(fakeFile("image/png", 6 * 1024 * 1024), en)).not.toBeNull();
  });

  it("accepts a file exactly at the size ceiling", () => {
    expect(courtesyValidate(fakeFile("application/pdf", 5 * 1024 * 1024), en)).toBeNull();
  });

  // `11-10`: the frame text around a rejection is translated - the type/size themselves are data
  // and stay untranslated (asserted by the numeric interpolation still appearing verbatim).
  it("rejects a disallowed content type in Russian when given the Russian string table", () => {
    const message = courtesyValidate(fakeFile("application/zip", 1024), ru);
    expect(message).toContain("не поддерживается");
    expect(message).toContain("application/zip");
  });

  it("rejects an oversized file in Russian when given the Russian string table, keeping the MB number", () => {
    const message = courtesyValidate(fakeFile("image/png", 6 * 1024 * 1024), ru);
    expect(message).toContain("слишком большой");
    expect(message).toContain("5");
  });
});

/**
 * `25-80`: `getAttachmentDownload` is where the server's stable RFC 7807 `type` slug first reaches
 * this widget - `AttachmentRejectedError.code` is what carries it out to `renderAttachmentInto`'s
 * catch, which is the thing this item actually changes. These tests are the narrow, fast proof that
 * the code survives the HTTP round trip correctly; `ui/widget.test.ts`'s "the download-failure
 * message renderAttachmentInto shows" is the end-to-end proof that it then chooses the right
 * sentence.
 */
describe("getAttachmentDownload's error code", () => {
  it("carries the server's `type` when the response is a 410 Attachment.Removed problem+json body", async () => {
    const response = new Response(JSON.stringify({ type: "Attachment.Removed", title: "The attachment has been deleted." }), {
      status: 410,
      headers: { "Content-Type": "application/problem+json" },
    });

    await expect(getAttachmentDownload(config, "token", "attachment-1", fakeFetch(response))).rejects.toMatchObject({
      code: "Attachment.Removed",
    });
  });

  it("carries a different `type` unchanged for a still-Pending upload (400 Attachment.NotReady)", async () => {
    const response = new Response(JSON.stringify({ type: "Attachment.NotReady", title: "Not ready yet." }), {
      status: 400,
      headers: { "Content-Type": "application/problem+json" },
    });

    await expect(getAttachmentDownload(config, "token", "attachment-1", fakeFetch(response))).rejects.toMatchObject({
      code: "Attachment.NotReady",
    });
  });

  it("is null when the body carries no `type` field at all", async () => {
    const response = new Response(JSON.stringify({ title: "Something went wrong." }), {
      status: 500,
      headers: { "Content-Type": "application/problem+json" },
    });

    await expect(getAttachmentDownload(config, "token", "attachment-1", fakeFetch(response))).rejects.toMatchObject({
      code: null,
    });
  });

  it("is null when the body is not problem+json at all (a proxy error page)", async () => {
    const response = new Response("<html>502 Bad Gateway</html>", { status: 502 });

    await expect(getAttachmentDownload(config, "token", "attachment-1", fakeFetch(response))).rejects.toMatchObject({
      code: null,
    });
  });

  it("throws AttachmentRejectedError, not a plain Error, so callers can branch on `code` at all", async () => {
    const response = new Response(JSON.stringify({ type: "Attachment.Removed" }), { status: 410 });

    try {
      await getAttachmentDownload(config, "token", "attachment-1", fakeFetch(response));
      expect.unreachable("getAttachmentDownload should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AttachmentRejectedError);
    }
  });
});
