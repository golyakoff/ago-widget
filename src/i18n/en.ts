import type { WidgetStrings } from "./strings.js";

/**
 * `11-10`: the widget's built-in language, byte-for-byte the strings this bundle has always rendered
 * before this item existed - `resolve.ts`'s `parseWidgetLocale` falls back to this table for every
 * site that predates `WidgetLocale`, which is what makes "no `WidgetLocale` set renders identically to
 * before this item" true rather than merely intended.
 */
export const en: WidgetStrings = {
  openChat: "Open chat",
  closeChat: "Close chat",
  chatLabel: "Chat",
  chatWithUs: "Chat with us",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  disconnectedReconnecting: "Disconnected. Trying to reconnect…",
  messageAriaLabel: "Message",
  typeAMessage: "Type a message…",
  send: "Send",
  attachAFile: "Attach a file",
  previousChatExpired:
    "Your previous chat has expired, so this is a new conversation. Anything you sent before is no longer shown here.",
  chatUnavailable: "Chat is unavailable right now. Please try again later.",
  sessionExpired: "This chat session has expired. Reload the page to start a new one.",
  sendOutcomeUnknownNote: "Not sure this was sent - the connection dropped mid-request.",
  notConnectedRetryNote: "Not sent - reconnecting. It will not be retried automatically.",
  sendFailedNote: "Failed to send.",
  uploading: "Uploading…",
  uploadFailedNote: "Couldn't send the attachment.",
  downloadAttachment: "📎 Download attachment",
  attachmentUnavailable: "Attachment unavailable.",
  attachmentAlt: "Attachment",
  // `8-06`: the sentence a stranger on `demo-shop1`/`demo-shop2` must have read before typing. Three
  // short statements of fact, no hedging and no reassurance - the backlog item's own point is that a
  // polite banner people skim is worth less than a blunt one they finish reading. `8-11` did not
  // touch a word of it - what changed is *when* it appears (attached to the tenant, not the page).
  publicDemoNotice:
    "This is a public demo. Anyone who opens the demo operator console can read what you type here. Do not type anything real.",
  // `8-11`: the same sentence's counterpart on a minted tenant. Precise rather than generous - "only
  // the operator login you were given", not "nobody else" - and no "do not type anything real" (that
  // would recreate the contradiction this sentence exists to remove). The lifetime is a fixed phrase,
  // not a formatted timestamp: the widget is not told the expiry, and a second copy of that number
  // here could disagree with `8-09`'s panel, which renders it exactly.
  privateDemoNotice:
    "This is your own demo tenant. Only the operator login you were given can read this conversation, and the tenant deletes itself after about a day.",
  autoReplyLabel: "Automatic reply",
  processingNoticeLinkText: "Read more",

  unsupportedFileTypeSuffix: "isn't supported. Try an image or a PDF.",
  unknownFileType: "unknown type",
  fileTooLarge: (maxMb) => `File is too large (max ${maxMb} MB).`,

  yourAnswer: "Your answer",
  continueLabel: "Continue",
};
