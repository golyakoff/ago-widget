import type { MessageDto } from "../protocol/types.js";
import type { WidgetConfig } from "../config.js";
import { WidgetStorage, type VisitorSession } from "../storage.js";
import { VisitorSessionExpiredError, VisitorSessionManager } from "../session.js";
import { sendBeacon } from "../beacon.js";
import { NotConnectedError, SendOutcomeUnknownError, VisitorConnection, type ConnectionState } from "../connection.js";
import { newClientMessageId } from "../protocol/dedup.js";
import { courtesyValidate, createAttachment, confirmAttachment, getAttachmentDownload, uploadToPresignedUrl } from "../attachments.js";
import { recordContactDetail } from "../contactDetails.js";
import { getConsentRequirement, recordConsent, type ConsentRequirement } from "../consent.js";
import { createShadowHost } from "./shadow-root.js";
import { FocusTrap } from "./focus-trap.js";
import { logWidgetError, guardAsync } from "../errors.js";
import { parseNoticeText, parseNoticeUrl, parseWidgetColor, parseWidgetPosition } from "./appearance.js";
import { renderPrimitiveContent } from "./primitives/render.js";
import { renderContactCaptureControl, type ContactCaptureResult } from "./contactCapture.js";
import { loadModule } from "./moduleLoader.js";
import { en } from "../i18n/en.js";
import { getStrings, parseWidgetLocale, type SupportedLocale } from "../i18n/resolve.js";
import type { WidgetStrings } from "../i18n/strings.js";
// `20-07`: type-only, so it never adds an input to the base bundle (`isolatedModules`/esbuild strip
// `import type` before the bundler's own module graph sees it) - the one place in this file allowed
// to say "booking" is `loadBookingModuleChip` below, which names the lazy chunk's file name and
// nothing else about it.
import type { ModuleChipSpec } from "../modules/booking/chip.js";

/**
 * `8-06`/`8-11`: the two fixed demo sentences a stranger on `demo-shop1`/`demo-shop2` (public) or a
 * tenant minted by `8-07`'s button (private) must have read before typing - three short statements of
 * fact for the public case, a precise reassurance plus the tenant's own disposability for the private
 * one. Full reasoning for both sentences' wording stays where it always has: `i18n/en.ts`'s own
 * `publicDemoNotice`/`privateDemoNotice` doc comments.
 *
 * `11-10`: the two sentences moved out of this file and into `i18n/en.ts`/`ru.ts` as the first two
 * entries in the widget's new string table - they were always fixed text owned by the widget rather
 * than passed in from the host page (`config.ts` explains why the script tag carries an enum and not
 * a string), which is exactly what belongs in the string table alongside every other widget-owned
 * sentence, translated the same way.
 */
function createDemoNotice(text: string): HTMLDivElement {
  const notice = document.createElement("div");
  notice.className = "ago-notice";
  // `role="note"`, not a live region: it is present before the visitor interacts at all, so there is
  // nothing to announce - it is read in document order like the rest of the panel.
  notice.setAttribute("role", "note");
  notice.textContent = text;
  return notice;
}

/**
 * `16-04`: the tenant's own processing notice - who processes what a visitor is about to write, and
 * a link to read more. Built empty and `hidden` in the constructor (this widget's config is not known
 * synchronously the way `config.demoNotice` is - it arrives on the handshake response `bootstrapSession`
 * awaits), then populated and revealed by `applyProcessingNotice` once that response resolves. Kept as
 * its own element, positioned identically to `createDemoNotice`'s own result (directly under the
 * header, outside `.ago-messages`) rather than folded into it: the demo notice is this widget's own
 * fixed sentence about *our* pages, always in `this.strings`; this one is per-tenant data from
 * `WidgetConfig`, never translated (`i18n/strings.ts`'s own remarks on `processingNoticeLinkText`), and
 * a site can show either, both, or neither.
 */
function createProcessingNotice(): HTMLDivElement {
  const notice = document.createElement("div");
  notice.className = "ago-processing-notice";
  notice.setAttribute("role", "note");
  notice.hidden = true;
  return notice;
}

/**
 * Assembles the widget's whole visible surface inside one Shadow DOM root. This is intentionally
 * one class rather than a component framework: the panel has a fixed, small set of views (closed,
 * connecting, open) and pulling in a UI framework's runtime for that would blow the bundle budget
 * a hand-rolled ~200 lines of DOM code does not (embeddable-widget skill's Bundle budget rule).
 */
export class ChatWidget {
  private readonly storage: WidgetStorage;
  private readonly sessionManager: VisitorSessionManager;
  private readonly host: HTMLDivElement;
  private readonly root: ShadowRoot;
  private readonly container: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  /** `11-10`: null exactly when `config.demoNotice === "none"` (a real shop's embed) - the same
   * three-state read `applyStrings` re-does to keep this element's text in the site's real language,
   * see that method's own remarks for the bug this field exists to close. */
  private readonly notice: HTMLDivElement | null;
  /** `16-04`: never `null` - unlike `notice` above, this element always exists (so its position in the
   * DOM is stable from the constructor onward) and is simply `hidden` until `applyProcessingNotice`
   * has something to show. See that method for why "exists but hidden" beats "created on demand" here. */
  private readonly processingNotice: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly messages: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly attachButton: HTMLButtonElement;
  /** `23-61`: the composer's second row, reserved rather than built - an emoji picker and
   * «Сохранить диалог» (`23-62`) are each their own item. Plain `<span>`s, never `<button>`: no
   * `href`/`tabindex`/click handler, so neither is part of the tab order and neither is reachable by
   * keyboard as though it were a control - the same shape `23-31` used for the console's own reserved
   * nav entries (a `<span aria-disabled="true">`, `ago-console`'s `AppShell.tsx`), followed here
   * rather than invented fresh. `aria-disabled="true"` names what is there (a place, not yet a
   * control) without hiding it from assistive tech the way `aria-hidden` would. */
  private readonly emojiPlaceholder: HTMLSpanElement;
  private readonly savePlaceholder: HTMLSpanElement;
  private readonly fileInput: HTMLInputElement;
  private readonly focusTrap: FocusTrap;
  /** `20-07`: `null` unless the site's own handshake response grants booking. Nullable is what
   * makes "a shop without booking pays nothing" a property of the object graph rather than a
   * promise - and even once non-null, its label stays empty and it stays `hidden` until
   * `loadBookingModuleChip` below has the lazy module's own copy, so no calendar-flavored copy
   * exists anywhere before that bundle is actually fetched. Clicking it does not open a second view
   * - it inserts and sends a trigger phrase exactly as if the visitor had typed it (`invokeModule`),
   * so nothing else in this class's own state changes because of it.
   *
   * `23-105`: used to be decided synchronously in the constructor, off `config.bookingModuleEnabled`
   * - itself read from the tenant's own `data-booking` attribute, the fact `config.ts`'s own remarks
   * explain is no longer the tenant's page to assert. The decision moved to `loadBookingModuleChip`,
   * which awaits the handshake response and only then creates and inserts this element - so
   * `moduleChip` is still `null` for the entire synchronous part of construction, and this field
   * stays `readonly` in spirit (`loadBookingModuleChip` is the one place that ever assigns it, at
   * most once, mirroring how the constructor used to be the one place that did). */
  private moduleChip: HTMLButtonElement | null = null;
  private readonly composer: HTMLFormElement;
  /** `11-10`: the widget's own built-in language until `bootstrapSession` resolves the site's real
   * one (`applyStrings`'s own doc comment). Every piece of DOM this class builds is constructed
   * against whatever `this.strings` holds at the time - initially this English default, so "no
   * `WidgetLocale` set" renders identically to before this item existed. */
  private strings: WidgetStrings = en;
  /** `20-07`: mirrors `this.strings` one level down - `applyStrings` sets both from the same
   * resolved value. A lazily-loaded module owns its own tiny string table keyed by this same
   * `SupportedLocale` (`modules/booking/chip.ts`) rather than reading `WidgetStrings`, so the base
   * bundle's own string table never grows a module's copy - this is the one piece of resolved
   * locale state a module needs and the base bundle already has. */
  private locale: SupportedLocale = "en";

