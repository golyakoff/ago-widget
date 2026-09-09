import type { HistoryPage, MessageDto } from "../../protocol/types.js";
import type { SupportedLocale } from "../../i18n/resolve.js";
import { saveConversationCopy, type SaveConversationCopy } from "./copy.js";
import { buildZip, type ZipEntryInput } from "./zip.js";

/**
 * `23-62`: builds the whole downloadable file - the lazily-loaded half of «Сохранить диалог» (the
 * button and its click wiring stay in `ui/widget.ts`, the base bundle, exactly as `20-07`'s booking
 * chip already splits "the click target" from "what a click actually does"). Loaded via
 * `ui/moduleLoader.ts`'s runtime `import()` on first click, never on page load, never on open - a
 * visitor who never saves a conversation downloads none of this (`bundleInputs.test.ts` is what
 * proves the base bundle stays free of it, the same guarantee the booking module already has).
 *
 * Every dependency this function needs from the widget or the network arrives as a plain parameter -
 * no import of `ui/widget.ts`, `connection.ts` or `attachments.ts` anywhere in this module, on
 * purpose: a module that reached back into the base bundle's own classes could not be loaded and
 * tested in isolation the way `archive.test.ts` does, and would make "what does this module actually
 * touch" a question only a full build could answer.
 */

export interface AttachmentLocation {
  readonly url: string;
  readonly contentType: string;
}

export interface BuildConversationArchiveInput {
  /** Every message this panel has already rendered (the initial history page, and every message that
   * has arrived live since), in any order - the seed set {@link collectFullHistory} walks *backward*
   * from to reach whatever the visitor never scrolled to. Passing only this and nothing "newer" is
   * deliberate: nothing arrives on this connection after the visitor clicks save without also calling
   * `appendMessageBubble` first, so the caller's own map is already complete on the "recent" side. */
  readonly knownMessages: readonly MessageDto[];
  /** `VisitorConnection.loadOlderHistory`, bound to this one conversation - the exact hub call a
   * scroll-triggered "load more" would use once one exists, reused rather than a second history
   * mechanism invented for this feature alone. Scoping to a single conversation is not this
   * function's job to enforce: the visitor's own hub connection can only ever answer for the
   * conversation its token was issued against (`connection.ts`'s own remarks on that trust boundary),
   * so "no other visitor's conversation" is a server-side guarantee this call inherits, not one this
   * module re-checks. */
  readonly fetchOlderPage: (beforeSequence: number, pageSize: number) => Promise<HistoryPage>;
  /** Resolves a presigned download location for one attachment, or `null` if the lookup itself failed
   * - `ui/widget.ts`'s own `getAttachmentDownload` call, the same one `renderAttachmentInto` already
   * makes for an inline bubble, reused rather than a second attachment-fetch mechanism. */
  readonly fetchAttachmentLocation: (attachmentId: string) => Promise<AttachmentLocation | null>;
  readonly locale: SupportedLocale;
  /** `WidgetConfig.siteKey` - already public (embeddable-widget skill's Bootstrap section: "the site
   * key is public"), and the one identifier the file name is allowed to carry, per the backlog item's
   * "the file name should not be more revealing than it needs to be". Nothing from
   * `ui/contactCapture.ts` (a visitor's own name/phone/email) has a parameter here to travel through
   * at all. */
  readonly siteKey: string;
  /** Injected rather than read via `new Date()` inside this function - a clock is a call argument,
   * not an ambient global, the identical reasoning the platform's own `IClock` exists for on the
   * backend, applied to the one wall-clock read this module makes (the file name's own timestamp). */
  readonly now: Date;
  readonly pageSize?: number;
}

export interface ConversationArchive {
  readonly blob: Blob;
  readonly filename: string;
}

const DEFAULT_PAGE_SIZE = 50;
/** A circuit breaker, not an expected conversation length. Each iteration only continues while the
 * server hands back a strictly older cursor than the one just asked for; a server that stopped
 * honouring that contract would otherwise spin this loop forever on a visitor's own click. */
const MAX_HISTORY_PAGES = 200;

/**
 * Walks backward from the oldest message already known, one `fetchOlderPage` call at a time, until
 * the server reports no older page - "the conversation" means everything the visitor could see, not
 * only whatever page happened to be loaded when they clicked save (the backlog item's own "Where this
 * is likely to go wrong"). Returns every message, deduplicated by id, oldest first.
 */
