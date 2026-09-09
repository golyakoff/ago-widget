// @vitest-environment node
// Pure logic, no DOM - and jsdom (this repo's default environment, vitest.config.ts) matters here
// for a reason worth recording: jsdom's own TextEncoder produces Uint8Array instances from a
// different JS realm than the ones this file builds directly, so toEqual(...) on two "identical"
// typed arrays fails on prototype identity alone (found live writing this test - Array.from() on
// both sides matched while toEqual did not, which is what pointed at the realm split rather than a
// real byte difference). The node environment has one realm, so the mismatch cannot occur.
import { afterEach, describe, expect, it, vi } from "vitest";
import { inflateRawSync } from "node:zlib";
import type { HistoryPage, MessageDto } from "../../protocol/types.js";
import { buildConversationArchive, buildTranscriptHtml, collectFullHistory } from "./archive.js";
import { saveConversationCopy } from "./copy.js";

function message(overrides: Partial<MessageDto> & Pick<MessageDto, "id" | "sequence">): MessageDto {
  return {
    authorKind: "Visitor",
    authorId: "88888888-8888-8888-8888-888888888888",
    body: `body ${overrides.id}`,
    createdAt: "2026-09-09T09:00:00+00:00",
    ...overrides,
  };
}

async function extractTranscriptText(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const method = view.getUint16(8, true);
  const compressedSize = view.getUint32(18, true);
  const nameLength = view.getUint16(26, true);
  const dataStart = 30 + nameLength;
  const raw = bytes.slice(dataStart, dataStart + compressedSize);
  const decoded = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
  return decoded.toString("utf8");
}

