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
  book: "Book",
  bookAnAppointment: "Book an appointment",
  backToConversation: "Back to the conversation",
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

  unsupportedFileTypeSuffix: "isn't supported. Try an image or a PDF.",
  unknownFileType: "unknown type",
  fileTooLarge: (maxMb) => `File is too large (max ${maxMb} MB).`,

  yourAnswer: "Your answer",
  continueLabel: "Continue",
  loadingAvailableTimes: "Loading available times…",

  nothingToBookYet: "There is nothing to book here yet.",
  whichCalendar: "Which calendar would you like to book?",
  notAnOption: "That is not one of the options.",
  withWorker: "with",
  whatIsYourPhoneNumber: "What is your phone number?",
  phoneNumberRequired: "A phone number is how the shop reaches you, so it cannot be left out.",
  namePrompt: "And your name? Leave it blank if you would rather not say.",
  bookingFinished: "This booking is finished.",
  whatWouldYouLikeToBook: "What would you like to book?",
  minutesUnit: (durationMinutes) => `(${durationMinutes} min)`,
  nobodyAvailable: "Nobody is available for that at the moment.",
  anyone: "Anyone",
  whoWouldYouLikeToSee: "Who would you like to see?",
  noFreeTimes: "There are no free times for that at the moment.",
  whenWouldYouLikeToCome: "When would you like to come?",
  youAreBookedPrefix: "You are booked: ",
  hereIsWhatIsStillFree: "Here is what is still free.",

  bookingUnavailable: "Booking is not available right now.",
  slotTaken: "Sorry, that time has just been taken.",
  tooManyBookingAttempts: "Too many booking attempts. Please wait a moment and try again.",
};
