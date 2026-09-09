/**
 * `23-62`: a minimal, dependency-free ZIP writer - the whole reason this file exists rather than a
 * `npm install` for one. The backlog item's own "Where this is likely to go wrong" named the choice
 * explicitly: "a small zip library, or the browser's own `CompressionStream`, is not the same
 * footprint as a PDF renderer, but it is not zero either". `CompressionStream("deflate-raw")` is a
 * platform API (Baseline across every browser this widget targets, no polyfill) that happens to
 * produce **exactly** the byte stream the ZIP format's "deflate" compression method (8) already
 * expects - "raw" deflate, i.e. without the zlib wrapper a plain `"deflate"` stream would add. What is
 * missing between "a deflate stream" and "a valid .zip" is the container format itself (local file
 * headers, a central directory, the end-of-central-directory record) and the CRC-32 checksum ZIP
 * stores per entry - neither is exposed by any Web API, and both are small, well-specified binary
 * layouts, not a reason to add a dependency whose own footprint (most zip libraries on npm bundle
 * their *own* deflate implementation, duplicating what `CompressionStream` already gives for free)
 * would cost more of the 45 KB gzipped budget than writing the ~200 lines below.
 *
 * **Graceful degrade, not a hard requirement.** `CompressionStream` is fed through a `try`; a browser
 * that lacks it (or whose implementation throws) falls back to the ZIP "store" method (0, i.e.
 * uncompressed) for that entry - still a completely valid archive, just a larger one. This is the
 * embeddable-widget skill's "never break the host page" applied one level down: the feature degrades
 * to "a bigger file", never to "no file at all", for a browser gap this widget cannot fix.
 */

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

/** CRC-32 (ISO 3309 / ITU-T V.42), the exact algorithm the ZIP format's own local file header and
 * central directory both require per entry - computed over the *uncompressed* bytes, always. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Attempts raw-deflate compression via the platform's own `CompressionStream`. `null` means "not
 * available, or it failed" - the caller's cue to fall back to storing the entry uncompressed rather
 * than let a missing/broken browser API abort the whole archive. */
async function tryDeflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") {
    return null;
  }

  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

export interface ZipEntryInput {
  /** Forward slashes, no leading slash - the ZIP format's own convention, and what every unarchiver
   * (the OS's built-in one included) expects for a nested path like `attachments/…`. */
  readonly name: string;
  readonly data: Uint8Array;
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
/** General-purpose bit 11 - "the file name and comment fields are UTF-8" (the ZIP format's own
 * appendix D). Set unconditionally: an attachment's entry name is built from an opaque id (never a
 * visitor-supplied file name - `archive.ts`'s own remarks on why nothing here can carry one), but the
 * transcript's own name and any future non-ASCII entry name should not silently corrupt under a
 * reader that assumes CP437 without this bit. */
const UTF8_NAMES_FLAG = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const VERSION_NEEDED = 20;

function writeUint32LE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function writeUint16LE(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

/** MS-DOS date/time, the field every ZIP structure below carries - not because a saved transcript's
 * archive needs a precise mtime (nothing reads it back), only because the format has no "omit this"
 * option. A fixed epoch (1980-01-01, DOS's own earliest representable date) rather than `Date.now()`:
 * the archive's *content* already carries every real timestamp that matters (each message's own
 * `createdAt`, rendered into the HTML transcript), so a second, entry-level clock reading would be
 * one more fact for a file-diff-based reviewer to wonder about for no reason - two builds of the
 * identical conversation should produce byte-identical archives.
 */
function dosDateTime(): { date: number; time: number } {
  return { date: (1 << 5) | 1, time: 0 };
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Builds a valid, minimal `.zip` from in-memory entries - no streaming, no data descriptors (every
 * entry's size and CRC are known before its header is written, since the whole archive already lives
 * in memory by the time `archive.ts` calls this), no archive comment. One local file header + body
 * per entry, followed by one central directory, closed by one end-of-central-directory record -
 * exactly the three sections the ZIP format (and every reader of it) requires and nothing else.
 */
export async function buildZip(entries: readonly ZipEntryInput[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const { date, time } = dosDateTime();

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const deflated = await tryDeflateRaw(entry.data);
    const useDeflate = deflated !== null && deflated.length < entry.data.length;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const compressed = useDeflate ? deflated : entry.data;

    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    writeUint32LE(localView, 0, LOCAL_FILE_HEADER_SIGNATURE);
    writeUint16LE(localView, 4, VERSION_NEEDED);
    writeUint16LE(localView, 6, UTF8_NAMES_FLAG);
    writeUint16LE(localView, 8, method);
    writeUint16LE(localView, 10, time);
    writeUint16LE(localView, 12, date);
    writeUint32LE(localView, 14, crc);
    writeUint32LE(localView, 18, compressed.length);
    writeUint32LE(localView, 22, entry.data.length);
    writeUint16LE(localView, 26, nameBytes.length);
    writeUint16LE(localView, 28, 0);

    localParts.push(localHeader, nameBytes, compressed);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32LE(centralView, 0, CENTRAL_DIRECTORY_SIGNATURE);
    writeUint16LE(centralView, 4, VERSION_NEEDED);
    writeUint16LE(centralView, 6, VERSION_NEEDED);
    writeUint16LE(centralView, 8, UTF8_NAMES_FLAG);
    writeUint16LE(centralView, 10, method);
    writeUint16LE(centralView, 12, time);
    writeUint16LE(centralView, 14, date);
    writeUint32LE(centralView, 16, crc);
    writeUint32LE(centralView, 20, compressed.length);
    writeUint32LE(centralView, 24, entry.data.length);
    writeUint16LE(centralView, 28, nameBytes.length);
    writeUint16LE(centralView, 30, 0);
    writeUint16LE(centralView, 32, 0);
    writeUint16LE(centralView, 34, 0);
    writeUint16LE(centralView, 36, 0);
    writeUint32LE(centralView, 38, 0);
    writeUint32LE(centralView, 42, offset);

    centralParts.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + compressed.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectory = concat(centralParts);

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  writeUint32LE(eocdView, 0, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writeUint16LE(eocdView, 4, 0);
  writeUint16LE(eocdView, 6, 0);
  writeUint16LE(eocdView, 8, entries.length);
  writeUint16LE(eocdView, 10, entries.length);
  writeUint32LE(eocdView, 12, centralDirectory.length);
  writeUint32LE(eocdView, 16, centralDirectoryOffset);
  writeUint16LE(eocdView, 20, 0);

  return new Blob([...localParts, centralDirectory, eocd] as BlobPart[], { type: "application/zip" });
}
