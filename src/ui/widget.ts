import type { MessageDto } from "../protocol/types.js";
import type { WidgetConfig } from "../config.js";
import { WidgetStorage, type VisitorSession } from "../storage.js";
import { VisitorSessionExpiredError, VisitorSessionManager } from "../session.js";
import { NotConnectedError, SendOutcomeUnknownError, VisitorConnection, type ConnectionState } from "../connection.js";
import { newClientMessageId } from "../protocol/dedup.js";
import { courtesyValidate, createAttachment, confirmAttachment, getAttachmentDownload, uploadToPresignedUrl } from "../attachments.js";
import { createShadowHost } from "./shadow-root.js";
import { FocusTrap } from "./focus-trap.js";
import { logWidgetError, guardAsync } from "../errors.js";
import { parseWidgetColor, parseWidgetPosition } from "./appearance.js";
import { BookingPanel } from "../booking/panel.js";

/**
 * `8-06`: the sentence a stranger on `demo-shop1`/`demo-shop2` must have read before typing. Three
 * short statements of fact, no hedging and no reassurance - the backlog item's own point is that a
 * polite banner people skim is worth less than a blunt one they finish reading.
 *
 * `8-11` did not touch a word of it. What changed is *when* it appears: it used to be attached to
 * the page and is now attached to the tenant, because on a tenant minted by `8-07`'s button it was
 * simply false.
 *
 * Fixed text owned by the widget rather than passed in from the host page: `config.ts` explains why
 * the script tag carries an enum and not a string.
 */
const PUBLIC_DEMO_NOTICE =
  "This is a public demo. Anyone who opens the demo operator console can read what you type here. Do not type anything real.";

/**
 * `8-11`: the same sentence's counterpart on a minted tenant, and the answer to that item's own open
 * question - whether the widget should say anything here at all.
 *
 * **It should.** `8-06`'s argument was that the warning belongs where the typing happens, because a
 * visitor can open the launcher from any scroll position without having read the page. That argument
 * does not care which way the fact points: the reassurance belongs there for exactly the same
 * reason, and the tenant's own lifetime is currently stated nowhere in the widget at all. Silence
 * would also have left the panel visually identical in the two cases, so a reviewer comparing them
 * could not tell that the notice had become conditional rather than simply deleted.
 *
 * **Precise rather than generous.** "Only the operator login you were given" and not "nobody else",
 * which is what `8-09`'s panel says and is the one place that copy over-claims: the visitor was
 * handed a `?site=` link and a password, and either can be passed on. What the widget states is what
 * the deployment actually enforces.
 *
 * **No "do not type anything real."** On a public tenant that is proportionate; here it would
 * re-create the contradiction this item exists to remove, in a softer form. The disposability is
 * said instead, which is the true version of the same caution.
 *
 * The lifetime is a fixed phrase, not a formatted timestamp: the widget is not told the expiry, and
 * an attribute carrying one would put a second copy of a number `8-09`'s panel already renders
 * exactly, a few centimetres away, where the two could disagree.
 */
