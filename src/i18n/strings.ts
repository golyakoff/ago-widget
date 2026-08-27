/**
 * `11-10`: the widget's whole translated vocabulary, in one flat interface - a small string table,
 * not an i18n framework (the backlog item's own instruction: "plain per-locale maps ... no
 * client-side locale negotiation"). One file rather than one per module (`ui/widget.ts`,
 * `attachments.ts`, `booking/*.ts`) because every caller needs exactly this one object, resolved once
 * at boot (`resolve.ts`'s `getStrings`) and threaded through by constructor/function parameter - the
 * same "small, explicit, no hidden global" shape this widget already uses for `WidgetConfig` itself.
 *
 * Almost every field is a plain string. The handful that are functions exist only where a number has
 * to sit inside an otherwise-translated sentence (a percentage, a file-size ceiling, a duration) -
 * `Out of scope` in the backlog item is locale-sensitive number/date *formatting*, not "never
 * interpolate a number", so these stay simple string-building functions rather than reaching for a
 * templating engine.
 */
export interface WidgetStrings {
  // ui/widget.ts - the launcher, panel chrome and connection/composer states.
  readonly openChat: string;
  readonly closeChat: string;
  /** The panel's own `aria-label` ("Chat"), and the booking button's text once booking is showing
   * (also "Chat" - "back to the conversation"). One key for both: they are the same word doing the
   * same job ("this is the chat"), not two English words that happen to collide. */
  readonly chatLabel: string;
  readonly chatWithUs: string;
  readonly book: string;
  readonly bookAnAppointment: string;
  readonly backToConversation: string;
  readonly connecting: string;
  readonly reconnecting: string;
  readonly disconnectedReconnecting: string;
  readonly messageAriaLabel: string;
  readonly typeAMessage: string;
  readonly send: string;
  readonly attachAFile: string;
  readonly previousChatExpired: string;
  readonly chatUnavailable: string;
  readonly sessionExpired: string;
  readonly sendOutcomeUnknownNote: string;
  readonly notConnectedRetryNote: string;
  readonly sendFailedNote: string;
  /** The word only - `ui/widget.ts` builds `` `${uploading} ${percent}%` `` itself, keeping the
   * number interpolation out of this table (Out of scope: number formatting is not this item's job). */
  readonly uploading: string;
  readonly uploadFailedNote: string;
  readonly downloadAttachment: string;
  readonly attachmentUnavailable: string;
  readonly attachmentAlt: string;
  readonly publicDemoNotice: string;
  readonly privateDemoNotice: string;
  /** `14-04`'s label on an automatic reply bubble. Threaded through as a CSS custom property
   * (`--ago-auto-reply-label`), not a DOM text node - `ui/styles.ts`'s own remarks explain why: the
   * label is a `content:` pseudo-element string, the same mechanism `--ago-accent` already uses for
   * the site's color. */
  readonly autoReplyLabel: string;

  // attachments.ts - the courtesy upload checks.
  /** Appended after the quoted, untranslated MIME type: `` `"${type}" ${unsupportedFileTypeSuffix}` ``. */
  readonly unsupportedFileTypeSuffix: string;
  /** The fallback shown in place of a MIME type when the browser reports none - frame text, not data
   * read off the file, so it is translated like the rest of the sentence around it. */
  readonly unknownFileType: string;
  readonly fileTooLarge: (maxMb: number) => string;

  // booking/panel.ts
  readonly yourAnswer: string;
  readonly continueLabel: string;
  readonly loadingAvailableTimes: string;

  // booking/flow.ts - every step body and retry message the flow itself produces.
  readonly nothingToBookYet: string;
  readonly whichCalendar: string;
  readonly notAnOption: string;
  /** The connector between a formatted slot and the worker's own (untranslated) display name -
   * `` `${formatSlot(slot)} ${withWorker} ${slot.workerDisplayName}.` ``. */
  readonly withWorker: string;
  readonly whatIsYourPhoneNumber: string;
  readonly phoneNumberRequired: string;
  readonly namePrompt: string;
  readonly bookingFinished: string;
  readonly whatWouldYouLikeToBook: string;
  /** `` `(${n} min)` `` - the service-duration suffix next to an (untranslated) service name. */
  readonly minutesUnit: (durationMinutes: number) => string;
  readonly nobodyAvailable: string;
  readonly anyone: string;
  readonly whoWouldYouLikeToSee: string;
  readonly noFreeTimes: string;
  readonly whenWouldYouLikeToCome: string;
  readonly youAreBookedPrefix: string;
  readonly hereIsWhatIsStillFree: string;

  // booking/calendarClient.ts - the three fixed failure messages a visitor can see.
  readonly bookingUnavailable: string;
  readonly slotTaken: string;
  readonly tooManyBookingAttempts: string;
}