export async function collectFullHistory(
  knownMessages: readonly MessageDto[],
  fetchOlderPage: BuildConversationArchiveInput["fetchOlderPage"],
  pageSize: number,
): Promise<MessageDto[]> {
  const byId = new Map<string, MessageDto>();
  let oldestSequence = Number.POSITIVE_INFINITY;
  for (const message of knownMessages) {
    byId.set(message.id, message);
    if (message.sequence < oldestSequence) {
      oldestSequence = message.sequence;
    }
  }

  if (!Number.isFinite(oldestSequence)) {
    // Nothing has ever rendered in this panel - an empty conversation, or a save attempted before
    // the first history page resolved. Nothing to walk backward from.
    return [];
  }

  let cursor = oldestSequence;
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const result = await fetchOlderPage(cursor, pageSize);
    for (const message of result.messages) {
      byId.set(message.id, message);
    }

    if (result.nextBeforeSequence === null || result.nextBeforeSequence >= cursor) {
      break;
    }

    cursor = result.nextBeforeSequence;
  }

  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

function extensionFor(contentType: string): string {
  return EXTENSION_BY_CONTENT_TYPE[contentType] ?? "";
}

/** The first 8 hex characters of the attachment's own id - enough to make two attachments in the same
 * archive tell apart at a glance in a file listing, never the whole GUID a screenshot of the archive's
 * contents would otherwise spell out in full for no reader's benefit. */
function shortId(attachmentId: string): string {
  return attachmentId.replace(/-/g, "").slice(0, 8);
}

/**
 * Fetches one attachment's real bytes from its presigned URL. `null` on any failure - an expired URL,
 * a network error, or **a storage origin that does not grant this cross-origin `fetch()` CORS access**
 * (nothing in this repository's `IFileStorage`/MinIO setup configures a CORS policy on the bucket
 * today, unlike the plain `<img src>`/`<a href>` navigation `renderAttachmentInto` uses, which needs
 * none - a browser's `fetch()` does). Every one of those degrades identically: this attachment's bytes
 * are left out of the archive and the transcript says so (`attachmentUnavailable`), never a thrown
 * exception that would abort the whole save over one unreachable file.
 */
async function fetchAttachmentBytes(url: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array | null> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return null;
    }

    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TRANSCRIPT_CSS =
  "body{font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:40rem;" +
  "margin:2rem auto;padding:0 1rem;color:#111}" +
  ".message{margin:0 0 1rem;padding:0.5rem 0.75rem;border-radius:0.5rem;background:#f3f4f6}" +
  ".message--visitor{background:#e0f2fe;margin-left:2rem}" +
  ".message--operator{background:#f3f4f6;margin-right:2rem}" +
  ".message--system{background:#fef3c7}" +
  ".meta{font-size:0.75rem;color:#6b7280;margin-bottom:0.25rem}" +
  ".body{white-space:pre-wrap;word-break:break-word}" +
  ".attachment{margin-top:0.375rem;font-size:0.875rem}" +
  ".attachment--unavailable{color:#6b7280;font-style:italic}";

/** `contentKind`-carrying messages (`adr/0065`'s primitives - choice lists, forms, confirmation
 * cards) render richly in the live panel (`ui/primitives/render.ts`) but fall back to plain `body`
 * text whenever that content is absent or unrecognised - that renderer's own contract. This transcript
 * always takes that same fallback path deliberately: `body` is guaranteed to be the human-readable
 * text of *any* message, primitive or plain, so a static, mail-client-safe HTML file never needs to
 * reproduce this widget's own interactive rendering (buttons, radio choices) to still say the same
 * thing a primitive's body already says. */
function renderMessageRow(
  message: MessageDto,
  copy: SaveConversationCopy,
  attachmentEntryNames: ReadonlyMap<string, string>,
): string {
  // `23-64`: `"AutoGreeting"` reads as `"Operator"` here too - the identical author's-own-decision
  // reasoning `ui/widget.ts`'s `renderBubble` states for the live panel, restated for the saved
  // transcript so a downloaded copy never disagrees with what the visitor actually saw on screen.
  const label =
    message.authorKind === "Visitor"
      ? copy.visitorLabel
      : message.authorKind === "Operator" || message.authorKind === "AutoGreeting"
        ? copy.operatorLabel
        : copy.systemLabel;
  const cssClass = message.authorKind === "AutoGreeting" ? "operator" : message.authorKind.toLowerCase();
  const attachmentHtml = message.attachmentId ? renderAttachmentRow(message.attachmentId, copy, attachmentEntryNames) : "";

  return (
    `<div class="message message--${cssClass}">` +
    `<div class="meta">${escapeHtml(label)} &middot; ${escapeHtml(message.createdAt)}</div>` +
    `<div class="body">${escapeHtml(message.body)}</div>` +
    attachmentHtml +
    `</div>`
  );
}

