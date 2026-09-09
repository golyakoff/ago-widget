// @vitest-environment node
// Pure logic, no DOM - and jsdom (this repo's default environment, vitest.config.ts) matters here
// for a reason worth recording: jsdom's own TextEncoder produces Uint8Array instances from a
// different JS realm than the ones this file builds directly, so toEqual(...) on two "identical"
// typed arrays fails on prototype identity alone (found live writing this test - Array.from() on
// both sides matched while toEqual did not, which is what pointed at the realm split rather than a
// real byte difference). The node environment has one realm, so the mismatch cannot occur.
import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { buildZip, crc32 } from "./zip.js";

/**
 * `23-62`: proves `buildZip` produces a *real* archive, not merely a blob whose entries have the
 * right names - by hand-parsing the local file headers back out of the produced bytes and comparing
 * the decompressed content to what went in. `node:zlib`'s `inflateRawSync` is the exact counterpart
 * of `zip.ts`'s own `CompressionStream("deflate-raw")` (both raw DEFLATE, no zlib wrapper) - a
 * dependency of this test file only, never shipped in the widget bundle (`build.mjs` never bundles
 * `*.test.ts`).
 */

interface ParsedEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  data: Uint8Array;
}

function parseLocalEntries(bytes: Uint8Array): ParsedEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ParsedEntry[] = [];
  let offset = 0;

  while (offset < bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    const raw = bytes.slice(dataStart, dataStart + compressedSize);
    const data = method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw;

    entries.push({ name, method, crc, compressedSize, uncompressedSize, data });
    offset = dataStart + compressedSize;
  }

  return entries;
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("buildZip", () => {
  it("round-trips a text entry and a binary entry with their real bytes intact", async () => {
    const html = new TextEncoder().encode("<html>hello, transcript</html>");
    // Not a real PNG - arbitrary bytes standing in for "attachment content", including a few bytes
    // that are not valid UTF-8 on their own, to prove this is byte-for-byte, not text-safe only.
    const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0x10, 0x20, 0x30]);

    const blob = await buildZip([
      { name: "conversation.html", data: html },
      { name: "attachments/1-abcd1234.png", data: binary },
    ]);

    const entries = parseLocalEntries(await blobBytes(blob));
    expect(entries).toHaveLength(2);

    const htmlEntry = entries.find((e) => e.name === "conversation.html");
    const binaryEntry = entries.find((e) => e.name === "attachments/1-abcd1234.png");
    expect(htmlEntry).toBeDefined();
    expect(binaryEntry).toBeDefined();

    expect(htmlEntry!.data).toEqual(html);
    expect(htmlEntry!.uncompressedSize).toBe(html.length);
    expect(htmlEntry!.crc).toBe(crc32(html));

    expect(binaryEntry!.data).toEqual(binary);
    expect(binaryEntry!.uncompressedSize).toBe(binary.length);
    expect(binaryEntry!.crc).toBe(crc32(binary));
  });

  it("stores rather than deflates an entry that would not shrink", async () => {
    // A single repeated byte deflates far smaller than it is; deliberately incompressible bytes
    // (crypto-quality randomness would also do, but a fixed pattern keeps this test deterministic)
    // exercise the "deflate did not help, fall back to store" branch `zip.ts` itself takes.
    const incompressible = new Uint8Array(64);
    for (let i = 0; i < incompressible.length; i++) {
      incompressible[i] = (i * 97 + 13) % 256;
    }

    const blob = await buildZip([{ name: "noise.bin", data: incompressible }]);
    const [entry] = parseLocalEntries(await blobBytes(blob));

    expect(entry!.data).toEqual(incompressible);
  });

  it("produces an empty, still-valid archive for zero entries", async () => {
    const blob = await buildZip([]);
    const bytes = await blobBytes(blob);
    const view = new DataView(bytes.buffer);

    // Just the end-of-central-directory record - 22 bytes, no local headers, no central directory.
    expect(bytes.length).toBe(22);
    expect(view.getUint32(0, true)).toBe(0x06054b50);
  });
});

describe("crc32", () => {
  it("matches the well-known test vector for the ASCII string \"123456789\"", () => {
    // The standard CRC-32 (ISO 3309/ITU-T V.42, the same polynomial ZIP uses) conformance vector.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