const PRIVATE_DEMO_NOTICE =
  "This is your own demo tenant. Only the operator login you were given can read this conversation, and the tenant deletes itself after about a day.";

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
  private readonly toggle: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly messages: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly attachButton: HTMLButtonElement;
  private readonly fileInput: HTMLInputElement;
  private readonly focusTrap: FocusTrap;
  /** `20-06`: null unless the embed carried `data-booking`. Both of these being nullable is what
   * makes "a shop without booking pays nothing" a property of the object graph rather than a
   * promise. */
  private readonly bookButton: HTMLButtonElement | null;
  private readonly booking: BookingPanel | null;
  private readonly composer: HTMLFormElement;
  private isBooking = false;

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
    this.toggle.setAttribute("aria-label", "Open chat");
    this.toggle.textContent = "💬";
    this.toggle.addEventListener("click", () => this.toggleOpen());

    this.panel = document.createElement("div");
    this.panel.className = "ago-panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-modal", "false");
    this.panel.setAttribute("aria-label", "Chat");
    this.panel.hidden = true;
    this.panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.close();
      }
    });

    const header = document.createElement("div");
    header.className = "ago-header";
    const title = document.createElement("h1");
    title.textContent = "Chat with us";
    this.closeButton = document.createElement("button");
    this.closeButton.type = "button";
    this.closeButton.className = "ago-close";
    this.closeButton.setAttribute("aria-label", "Close chat");
    this.closeButton.textContent = "✕";
    this.closeButton.addEventListener("click", () => this.close());

    // `20-06`: **one script tag, one launcher, one panel.** Booking is a view inside the widget the
    // shop already embeds, reached by this button - not a second embed with a second floating
    // circle. The 2026-08-26 boundary review settled that on product grounds: booking must work from
    // Telegram, MAX and SMS too, and some shops run with no widget at all, so a booking-only embed
    // would be the one shape the product model rules out.
    //
    // Absent entirely unless the embed asked for booking. A shop with chat and no booking gets the
    // same panel it had before, byte for byte.
    this.bookButton = config.booking === null ? null : document.createElement("button");
    if (this.bookButton) {
      this.bookButton.type = "button";
      this.bookButton.className = "ago-book";
      this.bookButton.textContent = "Book";
      this.bookButton.setAttribute("aria-label", "Book an appointment");
      this.bookButton.addEventListener("click", () => this.toggleBooking());
      header.append(title, this.bookButton, this.closeButton);
    } else {
      header.append(title, this.closeButton);
    }

    // `8-06`: directly under the header and outside `.ago-messages`, so it is the first thing read
    // when the panel opens and cannot be scrolled away by the conversation underneath it. Not
    // dismissible: the thing it warns about (typing something real) is available on every keystroke,
    // not once at open time, so a close button would only ever remove the warning from the exact
    // moment it applies. Not a `.ago-message--system` bubble either - a bubble reads as chat history
    // and scrolls off with it.
    // `8-11`: three states, and the default is silence. A real shop's embed asks for neither
    // sentence and gets neither.
    const noticeText =
      config.demoNotice === "public" ? PUBLIC_DEMO_NOTICE
      : config.demoNotice === "private" ? PRIVATE_DEMO_NOTICE
      : null;
    const notice = noticeText === null ? null : createDemoNotice(noticeText);

    this.messages = document.createElement("div");
    this.messages.className = "ago-messages";
    // aria-live for incoming messages (embeddable-widget skill's accessibility baseline) -
    // "polite" so a message does not interrupt whatever the visitor is doing right now.
    this.messages.setAttribute("aria-live", "polite");
    this.messages.setAttribute("role", "log");

    this.status = document.createElement("div");
    this.status.className = "ago-status";
    this.status.textContent = "Connecting…";

    const composer = document.createElement("form");
    composer.className = "ago-composer";
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      this.sendCurrentMessage();
    });

    this.input = document.createElement("textarea");
    this.input.className = "ago-input";
    this.input.rows = 1;
    this.input.setAttribute("aria-label", "Message");
    this.input.placeholder = "Type a message…";
    this.input.disabled = true;
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.sendCurrentMessage();
      }
    });
    this.input.addEventListener("input", () => this.updateSendButtonEnabled());

    this.sendButton = document.createElement("button");
    this.sendButton.type = "submit";
    this.sendButton.className = "ago-send";
    this.sendButton.textContent = "Send";
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
    this.attachButton.setAttribute("aria-label", "Attach a file");
    this.attachButton.textContent = "📎";
    this.attachButton.disabled = true;
    this.attachButton.addEventListener("click", () => this.fileInput.click());

    composer.append(this.attachButton, this.fileInput, this.input, this.sendButton);
    this.panel.append(header);
    if (notice) {
      this.panel.append(notice);
    }

    this.composer = composer;
    this.panel.append(this.messages, this.status, composer);

    // `20-06`: built only when the embed asked for booking, and hidden until the button is pressed.
    // Nothing in booking/ is reachable otherwise, so a chat-only shop makes no request to a product
    // it does not have.
    this.booking = config.booking === null ? null : new BookingPanel(config.booking);
    if (this.booking) {
      this.panel.append(this.booking.element);
    }
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
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.host);
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
   */
  private async bootstrapSession(): Promise<VisitorSession> {
    const { session, restarted } = await this.sessionManager.start();
    this.session = session;
    if (restarted) {
      this.renderSystemNote(
        "Your previous chat has expired, so this is a new conversation. Anything you sent before is no longer shown here.",
      );
    }

    this.container.classList.toggle("ago-position-left", parseWidgetPosition(session.widgetPosition) === "bottom-left");
    const color = parseWidgetColor(session.widgetPrimaryColorHex);
    if (color) {
      this.host.style.setProperty("--ago-accent", color);
    }

    return session;
  }

  private toggleOpen(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private open(): void {
    this.isOpen = true;
    this.panel.hidden = false;
    this.toggle.setAttribute("aria-expanded", "true");
    this.toggle.setAttribute("aria-label", "Close chat");
    this.focusTrap.activate();
    this.closeButton.focus();

    if (this.connectPromise === null) {
      this.connectPromise = this.connect();
    }
  }

  private close(): void {
    this.isOpen = false;
    this.panel.hidden = true;
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.setAttribute("aria-label", "Open chat");
    this.focusTrap.deactivate();
    this.toggle.focus();
  }

  /**
   * `20-06`: swaps the panel between the conversation and the booking flow.
   *
   * <b>A swap, not a second panel and not a modal over the first.</b> The panel is already a small
   * fixed surface on somebody else's page; stacking a second layer inside it would fight the focus
   * trap that makes the first one keyboard-usable. The transcript is hidden rather than torn down,
   * so coming back from booking returns to the same conversation with the same connection - nothing
   * here touches the hub at all.
   *
   * <b>Booking does not require a conversation.</b> It works whether or not the visitor has ever
   * sent a message, because a booking is not a chat message today - `21-01` is the item that would
   * make it one, and this button is the widget-shaped shortcut that exists until then.
   */
  private toggleBooking(): void {
    if (this.booking === null || this.bookButton === null) {
      return;
    }

    this.isBooking = !this.isBooking;

    this.messages.hidden = this.isBooking;
    this.status.hidden = this.isBooking;
    this.composer.hidden = this.isBooking;

    if (this.isBooking) {
      this.booking.show();
      this.bookButton.textContent = "Chat";
      this.bookButton.setAttribute("aria-label", "Back to the conversation");
    } else {
      this.booking.hide();
      this.bookButton.textContent = "Book";
      this.bookButton.setAttribute("aria-label", "Book an appointment");
    }
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
      for (const message of joinResult.history) {
        this.appendMessageBubble(message);
      }

      this.renderConnectionState("connected");
    } catch (error) {
      logWidgetError(error);
      if (!this.isSessionExpired) {
        this.status.textContent = "Chat is unavailable right now. Please try again later.";
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
    this.status.textContent = "This chat session has expired. Reload the page to start a new one.";

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
    this.updateSendButtonEnabled();
    this.status.textContent =
      state === "connecting"
        ? "Connecting…"
        : state === "reconnecting"
          ? "Reconnecting…"
          : state === "disconnected"
            ? "Disconnected. Trying to reconnect…"
            : "";
  }

  /** Re-evaluated on every keystroke, not just once at connect time - a textarea starts empty
   * and the button must react to the visitor actually typing something (found live, 5-09: the
   * button was otherwise permanently disabled since nothing re-ran this check after connect). */
  private updateSendButtonEnabled(): void {
    this.sendButton.disabled = !this.isConnected || this.input.value.trim().length === 0;
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

  private dispatchSend(body: string, attachmentId?: string): void {
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
      .sendMessage(conversationId, body, clientMessageId, attachmentId)
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
          this.markBubbleFailed(bubble, "Not sure this was sent - the connection dropped mid-request.");
        } else {
          // Nothing reached the server. `NotConnectedError` never invoked at all; anything else came
          // back while the socket was still up, i.e. the hub refused it. No delivery can ever carry
          // this id, so the entry would sit in the map for the life of the panel. The failed bubble
          // stays until the visitor does something about it, and a visitor message arriving with
          // this id anyway would be a genuinely new message - which is how it would render.
          this.pendingSends.delete(clientMessageId);
          this.markBubbleFailed(
            bubble,
            error instanceof NotConnectedError
              ? "Not sent - reconnecting. It will not be retried automatically."
              : "Failed to send.",
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
    const rejection = courtesyValidate(file);
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
    progress.textContent = "Uploading… 0%";
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
        progress.textContent = `Uploading… ${Math.round(fraction * 100)}%`;
      });
      await confirmAttachment(this.config, await this.currentToken(), created.attachmentId);

      bubble.remove();
      this.dispatchSend(body, created.attachmentId);
    })().catch((error: unknown) => {
      this.markBubbleFailed(bubble, "Couldn't send the attachment.");
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
          img.alt = "Attachment";
          link.appendChild(img);
        } else {
          link.textContent = "📎 Download attachment";
        }

        bubble.appendChild(link);
        this.messages.scrollTop = this.messages.scrollHeight;
      })
      .catch((error: unknown) => {
        logWidgetError(error);
        const note = document.createElement("div");
        note.className = "ago-status";
        note.textContent = "Attachment unavailable.";
        bubble.appendChild(note);
      });
  }
}