  private connection: VisitorConnection | null = null;
  private connectPromise: Promise<void> | null = null;
  /** `11-03`: kicked off eagerly from the constructor (not lazily on first open) - see
   * `bootstrapSession`'s own doc comment for why. `connect()` awaits this same promise rather than
   * calling `getOrCreateVisitorSession` a second time. */
  private readonly sessionPromise: Promise<VisitorSession>;
  private session: VisitorSession | null = null;
  private conversationId: string | null = null;
  private isOpen = false;
  private isConnected = false;
  /** `23-07`: at most one `open` beacon per session (this widget instance's own lifetime), never one
   * per click - see `open()`'s own doc comment. */
  private openBeaconSent = false;
  /** `17-07`: set once the server has refused to renew this visitor's token mid-session. Terminal
   * for this page load - see `handleSessionExpired` for why the widget stops rather than quietly
   * minting a second identity underneath a transcript that belongs to the first. */
  private isSessionExpired = false;
  /**
   * The optimistic bubble for each message this panel has sent and not yet seen come back, keyed by
   * the `clientMessageId` it was sent under.
   *
   * `5-17`: a `Map` keyed by that id, not the array-and-`shift()` this used to be. The array paired
   * an echo with a bubble by *queue position*, which is only correct while every entry is eventually
   * matched by exactly one echo - one failed send offset the pairing permanently, so every later
   * echo removed the bubble before the one it belonged to: the failure notice vanished and the
   * message that did send rendered twice. The id was already on the wire in both directions
   * (`5-12`); nothing compared it to anything.
   *
   * Entries are removed by exactly two things: the echo that matches them (`handleIncoming`), and a
   * send failing in a way that means the server never saw it (`dispatchSend`). An unconfirmed send
   * is deliberately neither - see `dispatchSend`'s `SendOutcomeUnknownError` branch.
   */
  private readonly pendingSends = new Map<string, HTMLDivElement>();

  /**
   * `23-09`/`23-58`: `true` once the contact form has actually been rendered by *either* of its two
   * entry points - the out-of-hours auto-reply (`14-04`'s `System` message, unchanged since `23-09`)
   * or `23-58`'s online link under the visitor's own first message - so that at most one is ever
   * active in a conversation. `SendOfflineAutoReplyHandler`'s own loop guard makes a second `System`
   * message unreachable, so the out-of-hours side of this only ever needs "once, not per-message";
   * `23-58` is what makes "once per open panel" load-bearing across *two* triggers rather than one.
   * `appendVisitorIntroControl` deliberately does *not* set this the moment the link appears - only a
   * click (or the out-of-hours path pre-empting it, see the `System` branch in `appendMessageBubble`)
   * does, because the link on its own has not yet shown the form it is named for.
   */
  private contactCaptureShown = false;

  /**
   * `23-58`: guards the online entry point's own trigger separately from `contactCaptureShown` above -
   * "has a link already been offered under *a* visitor message" is a different question from "has the
   * form been shown," precisely because showing the link does not set `contactCaptureShown`. Without
   * this flag, every subsequent visitor message would grow its own link.
   */
  private visitorIntroControlOffered = false;

  /**
   * `23-58`: the link's own container, kept so the out-of-hours branch in `appendMessageBubble` can
   * remove it the moment a `System` auto-reply supersedes it - an unclicked link left in the DOM next
   * to the real form would be a second, dead entry point into the same control.
   */
  private visitorIntroControlEl: HTMLElement | null = null;