describe("collectFullHistory", () => {
  it("walks backward past the loaded page until the server reports no older messages", async () => {
    const known = [message({ id: "m5", sequence: 5 }), message({ id: "m6", sequence: 6 })];
    const calls: number[] = [];

    const fetchOlderPage = (beforeSequence: number): Promise<HistoryPage> => {
      calls.push(beforeSequence);
      if (beforeSequence === 5) {
        return Promise.resolve({
          messages: [message({ id: "m3", sequence: 3 }), message({ id: "m4", sequence: 4 })],
          nextBeforeSequence: 3,
        });
      }
      if (beforeSequence === 3) {
        return Promise.resolve({
          messages: [message({ id: "m1", sequence: 1 }), message({ id: "m2", sequence: 2 })],
          nextBeforeSequence: null,
        });
      }
      throw new Error(`unexpected beforeSequence ${beforeSequence}`);
    };

    const result = await collectFullHistory(known, fetchOlderPage, 2);

    expect(result.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
    // Exactly two pages, each walking strictly backward from the previous cursor - proof this is a
    // real multi-page walk, not a single lucky call that happened to return everything.
    expect(calls).toEqual([5, 3]);
  });

  it("returns nothing when the panel has never rendered a message", async () => {
    const result = await collectFullHistory(
      [],
      () => {
        throw new Error("must not be called");
      },
      50,
    );

    expect(result).toEqual([]);
  });

  it("stops after a fixed number of pages even if the server never terminates the walk", async () => {
    let calls = 0;
    const fetchOlderPage = (beforeSequence: number): Promise<HistoryPage> => {
      calls++;
      // A misbehaving server that always claims "one more page", strictly decreasing so the loop's
      // own progress guard never trips - only the page-count circuit breaker can stop this.
      return Promise.resolve({
        messages: [message({ id: `x${beforeSequence}`, sequence: beforeSequence - 1 })],
        nextBeforeSequence: beforeSequence - 1,
      });
    };

    await collectFullHistory([message({ id: "seed", sequence: 100_000 })], fetchOlderPage, 1);

    expect(calls).toBeLessThanOrEqual(200);
  });
});

describe("buildTranscriptHtml", () => {
  const copy = saveConversationCopy("en");

  it("renders only what the visitor could see: author label, body and timestamp, nothing else", () => {
    const messages = [
      message({ id: "v1", sequence: 1, authorKind: "Visitor", body: "Where is my order?" }),
      message({ id: "o1", sequence: 2, authorKind: "Operator", authorId: "op-secret-guid-0001", body: "On its way, arrives Friday." }),
    ];

    const html = buildTranscriptHtml(messages, copy, new Map());

    expect(html).toContain("Where is my order?");
    expect(html).toContain("On its way, arrives Friday.");
    expect(html).toContain(copy.visitorLabel);
    expect(html).toContain(copy.operatorLabel);

    // The boundary the backlog item itself draws: nothing beyond what a message's `body` already
    // says. An operator's own internal id is exactly the kind of fact that is on the wire but never
    // on the visitor's screen - proof it never reaches the file is that the raw id string is absent.
    expect(html).not.toContain("op-secret-guid-0001");
    expect(html).not.toContain("authorId");
    expect(html).not.toContain("clientMessageId");
  });

  it("escapes message bodies so a visitor's own text can never inject markup into the transcript", () => {
    const messages = [message({ id: "v1", sequence: 1, body: "<script>alert(1)</script>" })];
    const html = buildTranscriptHtml(messages, copy, new Map());

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("labels a System message as the automatic reply it is, not as an operator's own words", () => {
    const messages = [message({ id: "s1", sequence: 1, authorKind: "System", body: "We are offline right now." })];
    const html = buildTranscriptHtml(messages, copy, new Map());

    expect(html).toContain(copy.systemLabel);
    expect(html).not.toContain(copy.operatorLabel);
  });

  it("marks an attachment unavailable when no bundled entry exists for it, and links to it when one does", () => {
    const messages = [
      message({ id: "a1", sequence: 1, attachmentId: "att-1" }),
      message({ id: "a2", sequence: 2, attachmentId: "att-2" }),
    ];
    const html = buildTranscriptHtml(messages, copy, new Map([["att-1", "attachments/1-att1.png"]]));

    expect(html).toContain('href="attachments/1-att1.png"');
    expect(html).toContain(copy.attachmentUnavailable);
  });
});

describe("buildConversationArchive", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("produces a transcript covering the full multi-page history, not only the last-loaded page", async () => {
    const known = [message({ id: "recent", sequence: 10, body: "the last thing said" })];
    const fetchOlderPage = (beforeSequence: number): Promise<HistoryPage> => {
      if (beforeSequence === 10) {
        return Promise.resolve({
          messages: [message({ id: "older", sequence: 1, body: "the very first message" })],
          nextBeforeSequence: null,
        });
      }
      throw new Error(`unexpected beforeSequence ${beforeSequence}`);
    };

    const archive = await buildConversationArchive({
      knownMessages: known,
      fetchOlderPage,
      fetchAttachmentLocation: () => Promise.resolve(null),
      locale: "en",
      siteKey: "shop_demo",
      now: new Date("2026-09-09T12:34:00Z"),
    });

    const text = await extractTranscriptText(archive.blob);
    expect(text).toContain("the last thing said");
    expect(text).toContain("the very first message");
  });

  it("bundles an attachment's real bytes into the archive, not a link or a name only", async () => {
    const attachmentBytes = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252]);
    const known = [message({ id: "withFile", sequence: 1, attachmentId: "att-xyz" })];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        expect(url).toBe("https://storage.test.invalid/att-xyz");
        return Promise.resolve(new Response(attachmentBytes, { status: 200 }));
      }),
    );

    const archive = await buildConversationArchive({
      knownMessages: known,
      fetchOlderPage: () => Promise.resolve({ messages: [], nextBeforeSequence: null }),
      fetchAttachmentLocation: (attachmentId) => {
        expect(attachmentId).toBe("att-xyz");
        return Promise.resolve({ url: "https://storage.test.invalid/att-xyz", contentType: "image/png" });
      },
      locale: "en",
      siteKey: "shop_demo",
      now: new Date("2026-09-09T12:34:00Z"),
    });

    const zipBytes = new Uint8Array(await archive.blob.arrayBuffer());
    const view = new DataView(zipBytes.buffer);
    // Walk past the first (conversation.html) local entry to reach the attachment's own entry, then
    // decompress *its* bytes and compare them to what `fetchAttachmentLocation`'s URL would have
    // served - proving real content made it in, not merely an entry with a plausible name.
    const firstNameLength = view.getUint16(26, true);
    const firstCompressedSize = view.getUint32(18, true);
    const secondOffset = 30 + firstNameLength + firstCompressedSize;
    const secondNameLength = view.getUint16(secondOffset + 26, true);
    const secondMethod = view.getUint16(secondOffset + 8, true);
    const secondCompressedSize = view.getUint32(secondOffset + 18, true);
    const secondNameStart = secondOffset + 30;
    const secondName = new TextDecoder().decode(zipBytes.slice(secondNameStart, secondNameStart + secondNameLength));
    const secondDataStart = secondNameStart + secondNameLength;
    const raw = zipBytes.slice(secondDataStart, secondDataStart + secondCompressedSize);
    const data = secondMethod === 8 ? new Uint8Array(inflateRawSync(raw)) : raw;

    expect(secondName).toMatch(/^attachments\/1-/);
    expect(data).toEqual(attachmentBytes);
  }, 10_000);

  it("leaves an attachment out (never a thrown exception) when fetching its bytes fails", async () => {
    const known = [message({ id: "withFile", sequence: 1, attachmentId: "att-gone" })];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const archive = await buildConversationArchive({
      knownMessages: known,
      fetchOlderPage: () => Promise.resolve({ messages: [], nextBeforeSequence: null }),
      fetchAttachmentLocation: () => Promise.resolve({ url: "https://storage.test.invalid/gone", contentType: "image/png" }),
      locale: "en",
      siteKey: "shop_demo",
      now: new Date("2026-09-09T12:34:00Z"),
    });

    const text = await extractTranscriptText(archive.blob);
    expect(text).toContain(saveConversationCopy("en").attachmentUnavailable);
  });

  it("names the file after the site key and the timestamp, never anything from contact capture", async () => {
    const archive = await buildConversationArchive({
      knownMessages: [message({ id: "m1", sequence: 1 })],
      fetchOlderPage: () => Promise.resolve({ messages: [], nextBeforeSequence: null }),
      fetchAttachmentLocation: () => Promise.resolve(null),
      locale: "en",
      siteKey: "shop_demo",
      now: new Date("2026-09-09T12:34:00Z"),
    });

    expect(archive.filename).toBe("ago-chat-shop_demo-2026-09-09-12-34.zip");
  });
});
