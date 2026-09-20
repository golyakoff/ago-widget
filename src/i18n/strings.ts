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
  /** `25-141`: the closed launcher's accessible name once `ui/widget.ts`'s `unreadCount` is greater
   * than zero - replaces `openChat` above for exactly that state, so a screen-reader visitor learns
   * the same fact the sighted-only `.ago-unread-badge` (`ui/styles.ts`) already shows. A function
   * like `fileTooLarge` below, not a fixed string, for the identical reason that one is: a number has
   * to sit inside an otherwise-translated sentence. */
  readonly openChatWithUnreadCount: (count: number) => string;
  readonly chatLabel: string;
  readonly chatWithUs: string;
  readonly connecting: string;
  readonly reconnecting: string;
  readonly disconnectedReconnecting: string;
  readonly messageAriaLabel: string;
  readonly typeAMessage: string;
  readonly send: string;
  readonly attachAFile: string;
  /** `25-120`: the accessible name on the real emoji-picker trigger button that fills the place
   * `23-61` reserved and deferred - icon-only (a real Material Symbols Outlined SVG since `25-127`,
   * `ui/widget.ts`'s own remarks), so this is the whole of its accessible name, the same shape
   * `attachAFile`/`saveConversation` already use. Replaces `23-61`'s `emojiComingSoon`, whose
   * "(coming soon)" wording stopped being true the moment this item shipped. */
  readonly insertEmoji: string;
  /** `25-120`: the accessible name on the picker panel itself (`role="grid"`) - what a screen reader
   * announces on entering the grid `insertEmoji` above opens. */
  readonly emojiPickerLabel: string;
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
  /** `25-61`: shown instead of `sendFailedNote` - never alongside it, never falling back to it - when
   * a send failed specifically because the conversation had already closed (`ui/widget.ts`'s
   * `completeSend`, matching `VisitorHub.SendAsync`'s `"Conversation.InvalidState: "`-prefixed
   * rejection). A closed conversation is not "the send failed"; it is "there is nothing left to send
   * to," which is the distinction this whole backlog item exists to make visible to the visitor. */
  readonly conversationEndedNote: string;
  /** The word only - `ui/widget.ts` builds `` `${uploading} ${percent}%` `` itself, keeping the
   * number interpolation out of this table (Out of scope: number formatting is not this item's job). */
  readonly uploading: string;
  readonly uploadFailedNote: string;
  readonly downloadAttachment: string;
  readonly attachmentUnavailable: string;
  /** `25-80`: shown instead of `attachmentUnavailable` - never alongside it - for the one download
   * failure that is permanent rather than retryable: the server's `Attachment.Removed` (HTTP 410,
   * `23-80`). Every other failure a download can have (a still-`Pending` upload, a network error,
   * the API unreachable) keeps `attachmentUnavailable`, unchanged - `ago-console`'s own
   * `conversationAttachmentDeleted` draws the identical distinction for an operator; this is its
   * visitor-facing counterpart, the gap `25-80`'s own backlog item names. */
  readonly attachmentRemoved: string;
  readonly attachmentAlt: string;
  readonly publicDemoNotice: string;
  readonly privateDemoNotice: string;
  /** `16-04`: the link text next to the tenant's own processing-notice sentence - the widget's own
   * frame around a tenant-authored URL, the same "the widget owns the frame, the tenant owns the
   * content" split `downloadAttachment`'s own icon-plus-frame text already draws. The tenant's own
   * notice text itself is never a key in this table - it is per-site data from `WidgetConfig`, not a
   * fixed sentence this widget authors, so it is never translated (`ui/notice.ts`'s own remarks). */
  readonly processingNoticeLinkText: string;
  /** `25-149`: the accessible name on the channel-switcher card's own `role="group"` region - what a
   * screen reader announces on entering the group of channel rows plus the "stay here" row beside
   * them. The individual channel names inside it (`Telegram`, `MAX`, `VK`, `WhatsApp`) are never a key
   * in this table - they are proper nouns, the identical "the widget owns the frame, not the content"
   * split `processingNoticeLinkText` already draws for a tenant's own URL, just for a brand name
   * instead of a tenant's own words. */
  readonly channelSwitcherGroupLabel: string;
  /** `25-149`: the card's own final row, visually distinct from the channel rows above it (no brand
   * colour) - falls through to the ordinary in-page conversation. Hides the card, marks it dismissed
   * and focuses the composer; sends nothing and never forces a connection (`adr/0148`). */
  readonly channelSwitcherWriteInChat: string;

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
  /** Shown once the phone row (and, if typed, the name row) is recorded - the widget's own default,
   * used whenever the tenant has not configured `WidgetConfig.ContactCaptureConfirmationText`
   * (`25-129`, `ui/appearance.ts`'s `parseContactCaptureConfirmationText`). Carries a `{name}`
   * placeholder (`ui/contactCapture.ts` substitutes the visitor's own just-submitted name) - the same
   * placeholder syntax a tenant's own override text uses. `25-129`: before this item this was the
   * only sentence there was, and it promised a callback ("we'll get back to you") the visitor is
   * already mid-conversation with nobody about to separately honour - `flows.md` 1.2's own "must
   * never happen: a promise nobody keeps" is exactly the defect this default replaces, not merely
   * words this default happens to differ from. */
  readonly contactCaptureConfirmation: string;
  readonly contactCaptureFailedNote: string;
  /** `25-28`: shown in the same `errorNote` element as `contactCaptureFailedNote`, when the typed
   * email fails `emailValidation.ts`'s own regex check - the one field-level failure this control
   * surfaces to the visitor rather than just refusing to submit, because unlike a merely-empty
   * required field a visitor who typed *something* has no other way to notice it was rejected. */
  readonly contactCaptureEmailInvalidNote: string;

  // `8-13`: `demo/boot.ts`'s `applyOwnTenantPageCopy` - the two sentences a minted tenant's own demo
  // page swaps into its static markup, replacing text that would otherwise tell that visitor a
  // stranger can read what they type. These lived as English literals in `boot.ts` itself until
  // `8-13`; that file has no `WidgetLocale` to resolve against (it runs standalone, before the widget
  // it injects ever calls home). `25-187`: `boot.ts` fixed the lookup at `"ru"` once `public-demo-2/`
  // (the only page that ever needed the English table) was deleted - see `applyOwnTenantPageCopy`'s
  // own doc comment.
  /** The page's own top banner - was `ago-demo-public-notice`'s public-demo wording, false the moment
   * the tenant stops being shared. */
  readonly demoOwnTenantBannerNotice: string;
  /** The safety card's privacy paragraph - `ago-demo-privacy-note`, present only on `demo-shop1`. */
  readonly demoOwnTenantPrivacyNote: string;
}