  constructor(private readonly config: WidgetConfig) {
    this.storage = new WidgetStorage(config.siteKey);
    this.sessionManager = new VisitorSessionManager(config, this.storage);
    const { host, root } = createShadowHost();
    this.host = host;
    this.root = root;

    const container = document.createElement("div");
    container.className = "ago-root";
    this.container = container;

    this.toggle = document.createElement("button");
    this.toggle.type = "button";
    this.toggle.className = "ago-toggle";
    this.toggle.setAttribute("aria-haspopup", "dialog");
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.setAttribute("aria-label", this.strings.openChat);
    this.toggle.textContent = "💬";
    this.toggle.addEventListener("click", () => this.toggleOpen());

    this.panel = document.createElement("div");
    this.panel.className = "ago-panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-modal", "false");
    this.panel.setAttribute("aria-label", this.strings.chatLabel);
    this.panel.hidden = true;
    this.panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.close();
      }
    });

    const header = document.createElement("div");
    header.className = "ago-header";
    this.title = document.createElement("h1");
    this.title.textContent = this.strings.chatWithUs;
    this.closeButton = document.createElement("button");
    this.closeButton.type = "button";
    this.closeButton.className = "ago-close";
    this.closeButton.setAttribute("aria-label", this.strings.closeChat);
    this.closeButton.textContent = "✕";
    this.closeButton.addEventListener("click", () => this.close());

    // `20-07`: **one script tag, one launcher, one panel, one transcript.** Booking is no longer a
    // second view swapped in over the conversation (`20-06`'s `BookingPanel`) - it is the
    // conversation, carried by ordinary chat messages (`ui/primitives/render.ts`). This chip is
    // purely an invocation shortcut: clicking it sends the module's trigger phrase, exactly as if
    // the visitor had typed it themselves (`invokeModule`), and everything that follows renders
    // inline in `.ago-messages` like any other message.
    //
    // `23-105`: nothing built here any more - `moduleChip` stays `null` until
    // `loadBookingModuleChip` learns the site actually has a grant, so a shop with no booking still
    // pays for exactly nothing here, the same "absent entirely" property this element always had.
    header.append(this.title, this.closeButton);

    // `8-06`: directly under the header and outside `.ago-messages`, so it is the first thing read
    // when the panel opens and cannot be scrolled away by the conversation underneath it. Not
    // dismissible: the thing it warns about (typing something real) is available on every keystroke,
    // not once at open time, so a close button would only ever remove the warning from the exact
    // moment it applies. Not a `.ago-message--system` bubble either - a bubble reads as chat history
    // and scrolls off with it.
    // `8-11`: three states, and the default is silence. A real shop's embed asks for neither
    // sentence and gets neither.
    const noticeText =
      config.demoNotice === "public" ? this.strings.publicDemoNotice
      : config.demoNotice === "private" ? this.strings.privateDemoNotice
      : null;
    this.notice = noticeText === null ? null : createDemoNotice(noticeText);

    // `16-04`: directly under the demo notice (if any) and outside `.ago-messages`, for the identical
    // reason `8-06`'s own comment states - the first thing read when the panel opens, never scrollable
    // away, present before the visitor can type anything (the composer below stays disabled until
    // connected regardless, so there is no race to win here, only a DOM position to get right).
    this.processingNotice = createProcessingNotice();

    this.messages = document.createElement("div");
    this.messages.className = "ago-messages";
    // aria-live for incoming messages (embeddable-widget skill's accessibility baseline) -
    // "polite" so a message does not interrupt whatever the visitor is doing right now.
    this.messages.setAttribute("aria-live", "polite");
    this.messages.setAttribute("role", "log");

    this.status = document.createElement("div");
    this.status.className = "ago-status";
    this.status.textContent = this.strings.connecting;

    const composer = document.createElement("form");
    composer.className = "ago-composer";
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      this.sendCurrentMessage();
    });

    this.input = document.createElement("textarea");
    this.input.className = "ago-input";
    this.input.rows = 1;
    this.input.setAttribute("aria-label", this.strings.messageAriaLabel);
    this.input.placeholder = this.strings.typeAMessage;
    this.input.disabled = true;
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.sendCurrentMessage();
      }
    });
    this.input.addEventListener("input", () => this.updateSendButtonEnabled());

    // `23-61`: icon-only now (no visible label), so the accessible name has to come from
    // `aria-label` alone - textContent carries only the glyph. `aria-label` wins the accessible-name
    // computation over text content regardless, the same rule `attachButton` below already relies on
    // for its own emoji-plus-label shape; this is that same pattern applied to `send`, not a new one.
    this.sendButton = document.createElement("button");
    this.sendButton.type = "submit";
    this.sendButton.className = "ago-send";
    this.sendButton.setAttribute("aria-label", this.strings.send);
    this.sendButton.textContent = "➤";
    this.sendButton.disabled = true;

    // A native file picker, not a drag-and-drop zone or a custom widget - the skill's
    // accessibility baseline (keyboard reachable) is free with `<input type="file">` and would
    // need to be rebuilt by hand for anything fancier, for a feature this item does not ask for.
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.className = "ago-file-input";
    this.fileInput.accept = "image/png,image/jpeg,image/gif,image/webp,application/pdf";
    this.fileInput.addEventListener("change", () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = ""; // same file picked twice in a row still fires `change`
      if (file) {
        this.handleFileSelected(file);
      }
    });

    this.attachButton = document.createElement("button");
    this.attachButton.type = "button";
    this.attachButton.className = "ago-attach";
    this.attachButton.setAttribute("aria-label", this.strings.attachAFile);
    this.attachButton.textContent = "📎";
    this.attachButton.disabled = true;
    this.attachButton.addEventListener("click", () => this.fileInput.click());

    this.emojiPlaceholder = this.buildReservedComposerPlace("🙂", this.strings.emojiComingSoon);
    this.savePlaceholder = this.buildReservedComposerPlace("💾", this.strings.saveConversationComingSoon);

    // `23-61`: the field's own full-width row, alone - the composer's whole reason for existing is
    // this field, and `.ago-composer-row` styling (`ui/styles.ts`) is what actually widens it, this
    // is only what stops the send button from sharing the row `attachButton` used to narrow it from.
    // Send stays beside the field rather than moving to the row below with `attachButton`: it is "the
    // one control that must never become hard to hit" (the backlog item's own words), so it stays
    // where a visitor's eye already is the moment they finish typing, not one row further down.
    const composerRow = document.createElement("div");
    composerRow.className = "ago-composer-row";
    composerRow.append(this.input, this.sendButton);

    // `23-61`: the second row - attach (moved down from the row above) plus the two reserved places,
    // in the backlog item's own order (attach, emoji, save).
    const composerControls = document.createElement("div");
    composerControls.className = "ago-composer-controls";
    composerControls.append(this.attachButton, this.fileInput, this.emojiPlaceholder, this.savePlaceholder);

    composer.append(composerRow, composerControls);
    this.panel.append(header);
    if (this.notice) {
      this.panel.append(this.notice);
    }
    this.panel.append(this.processingNotice);

    this.composer = composer;
    this.panel.append(this.messages, this.status, composer);

    container.append(this.panel, this.toggle);
    this.root.appendChild(container);

    this.focusTrap = new FocusTrap(this.panel);

    // `11-03`: fired here, not on first open - see `bootstrapSession`'s own doc comment. Stored so
    // `connect()` can await the same in-flight (or already-resolved) request instead of calling
    // `getOrCreateVisitorSession` a second time; wrapped in `guardAsync` so a failure here (visitor
    // never opens the widget at all, so `connect()` never gets a chance to observe or report it)
    // cannot surface as an `unhandledrejection` on the host page.
    this.sessionPromise = this.bootstrapSession();
    guardAsync(async () => {
      await this.sessionPromise;
    });

    // `20-07`: kicked off here, not on first open and not on chip click - "when the widget's config
    // says a module chip should render" (the item's own words). `23-105`: that fact moved from the
    // script tag to the handshake response, so it is no longer knowable at this point in the
    // constructor - called unconditionally now, and `loadBookingModuleChip` itself awaits
    // `sessionPromise` before deciding whether to build the chip at all. Never touches
    // `src/modules/` statically - that method's own doc comment explains why the base bundle stays
    // unaffected either way, whether or not the lazy chunk is ever actually fetched.
    guardAsync(() => this.loadBookingModuleChip());
  }

  /**
   * `23-07`: the load beacon fires here, before and independently of `bootstrapSession`
   * (`this.sessionPromise`, kicked off from the constructor rather than here) - a mount whose session
   * bootstrap goes on to fail (a rejected mint, a network error) still honestly counts as a load: this
   * method's own job is "attach the widget's DOM to the host page", which by definition already
   * happened by the time this call is reached. `sendBeacon` is fire-and-forget (that function's own
   * doc comment), so this method's own signature and behaviour are otherwise unchanged.
   */
  mount(parent: HTMLElement): void {
    parent.appendChild(this.host);
    sendBeacon(this.config, fetch, "load");
  }

  /**
   * `11-03`: resolves the visitor's identity and applies the site's widget config (color, launcher
   * position) to the closed, not-yet-opened launcher - this has to happen before any interaction,
   * since the position affects where the toggle button itself renders, not just the panel a click
   * would reveal. Reuses `VisitorSessionManager.start`'s storage short-circuit for a returning
   * visitor (that method's own doc comment states the three paths it can take).
   *
   * The brief window between mount and this promise resolving renders with the widget's own built-in
   * appearance (this class's own CSS defaults) - for a first-time visitor this is a real network
   * round trip, typically well under the time it takes a person to notice or react, and for a
   * returning visitor with a token nowhere near expiry it resolves synchronously-fast from storage
   * with no request at all.
   *
   * `17-07`: this is also where the widget says something when a returning visitor's identity could
   * not be carried over. `restarted` means the stored token was past renewing, so a *new*
   * `VisitorId` was minted and the previous conversation is not reachable from this browser any
   * more. The note is written into the message list here rather than at open time so it sits above
   * whatever the (new, empty) conversation goes on to contain, and it is written only for a visitor
   * who actually lost something - never for a first-ever arrival.
   *
   * `11-10`: also where the widget's own language resolves, in the same place and at the same time as
   * color and position - `applyStrings` is called *first*, before the `restarted` note, so that note
   * itself already renders in the resolved language rather than this widget's built-in default. There
   * is no reason to delay it: `session.widgetLocale` is already in hand at this point, the same way
   * `session.widgetPosition`/`widgetPrimaryColorHex` are already in hand for the two lines below it.
   */
  private async bootstrapSession(): Promise<VisitorSession> {
    const { session, restarted } = await this.sessionManager.start();
    this.session = session;
    const locale = parseWidgetLocale(session.widgetLocale);
    this.locale = locale;
    this.applyStrings(locale);

    if (restarted) {
      this.renderSystemNote(this.strings.previousChatExpired);
    }

    this.container.classList.toggle("ago-position-left", parseWidgetPosition(session.widgetPosition) === "bottom-left");
    const color = parseWidgetColor(session.widgetPrimaryColorHex);
    if (color) {
      this.host.style.setProperty("--ago-accent", color);
    }

    this.applyProcessingNotice(session.widgetNoticeText, session.widgetNoticeUrl);

    return session;
  }

  /**
   * `16-04`: populates and reveals `this.processingNotice` from the resolved handshake, or leaves it
   * hidden - the widget's own default, matching "a default notice written by AGO would be AGO
   * asserting a legal position on the tenant's behalf" (the backlog item's own Scope). Both values are
   * independent and optional: a tenant may set text with no link, a link with no text, or neither.
   *
   * <b>Text is text, never markup.</b> `textContent`, the identical rule every other piece of
   * server-supplied or user-supplied content in this file already follows (`renderBubble`'s own
   * remarks) - a tenant's notice string is exactly as untrusted as a visitor's message body, and
   * nothing here ever touches `innerHTML`.
   *
   * <b>The link opens in a new context.</b> `target="_blank"` plus `rel="noopener noreferrer"`,
   * identical to `renderAttachmentInto`'s own attachment-download link - the tenant's policy page is a
   * different origin from this host page, and the visitor should be able to read it without losing
   * their place in the conversation or handing the new tab a `window.opener` back into this one.
   *
   * <b>Never throws.</b> `parseNoticeUrl` already rejects anything that is not an absolute `https://`
   * URL before it ever reaches `href` - a malformed value degrades to "no link", never a broken host
   * page, the same posture `parseWidgetColor`/`parseWidgetPosition` already take for their own fields.
   */
  private applyProcessingNotice(rawText: string | null, rawUrl: string | null): void {
    const text = parseNoticeText(rawText);
    const url = parseNoticeUrl(rawUrl);

    this.processingNotice.textContent = "";

    if (text === undefined && url === undefined) {
      this.processingNotice.hidden = true;
      return;
    }

    if (text !== undefined) {
      const textSpan = document.createElement("span");
      textSpan.className = "ago-processing-notice__text";
      textSpan.textContent = text;
      this.processingNotice.append(textSpan);
    }

    if (url !== undefined) {
      const link = document.createElement("a");
      link.className = "ago-processing-notice__link";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = this.strings.processingNoticeLinkText;
      this.processingNotice.append(link);
    }

    this.processingNotice.hidden = false;
  }

  /**
   * `11-10`: resolves `this.strings` to the site's real language and re-applies every static piece of
   * text this class built with the English default in its constructor - the DOM-building code and
   * this method deliberately read the same `this.strings.*` fields rather than each owning its own
   * copy, so a new translatable string only ever needs adding once.
   *
   * Deliberately does **not** touch `this.status` - `renderConnectionState`/`handleSessionExpired`
   * are the only writers of that element and both already read `this.strings` at the time they run,
   * which by construction (`connect()` awaits the same `sessionPromise` this method is part of) is
   * always after this method has already resolved it. Re-writing it here on top of a state those
   * methods may already have set would be the bug, not the fix.
   */
  private applyStrings(locale: SupportedLocale): void {
    this.strings = getStrings(locale);
    const strings = this.strings;

    this.toggle.setAttribute("aria-label", this.isOpen ? strings.closeChat : strings.openChat);
    this.panel.setAttribute("aria-label", strings.chatLabel);
    this.title.textContent = strings.chatWithUs;
    this.closeButton.setAttribute("aria-label", strings.closeChat);
    // Found live: `this.notice`'s text was set once in the constructor from that moment's
    // `this.strings` (the English default) and never revisited - unlike every other element here, it
    // has no line of its own until this one, so a Russian-locale site's demo notice stayed in English
    // forever. Re-derives the same `config.demoNotice` three-way read the constructor made, against
    // the now-resolved `strings`.
    if (this.notice) {
      this.notice.textContent =
        this.config.demoNotice === "public" ? strings.publicDemoNotice : strings.privateDemoNotice;
    }
    this.input.setAttribute("aria-label", strings.messageAriaLabel);
    this.input.placeholder = strings.typeAMessage;
    this.sendButton.setAttribute("aria-label", strings.send);
    this.attachButton.setAttribute("aria-label", strings.attachAFile);
    this.emojiPlaceholder.title = strings.emojiComingSoon;
    this.savePlaceholder.title = strings.saveConversationComingSoon;

    // `ui/styles.ts`'s own remarks: a CSS `content:` pseudo-element string cannot be reached by
    // rewriting a DOM text node, so it is threaded through as a custom property instead, the same
    // mechanism `--ago-accent` already uses for the site's color. `JSON.stringify` produces a
    // correctly quoted-and-escaped CSS string literal for any text, not just the two this item ships.
    this.host.style.setProperty("--ago-auto-reply-label", JSON.stringify(strings.autoReplyLabel));
  }

  private toggleOpen(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * `23-07`: fires the `open` beacon at most once per session - the item's own Done-when, "opening
   * the panel twice in one session counts one open". `toggleOpen()` only calls this method on the
   * closed -&gt; open transition (never on close -&gt; open... -&gt; close -&gt; open again without the
   * flag already being set), so `openBeaconSent` alone is enough; no reason to also gate it on
   * `isOpen`'s own value.
   */
  private open(): void {
    this.isOpen = true;
    this.panel.hidden = false;
    this.toggle.setAttribute("aria-expanded", "true");
    this.toggle.setAttribute("aria-label", this.strings.closeChat);
    this.focusTrap.activate();
    this.closeButton.focus();

    if (!this.openBeaconSent) {
      this.openBeaconSent = true;
      sendBeacon(this.config, fetch, "open");
    }

    if (this.connectPromise === null) {
      this.connectPromise = this.connect();
    }
  }

  private close(): void {
    this.isOpen = false;
    this.panel.hidden = true;
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.setAttribute("aria-label", this.strings.openChat);
    this.focusTrap.deactivate();
    this.toggle.focus();
  }

  /**
   * `20-07`: loads the booking module's own chip copy from its lazily-built bundle
   * (`build.mjs`'s third entry point, `dist/widget-module-booking.js`) and reveals the chip only
   * once it has it. `ui/moduleLoader.ts`'s own doc comment covers why the specifier reaching
   * `import()` is a runtime-computed URL rather than a literal - that, not this method, is what keeps
   * `src/modules/booking/` out of the base bundle's inputs.
   *
   * Awaits `sessionPromise` first, for two reasons now instead of one: `this.locale` needs to be
   * resolved (unchanged since `20-07`), and `23-105` adds the actual gate - whether the resolved
   * session's `enabledModules` contains this widget's one statically-wired module key. This is the
   * single place in `ago-widget` allowed to compare a module key against the literal `"calendar"`:
   * `adr/0065` guard 9 forbids that literal inside `Ago.Chat.*`, because that assembly must stay
   * ignorant of what any module *is* - a constraint this repository was never under, and could not
   * meet anyway, since `ui/moduleLoader.ts` already names `widget-module-booking.js` and this whole
   * class is already built around exactly one module (`decisions.md`'s own "no module runtime": one
   * candidate, wired statically, until a second one exists to design the seam against). A site with
   * no grant for this key returns here without revealing a chip, building one, or calling
   * `loadModule` at all - unchanged from `20-07`'s own "a shop without booking pays nothing"
   * property, just decided from the handshake response now instead of from the script tag.
   *
   * `23-105`: the element itself moved here too, out of the constructor - `moduleChip` is `null`
   * until this method finds the grant, then built and spliced into the header exactly where the
   * constructor used to place it (`insertBefore(closeButton)`), before the label is known. It stays
   * `hidden`/`disabled` at that point, revealed only once the lazy bundle's own copy has arrived, so
   * "no calendar-flavored copy exists before the fetch resolves" holds exactly as it did before.
   *
   * A failure here (the lazy bundle 404s, a host page blocks the request) is caught by this method's
   * own `guardAsync` caller and simply leaves the chip absent, never a throw onto the host page.
   */
  private async loadBookingModuleChip(): Promise<void> {
    const session = await this.sessionPromise;
    if (!session.enabledModules.includes("calendar")) {
      return;
    }

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ago-module-chip";
    chip.hidden = true;
    chip.disabled = true;
    this.closeButton.parentElement?.insertBefore(chip, this.closeButton);
    this.moduleChip = chip;

    const bookingModule = await loadModule<{ bookingChipSpec: (locale: SupportedLocale) => ModuleChipSpec }>(
      this.config.scriptUrl,
      "widget-module-booking.js",
    );
    const spec = bookingModule.bookingChipSpec(this.locale);

    chip.textContent = spec.label;
    chip.setAttribute("aria-label", spec.ariaLabel);
    chip.hidden = false;
    chip.disabled = !this.isConnected;
    chip.addEventListener("click", () => this.invokeModule(spec.triggerText));
  }

  /**
   * `18-03`'s own interaction shape (`ago-console`'s `Composer.tsx`), read as a UX convention rather
   * than shared code: inserting the trigger phrase and sending it is **structurally identical to the
   * visitor typing it themselves**, not a second code path into the module - `sendCurrentMessage`
   * below is the exact function a keystroke-driven send already goes through.
   */
  private invokeModule(triggerText: string): void {
    this.input.value = triggerText;
    this.updateSendButtonEnabled();
    this.sendCurrentMessage();
  }

  /** Lazy-init on first open, not on page load (embeddable-widget skill: "nothing heavy before
   * first interaction") - `11-03`: true of the real-time connection built here, not of the visitor
   * identity/config resolution any more, which `bootstrapSession` now starts eagerly at mount time.
   * This method awaits that same `sessionPromise` rather than re-requesting it, so a first open
   * never fires a second, redundant `POST /api/v1/visitor-sessions`. Session + connection failures
   * degrade to a status message, never a throw that could escape to the host page. */
  private async connect(): Promise<void> {
    try {
      const session = await this.sessionPromise;
      this.session = session;
      const connection = new VisitorConnection(this.config, () => this.currentToken(), this.storage);
      connection.onMessage((message) => this.handleIncoming(message));
      connection.onStateChange((state) => this.renderConnectionState(state));
      this.connection = connection;

      const joinResult = await connection.start();
      this.conversationId = joinResult.conversationId;
      // `23-53`: `joinResult.history` is `GetHistoryAsync`'s "most recent page" shape - newest first,
      // the same keyset-pagination direction `loadOlderHistory` needs for its own "fetch backward from
      // a cursor" case (`IConversationReadStore.GetHistoryAsync`'s own remarks). Before this item, this
      // loop only ever ran on a brand-new conversation with nothing in it yet, so the order was never
      // visible; a returning visitor's own history is now delivered here too, and a transcript rendered
      // in the order the query returns it would put the newest message first and the oldest last -
      // reversed. `resumeAfterReconnect`'s own delta path needs no such reversal (`GetDeltaAsync` is
      // already oldest-first, matching how `handleIncoming` appends one at a time as messages arrive).
      for (const message of [...joinResult.history].reverse()) {
        this.appendMessageBubble(message);
      }

      this.renderConnectionState("connected");
    } catch (error) {
      logWidgetError(error);
      if (!this.isSessionExpired) {
        this.status.textContent = this.strings.chatUnavailable;
      }
    }
  }

  /**
   * Every place this widget presents the visitor token - the hub's negotiate (via
   * `VisitorConnection`'s `accessTokenFactory`) and the three attachment calls - goes through here,
   * so renewal happens wherever the token is about to be used and nowhere else (`session.ts`
   * explains why that is a better shape here than a timer).
   *
   * The one thing this adds on top of `VisitorSessionManager.token()` is making the terminal case
   * *visible*. It still rethrows: the caller's own failure path is what stops the connect, the send
   * or the upload.
   */
  private async currentToken(): Promise<string> {
    try {
      return await this.sessionManager.token();
    } catch (error) {
      if (error instanceof VisitorSessionExpiredError) {
        this.handleSessionExpired();
      }

      throw error;
    }
  }

  /**
   * `17-07`'s decided answer for a token that dies **while the page is open**, which is a different
   * question from one that is already dead at page load (`session.ts`'s `start` mints a new identity
   * for that one and the panel says so).
   *
   * Here the widget does **not** re-identify. A new `VisitorId` would open a different conversation
   * while the previous one's messages are still on screen: the visitor would carry on typing into a
   * transcript the operator answering them cannot see, and nothing would look wrong. So the session
   * ends, visibly, and reloading - a thing the visitor can actually do - is what starts a new one.
   *
   * The connection is stopped rather than left to retry, because `@microsoft/signalr`'s reconnect
   * loop would otherwise ask for a token forever, and every one of those attempts now costs a
   * renewal request against a server that has already refused.
   *
   * `adr/0034` called the pre-`17-07` behaviour "silence: an expired token does not prompt anything;
   * the widget keeps presenting it and the hub connection simply fails". This is that path made
   * observable rather than moved.
   */
  private handleSessionExpired(): void {
    if (this.isSessionExpired) {
      return;
    }

    this.isSessionExpired = true;
    this.isConnected = false;
    this.input.disabled = true;
    this.attachButton.disabled = true;
    this.sendButton.disabled = true;
    this.status.textContent = this.strings.sessionExpired;

    const connection = this.connection;
    this.connection = null;
    if (connection !== null) {
      guardAsync(() => connection.stop());
    }
  }

  private renderConnectionState(state: ConnectionState): void {
    // `17-07`: an expired session is terminal for this page load, and stopping the connection makes
    // SignalR fire `onclose` right afterwards - without this the "reload to start a new one" message
    // would be replaced, one tick later, by "Disconnected. Trying to reconnect…", which is both
    // untrue and the exact kind of quiet that this item exists to remove.
    if (this.isSessionExpired) {
      return;
    }

    this.isConnected = state === "connected";
    this.input.disabled = !this.isConnected;
    this.attachButton.disabled = !this.isConnected;
    // `hidden` guards this too (still loading, or booking never asked for) - `disabled` only matters
    // once `loadBookingModuleChip` has actually revealed it.
    if (this.moduleChip && !this.moduleChip.hidden) {
      this.moduleChip.disabled = !this.isConnected;
    }
    this.updateSendButtonEnabled();
    this.status.textContent =
      state === "connecting"
        ? this.strings.connecting
        : state === "reconnecting"
          ? this.strings.reconnecting
          : state === "disconnected"
            ? this.strings.disconnectedReconnecting
            : "";
  }

  /** Re-evaluated on every keystroke, not just once at connect time - a textarea starts empty
   * and the button must react to the visitor actually typing something (found live, 5-09: the
   * button was otherwise permanently disabled since nothing re-ran this check after connect). */
  private updateSendButtonEnabled(): void {
    this.sendButton.disabled = !this.isConnected || this.input.value.trim().length === 0;
  }

  /** `23-61`: a reserved composer place - `<span>`, not `<button>`, so there is no `href`, `type`,
   * click handler or `tabindex` to ever add: this element cannot become reachable by keyboard as a
   * control by accident the way an unconditionally-`disabled` `<button>` still could (a `disabled`
   * attribute removed by a future edit would silently turn it into a real one). `aria-disabled="true"`
   * rather than `aria-hidden="true"` - it names "a place, not a control", not "nothing here" - and
   * `title` gives a mouse-hovering visitor the same "coming soon" context a sighted keyboard user
   * gets for free from `ux-gate`'s contrast/size checks never touching this element at all (it never
   * matches `minSize.ts`'s `INTERACTIVE_SELECTOR`, which lists `button`/`a[href]`/`[role='button']`
   * and the like - a bare `<span>` with no role is not on that list, deliberately: this is not an
   * interactive element under-sized, it is not an interactive element). Mirrors `23-31`'s own shape
   * for the console's reserved nav entries (`ago-console`'s `AppShell.tsx`) rather than inventing a
   * new one for this widget. */
  private buildReservedComposerPlace(icon: string, title: string): HTMLSpanElement {
    const place = document.createElement("span");
    place.className = "ago-composer-reserved";
    place.setAttribute("aria-disabled", "true");
    place.title = title;
    place.textContent = icon;
    return place;
  }

  private sendCurrentMessage(): void {
    const body = this.input.value.trim();
    if (body.length === 0) {
      return;
    }

    this.input.value = "";
    this.updateSendButtonEnabled();
    this.dispatchSend(body);
  }

  /**
   * `20-07`: `contentKind`/`content` are how a **structured reply** rides this same send path -
   * "reply-by-id, never free text, on any channel including the widget". Both are `undefined` for a
   * plain typed message and for `invokeModule`'s trigger-phrase send, which is the whole point:
   * clicking a primitive's action or the module chip is never a second call, only a different pair of
   * arguments to the one function every visitor-authored message already goes through.
   */
  private dispatchSend(body: string, attachmentId?: string, contentKind?: string, content?: unknown): void {
    if (this.connection === null || this.conversationId === null) {
      return;
    }

    const connection = this.connection;
    const conversationId = this.conversationId;

    const bubble = this.renderBubble("Visitor", body, "sending");
    if (attachmentId) {
      this.renderAttachmentInto(bubble, attachmentId);
    }

    const clientMessageId = newClientMessageId();
    this.pendingSends.set(clientMessageId, bubble);

    connection
      .sendMessage(conversationId, body, clientMessageId, attachmentId, contentKind, content)
      .then(() => {
        bubble.classList.remove("ago-message--pending");
      })
      .catch((error: unknown) => {
        if (error instanceof SendOutcomeUnknownError) {
          // `5-17`'s decision, and the case that decides it: **the entry is kept.** This error means
          // the invoke was in flight when the socket went, so the message may well have landed. If
          // it did, the server's own copy carries this same `clientMessageId` and will arrive - over
          // the live connection, or in the history a resuming `JoinAsync` replays after the
          // reconnect - and reconciles this bubble into the real message, rendered once. Dropping
          // the entry here would make that arrival look like a brand-new message and render the
          // visitor's one message twice, under a warning saying it might never have been sent.
          //
          // This is not "we are not sure" quietly becoming a cleared warning. The warning is removed
          // by one thing only: the server's own copy of *this* message showing up, which is
          // evidence. Nothing else can clear it - not a later message's echo, not a reconnect, not
          // time passing - and if the message really never landed, it stays on screen for good.
          //
          // The same rule the console takes from the other end: `ConversationPage.tsx` retries an
          // unknown-outcome send with the *same* `clientMessageId` (server-side dedup, `5-07`) and a
          // fresh one when nothing was sent. Both sides treat that id as still live exactly when the
          // server may already hold it. This widget does not retry at all - out of scope, and
          // `dispatchSend`'s own message says so - but "still live" means the same thing here.
          this.markBubbleFailed(bubble, this.strings.sendOutcomeUnknownNote);
        } else {
          // Nothing reached the server. `NotConnectedError` never invoked at all; anything else came
          // back while the socket was still up, i.e. the hub refused it. No delivery can ever carry
          // this id, so the entry would sit in the map for the life of the panel. The failed bubble
          // stays until the visitor does something about it, and a visitor message arriving with
          // this id anyway would be a genuinely new message - which is how it would render.
          this.pendingSends.delete(clientMessageId);
          this.markBubbleFailed(
            bubble,
            error instanceof NotConnectedError ? this.strings.notConnectedRetryNote : this.strings.sendFailedNote,
          );
        }

        logWidgetError(error);
      })
      .finally(() => {
        this.updateSendButtonEnabled();
      });
  }

  private markBubbleFailed(bubble: HTMLDivElement, message: string): void {
    bubble.classList.remove("ago-message--pending");
    const note = document.createElement("div");
    note.className = "ago-status";
    note.textContent = message;
    bubble.appendChild(note);
  }

  /**
   * file-storage.md's Upload flow, steps 1-4, driven from the widget: presign, PUT with real
   * progress, confirm - each step's own failure surfaces as a visible bubble state, never a thrown
   * exception (embeddable-widget skill: "never break the host page"). Only step 5 (send the
   * message) reuses `dispatchSend` - an attachment is just a message that happens to carry one.
   */
  private handleFileSelected(file: File): void {
    const rejection = courtesyValidate(file, this.strings);
    if (rejection) {
      this.renderSystemNote(rejection);
      return;
    }

    if (this.connection === null || this.conversationId === null || this.session === null) {
      return;
    }

    const conversationId = this.conversationId;
    const body = this.input.value.trim() || file.name;
    this.input.value = "";
    this.updateSendButtonEnabled();

    const bubble = this.renderBubble("Visitor", body, "sending");
    const progress = document.createElement("div");
    progress.className = "ago-status";
    progress.textContent = `${this.strings.uploading} 0%`;
    bubble.appendChild(progress);

    this.uploadThenSend(file, body, conversationId, bubble, progress);
  }

  /**
   * `17-07`: the token is read per call through `currentToken()`, not captured once when the file
   * was picked. An upload is the one thing this widget does that can outlive a renewal window - a
   * large file on a slow connection - and step 4 (`confirmAttachment`) would otherwise present a
   * token minted before step 1 began.
   */
  private uploadThenSend(
    file: File,
    body: string,
    conversationId: string,
    bubble: HTMLDivElement,
    progress: HTMLDivElement,
  ): void {
    (async () => {
      const created = await createAttachment(this.config, await this.currentToken(), conversationId, file);
      await uploadToPresignedUrl(created.uploadUrl, file, (fraction) => {
        progress.textContent = `${this.strings.uploading} ${Math.round(fraction * 100)}%`;
      });
      await confirmAttachment(this.config, await this.currentToken(), created.attachmentId);

      bubble.remove();
      this.dispatchSend(body, created.attachmentId);
    })().catch((error: unknown) => {
      this.markBubbleFailed(bubble, this.strings.uploadFailedNote);
      logWidgetError(error);
    });
  }

  /**
   * A `MessageDto` from this visitor removes the optimistic bubble for *that* message rather than
   * appending a second one - matched by `clientMessageId` (`5-17`), the id `dispatchSend` generated
   * and the server echoes back on every delivery of it. Comparison is by string equality, which is
   * safe both ways: `crypto.randomUUID()` and `System.Text.Json`'s `Guid` both write the lowercase
   * 8-4-4-4-12 form.
   *
   * Everything with no matching entry renders as the genuinely new incoming message it is: any
   * operator message, a visitor message sent from another tab of this same visitor, a message old
   * enough to predate `clientMessageId` (`5-07` back-filled nothing), and the echo of a send this
   * panel has already given up on.
   */
  private handleIncoming(message: MessageDto): void {
    const clientMessageId = message.clientMessageId;
    if (message.authorKind === "Visitor" && clientMessageId) {
      const bubble = this.pendingSends.get(clientMessageId);
      if (bubble !== undefined) {
        this.pendingSends.delete(clientMessageId);
        bubble.remove();
      }
    }

    this.appendMessageBubble(message);
  }

  private appendMessageBubble(message: MessageDto): void {
    const bubble = this.renderBubble(message.authorKind, message.body);
    if (message.attachmentId) {
      this.renderAttachmentInto(bubble, message.attachmentId);
    }

    // `20-07`: only a message from the *other* side of the conversation is a step to render richly.
    // A visitor's own message can carry `contentKind`/`content` too - it is the reply this same
    // widget just sent (`sendStructuredReply`, `{ value }` only, no `actions`) - and re-running the
    // primitive renderer against it would either render nothing useful (no `prompt`/`title`/`fieldId`
    // to read) or, worse, a second set of buttons under a bubble that already answered them.
    if (message.authorKind !== "Visitor") {
      const primitive = renderPrimitiveContent(message, this.strings, (contentKind, value, displayText) =>
        this.sendStructuredReply(contentKind, value, displayText),
      );
      if (primitive) {
        bubble.appendChild(primitive);
      }
    }

    // `23-58`: the online entry point - a light, link-like control under the visitor's *own first*
    // message, offered exactly once (`visitorIntroControlOffered`) regardless of how many visitor
    // messages follow. It does not claim `contactCaptureShown` on its own (see that field's own
    // remarks) - only being clicked, or the out-of-hours branch below pre-empting it, does.
    if (message.authorKind === "Visitor" && !this.contactCaptureShown && !this.visitorIntroControlOffered) {
      this.visitorIntroControlOffered = true;
      this.appendVisitorIntroControl(bubble);
    }

    // `23-09`/`decisions.md` §4: the out-of-hours name-and-phone control, offered exactly once,
    // under the auto-reply bubble that is this item's only caller (this class's own
    // `contactCaptureShown` remarks). `24-05`: appending it is now async (`appendContactCaptureControl`
    // below) - it asks the server whether this site requires a recorded consent before rendering, so
    // the control never shows a checkbox nobody can act on and never omits one the write path would
    // then refuse.
    //
    // `23-58`: if the online link (above) is already showing - unclicked, waiting - this branch is
    // what an out-of-hours reply arriving mid-conversation looks like: the visitor was online, then
    // was not. The link is removed rather than left beside a second, active copy of the same form.
    if (message.authorKind === "System" && !this.contactCaptureShown) {
      this.visitorIntroControlEl?.remove();
      this.visitorIntroControlEl = null;
      this.contactCaptureShown = true;
      guardAsync(() => this.appendContactCaptureControl(bubble));
    }
  }

  /**
   * `23-58`: renders as a sibling placed right *after* `bubble` via `insertAdjacentElement`, never
   * appended inside it - `bubble` here is the visitor's own accent-colored message
   * (`.ago-message--visitor`), and this control's light-grey text is contrast-checked against the
   * panel's white background (`ui/styles.ts`'s own `.ago-contact-capture-intro-link` rule), not
   * against that bubble's fill; `insertAdjacentElement` keeps the control anchored to *this* message
   * regardless of what else has since been appended to `this.messages`, which a plain
   * `this.messages.appendChild` would not.
   *
   * A native `<button>`, not a styled `<span>` with a click handler - the backlog item's own "must
   * look like a link and behave like a button... give it an accessible name and keyboard reach" is
   * exactly what a real `<button>` gives for free (focusable, activated by Enter/Space, its
   * `textContent` is its accessible name).
   */
  private appendVisitorIntroControl(bubble: HTMLElement): void {
    const container = document.createElement("div");
    container.className = "ago-contact-capture-intro";

    const link = document.createElement("button");
    link.type = "button";
    link.className = "ago-contact-capture-intro-link";
    link.textContent = this.strings.contactCaptureIntroLink;

    link.addEventListener("click", () => {
      // Defensive: the out-of-hours branch above removes this element from the DOM the moment it
      // claims `contactCaptureShown`, but a click already queued on the event loop at that instant
      // could still reach this handler once. Checking the flag again is cheaper than proving that
      // race cannot happen.
      if (this.contactCaptureShown) {
        return;
      }

      this.contactCaptureShown = true;
      container.replaceChildren();
      guardAsync(() => this.appendContactCaptureControl(container));
    });

    container.appendChild(link);
    bubble.insertAdjacentElement("afterend", container);
    this.visitorIntroControlEl = container;
  }

  /**
   * `24-05`: the one place `getConsentRequirement` is ever called from the widget - right before the
   * control it decides the shape of. A failure here (the request errors, or times out) is treated the
   * same as "not required": the visitor still gets the ordinary, unverified control `23-09` always
   * offered, because a consent *read* failing must never be the reason a visitor cannot leave a
   * callback number at all - the crux this whole item exists to protect the opposite failure mode of.
   *
   * `23-58`: the same function backs both entry points now - `into` is either the out-of-hours
   * `System` bubble itself (the form nests inside it, as `23-09` always did) or the online link's own
   * now-emptied container (`appendVisitorIntroControl`, the form takes the link's place). One render
   * function, one caller of it, two callers of *that*.
   */
  private async appendContactCaptureControl(into: HTMLElement): Promise<void> {
    let consent: ConsentRequirement | null = null;
    if (this.conversationId) {
      try {
        const token = await this.currentToken();
        consent = await getConsentRequirement(this.config, token, this.conversationId);
      } catch (error) {
        logWidgetError(error);
      }
    }

    // A site that requires consent but has published nothing under this purpose's key yet
    // (`consent.contact` is `null` while `contactRequired` is `true`) is a real tenant
    // misconfiguration `GetConsentRequirementHandler`'s own remarks name - offering a phone form with
    // no way to satisfy the gate would only produce a confusing server refusal on submit, so this
    // widget declines to offer the control at all rather than guess at a friendlier failure.
    if (consent?.contactRequired && !consent.contact) {
      return;
    }

    into.appendChild(renderContactCaptureControl(this.strings, (result) => this.submitContactCapture(result), consent));
  }

  /**
   * `23-09`/`23-58`: records the phone, the name (as `Kind: "Other"`) and the e-mail (as
   * `Kind: "Email"`) - three unconditional rows now that `ui/contactCapture.ts` requires all three
   * fields, rather than the two rows `23-09` wrote when the name was optional. `Email` needed no new
   * domain work on the `ago-chat` side: `VisitorContactDetailKind.Email` already existed (`14-14`),
   * unused by this widget until now. Both calls run under the same visitor token this class already
   * renews for every other authenticated write (`currentToken`); a failure on any of the three rejects
   * the whole submission so the control's own catch branch re-enables the form rather than silently
   * losing a row.
   *
   * `24-05`: `recordConsent` runs *before* any contact-detail call, and only for a purpose the
   * control actually rendered a ticked checkbox for (`result.acceptContact`/`result.acceptMarketing`).
   * Ordering matters: if the site requires contact consent, the server's own gate
   * (`RecordVisitorContactDetailHandler`) refuses the phone write until an acceptance already exists,
   * so recording it first is not a style choice, it is what makes the very next call succeed.
   */
  private async submitContactCapture(result: ContactCaptureResult): Promise<void> {
    if (!this.conversationId) {
      throw new Error("No conversation to record a contact detail against.");
    }

    const token = await this.currentToken();
    if (result.acceptContact) {
      await recordConsent(this.config, token, this.conversationId, "Contact");
    }

    if (result.acceptMarketing) {
      await recordConsent(this.config, token, this.conversationId, "Marketing");
    }

    await recordContactDetail(this.config, token, this.conversationId, "Phone", result.phone);
    await recordContactDetail(this.config, token, this.conversationId, "Other", result.name);
    await recordContactDetail(this.config, token, this.conversationId, "Email", result.email);
  }

  /**
   * `20-07`: what a click on a primitive's action, or a submitted `form` input, actually sends -
   * `contentKind` equal to the kind being replied to, `content: { value }`, no `actions`
   * (`ui/primitives/render.ts`'s own contract, matched byte-for-byte against the `ago-chat`/
   * `ago-calendar` workers' identical spec). `displayText` is what the visitor's own bubble shows
   * back to them - the action's label for a button, or the typed text itself for a form - never the
   * raw `value`, which for many kinds is an id or a slot token nobody typed or read.
   */
  private sendStructuredReply(contentKind: string, value: string, displayText: string): void {
    this.dispatchSend(displayText, undefined, contentKind, { value });
  }

  private renderBubble(authorKind: MessageDto["authorKind"], body: string, state?: "sending"): HTMLDivElement {
    const bubble = document.createElement("div");
    // `14-04`: a System message is the shop's own automatic reply, so it gets an incoming-side bubble
    // with a label - deliberately not `.ago-message--system`, which is this widget's *local* status
    // note ("You are offline") and is centred, grey and unlabelled. Conflating the two would make a
    // real message from the shop look like a client-side notice, and vice versa.
    const modifier = authorKind === "System" ? "auto" : authorKind.toLowerCase();
    bubble.className = `ago-message ago-message--${modifier}`;
    if (state === "sending") {
      bubble.classList.add("ago-message--pending");
    }

    // textContent, never innerHTML: `body` is untrusted content typed by the other participant
    // (a visitor's or operator's own keyboard input), never treated as markup.
    bubble.textContent = body;
    this.messages.appendChild(bubble);
    this.messages.scrollTop = this.messages.scrollHeight;
    return bubble;
  }

  private renderSystemNote(text: string): void {
    const note = document.createElement("div");
    note.className = "ago-message ago-message--system";
    note.textContent = text;
    this.messages.appendChild(note);
    this.messages.scrollTop = this.messages.scrollHeight;
  }

  /**
   * Resolves a presigned URL for `attachmentId` and appends either an inline image or a plain
   * download link - never a thrown exception if that lookup fails (a stale/expired attachment,
   * the API unreachable), matching this widget's whole "never break the host page" posture.
   *
   * Both render as an `<a target="_blank" rel="noopener noreferrer">`: opening the URL is a
   * top-level navigation to the storage origin, not this host page's origin, so it cannot execute
   * anything in the host page's own context regardless of file-storage.md's still-open
   * `Content-Disposition`/CSP gap on the presigned GET itself (`file-storage.md`, "not shipped by
   * `5-03`") - that gap is a storage-origin content-spoofing risk, out of this widget's reach to
   * fix, and unrelated to the host page it must never break.
   */
  private renderAttachmentInto(bubble: HTMLDivElement, attachmentId: string): void {
    if (this.session === null) {
      return;
    }

    this.currentToken()
      .then((token) => getAttachmentDownload(this.config, token, attachmentId))
      .then((info) => {
        const link = document.createElement("a");
        link.href = info.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.className = "ago-attachment-link";

        if (info.contentType.startsWith("image/")) {
          const img = document.createElement("img");
          img.className = "ago-attachment-image";
          img.src = info.thumbnailUrl ?? info.url;
          img.alt = this.strings.attachmentAlt;
          link.appendChild(img);
        } else {
          link.textContent = this.strings.downloadAttachment;
        }

        bubble.appendChild(link);
        this.messages.scrollTop = this.messages.scrollHeight;
      })
      .catch((error: unknown) => {
        logWidgetError(error);
        const note = document.createElement("div");
        note.className = "ago-status";
        note.textContent = this.strings.attachmentUnavailable;
        bubble.appendChild(note);
      });
  }
}