function renderAttachmentRow(
  attachmentId: string,
  copy: SaveConversationCopy,
  attachmentEntryNames: ReadonlyMap<string, string>,
): string {
  const entryName = attachmentEntryNames.get(attachmentId);
  if (entryName === undefined) {
    return `<div class="attachment attachment--unavailable">${escapeHtml(copy.attachmentUnavailable)}</div>`;
  }

  // A relative link into this same archive's own `attachments/` entry - opening `conversation.html`
  // straight out of the extracted `.zip` resolves it on disk, no server and no expired presigned URL
  // involved, which is the entire point `23-62`'s decision names: "a saved conversation whose
  // attachment links have expired by the time it is opened is a worse copy than a larger file".
  return `<div class="attachment"><a href="${escapeHtml(entryName)}">${escapeHtml(copy.attachmentLabel)}</a></div>`;
}

function buildTranscriptHtml(
  messages: readonly MessageDto[],
  copy: SaveConversationCopy,
  attachmentEntryNames: ReadonlyMap<string, string>,
): string {
  const rows = messages.map((message) => renderMessageRow(message, copy, attachmentEntryNames)).join("\n");
  return (
    `<!doctype html>\n<html lang="${copy.htmlLang}">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(copy.documentTitle)}</title>\n<style>${TRANSCRIPT_CSS}</style>\n</head>\n<body>\n` +
    `<h1>${escapeHtml(copy.documentTitle)}</h1>\n<div class="transcript">\n${rows}\n</div>\n</body>\n</html>\n`
  );
}

function buildFilename(siteKey: string, now: Date): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const safeSiteKey = siteKey.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  return `ago-chat-${safeSiteKey || "conversation"}-${stamp}.zip`;
}

/**
 * Assembles the whole archive: walks the full history backward from what is already known, pulls
 * every attachment's real bytes (never only its name or a link that can expire), renders the visible
 * transcript as one self-contained HTML file, and zips the two together. Never throws for a *partial*
 * failure (one attachment unreachable) - only `buildZip`'s own platform-API surface
 * (`Blob`/`TextEncoder`, universal) or a `fetchOlderPage`/`fetchAttachmentLocation` rejection the
 * caller did not itself guard can still reject this promise, which is exactly what lets
 * `ui/widget.ts`'s own `saveConversation` show `saveConversationFailedNote` instead of nothing.
 */
export async function buildConversationArchive(input: BuildConversationArchiveInput): Promise<ConversationArchive> {
  const messages = await collectFullHistory(input.knownMessages, input.fetchOlderPage, input.pageSize ?? DEFAULT_PAGE_SIZE);
  const copy = saveConversationCopy(input.locale);

  const entries: ZipEntryInput[] = [];
  const attachmentEntryNames = new Map<string, string>();

  for (const message of messages) {
    const attachmentId = message.attachmentId;
    if (!attachmentId || attachmentEntryNames.has(attachmentId)) {
      continue;
    }

    const location = await input.fetchAttachmentLocation(attachmentId);
    if (location === null) {
      continue;
    }

    const bytes = await fetchAttachmentBytes(location.url);
    if (bytes === null) {
      continue;
    }

    const entryName = `attachments/${message.sequence}-${shortId(attachmentId)}${extensionFor(location.contentType)}`;
    attachmentEntryNames.set(attachmentId, entryName);
    entries.push({ name: entryName, data: bytes });
  }

  const html = buildTranscriptHtml(messages, copy, attachmentEntryNames);
  entries.unshift({ name: "conversation.html", data: new TextEncoder().encode(html) });

  const blob = await buildZip(entries);
  return { blob, filename: buildFilename(input.siteKey, input.now) };
}

// Exported for `archive.test.ts` only - the transcript builder's own boundary (what is in it, what is
// deliberately never in it) is worth proving directly against a `MessageDto[]`, without re-deriving a
// whole `ConversationArchive` and parsing a `.zip` back apart for every case.
export { buildTranscriptHtml };
