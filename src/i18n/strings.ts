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
  readonly chatLabel: string;
  readonly chatWithUs: string;
  readonly connecting: string;
  readonly reconnecting: string;
  readonly disconnectedReconnecting: string;
  readonly messageAriaLabel: string;
  readonly typeAMessage: string;
  readonly send: string;
  readonly attachAFile: string;
  /** `23-61`: the reserved emoji place in the composer's second row - not a picker (out of scope for
   * that item), so this is a `title` on an inert, unfocusable placeholder, not a control's label. */
  readonly emojiComingSoon: string;
  /** `23-62`: the accessible name (and `title`) on the real «Сохранить диалог» button that fills the
   * place `23-61` reserved - a down-arrow icon carries no text of its own, so this is the whole of its
   * accessible name, the same "icon-only, name from `aria-label` alone" shape `send` already uses. */
  readonly saveConversation: string;
  /** `23-62`: shown as a system note (`renderSystemNote`, the same element a rejected file already
   * uses) when building or downloading the archive fails - a lazy module 404s, `CompressionStream`
   * throws, every attachment fetch fails. Never a thrown exception either way (embeddable-widget
   * skill: "never break the host page") - this is what the visitor sees instead of silence. */
  readonly saveConversationFailedNote: string;
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
  /** `16-04`: the link text next to the tenant's own processing-notice sentence - the widget's own
   * frame around a tenant-authored URL, the same "the widget owns the frame, the tenant owns the
   * content" split `downloadAttachment`'s own icon-plus-frame text already draws. The tenant's own
   * notice text itself is never a key in this table - it is per-site data from `WidgetConfig`, not a
   * fixed sentence this widget authors, so it is never translated (`ui/notice.ts`'s own remarks). */
  readonly processingNoticeLinkText: string;

  // attachments.ts - the courtesy upload checks.
  /** Appended after the quoted, untranslated MIME type: `` `"${type}" ${unsupportedFileTypeSuffix}` ``. */
  readonly unsupportedFileTypeSuffix: string;
  /** The fallback shown in place of a MIME type when the browser reports none - frame text, not data
   * read off the file, so it is translated like the rest of the sentence around it. */
  readonly unknownFileType: string;
  readonly fileTooLarge: (maxMb: number) => string;

  // ui/primitives/render.ts - the generic `form` primitive's fallback label and its submit button.
  // `20-07`: these two used to live under a "booking/panel.ts" heading because that was their only
  // caller; they are exactly as generic as the rest of this table now that a `form` step can arrive
  // from any module, and stay here rather than moving into a module's own lazily-loaded strings.
  readonly yourAnswer: string;
  readonly continueLabel: string;

  // `23-09`/`ui/contactCapture.ts` - the out-of-hours name-and-phone control. Deliberately its own
  // block, not folded into the `form` primitive's strings above - this control is not a primitive
  // (that file's own doc comment explains why), so its copy is not `adr/0065`'s vocabulary either.
  readonly contactCaptureNamePlaceholder: string;
  readonly contactCapturePhonePlaceholder: string;
  /** `23-58`: the third required field. */
  readonly contactCaptureEmailPlaceholder: string;
  /** `23-58`: the online entry point's own label - a light, link-like control under the visitor's own
   * first message, rendered by `ui/widget.ts`'s `appendVisitorIntroControl`. The trailing ellipsis is
   * part of the copy in both locales, not this table's punctuation - it is what tells a visitor the
   * control opens something rather than performing an action outright, the same convention
   * `continueLabel`'s own neighbours in this table do not need because a button's verb already says
   * enough. */
  readonly contactCaptureIntroLink: string;
  readonly contactCaptureSubmitButton: string;
  readonly contactCaptureSubmittingButton: string;
  /** Shown once the phone row (and, if typed, the name row) is recorded - deliberately does not
   * promise a specific time, only that somebody will follow up, matching `flows.md` 1.2's own "must
   * never happen: a promise nobody keeps." */
  readonly contactCaptureConfirmation: string;
  readonly contactCaptureFailedNote: string;
}
