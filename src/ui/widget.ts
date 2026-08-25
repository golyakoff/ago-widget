import type { MessageDto } from "../protocol/types.js";
import type { WidgetConfig } from "../config.js";
import { WidgetStorage, type VisitorSession } from "../storage.js";
import { getOrCreateVisitorSession } from "../session.js";
import { NotConnectedError, SendOutcomeUnknownError, VisitorConnection, type ConnectionState } from "../connection.js";
import { newClientMessageId } from "../protocol/dedup.js";
import { courtesyValidate, createAttachment, confirmAttachment, getAttachmentDownload, uploadToPresignedUrl } from "../attachments.js";
import { createShadowHost } from "./shadow-root.js";
import { FocusTrap } from "./focus-trap.js";
import { logWidgetError, guardAsync } from "../errors.js";
import { parseWidgetColor, parseWidgetPosition } from "./appearance.js";

interface PendingSend {
  clientMessageId: string;
  bubble: HTMLDivElement;
}

/**
 * `8-06`: the sentence a stranger on `demo-shop1`/`demo-shop2` must have read before typing. Three
 * short statements of fact, no hedging and no reassurance - the backlog item's own point is that a
 * polite banner people skim is worth less than a blunt one they finish reading.
 *
 * Fixed text owned by the widget rather than passed in from the host page: `config.ts` explains why
 * the script tag carries a flag and not a string.
 */
function createPublicDemoNotice(): HTMLDivElement {
  const notice = document.createElement("div");
  notice.className = "ago-notice";
  // `role="note"`, not a live region: it is present before the visitor interacts at all, so there is
  // nothing to announce - it is read in document order like the rest of the panel.
  notice.setAttribute("role", "note");
  notice.textContent =
    "This is a public demo. Anyone who opens the demo operator console can read what you type here. Do not type anything real.";
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
  private readonly pendingSends: PendingSend[] = [];

  constructor(private readonly config: WidgetConfig) {
    this.storage = new WidgetStorage(config.siteKey);
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
    header.append(title, this.closeButton);

    // `8-06`: directly under the header and outside `.ago-messages`, so it is the first thing read
    // when the panel opens and cannot be scrolled away by the conversation underneath it. Not
    // dismissible: the thing it warns about (typing something real) is available on every keystroke,
    // not once at open time, so a close button would only ever remove the warning from the exact
    // moment it applies. Not a `.ago-message--system` bubble either - a bubble reads as chat history
    // and scrolls off with it.
    const notice = config.isPublicDemo ? createPublicDemoNotice() : null;

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
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.host);
  }

  /**
   * `11-03`: resolves the visitor's identity and applies the site's widget config (color, launcher
   * position) to the closed, not-yet-opened launcher - this has to happen before any interaction,
   * since the position affects where the toggle button itself renders, not just the panel a click
   * would reveal. Reuses `getOrCreateVisitorSession`'s existing storage short-circuit for a returning
   * visitor (that method's own doc comment states the resulting config-staleness limitation).
   *
   * The brief window between mount and this promise resolving renders with the widget's own built-in
   * appearance (this class's own CSS defaults) - for a first-time visitor this is a real network
   * round trip, typically well under the time it takes a person to notice or react, and for a
   * returning visitor `getOrCreateVisitorSession` resolves synchronously-fast from storage.
   */
  private async bootstrapSession(): Promise<VisitorSession> {
    const session = await getOrCreateVisitorSession(this.config, this.storage);
    this.session = session;
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
      const connection = new VisitorConnection(this.config, session, this.storage);
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
      this.status.textContent = "Chat is unavailable right now. Please try again later.";
    }
  }

  private renderConnectionState(state: ConnectionState): void {
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
    this.pendingSends.push({ clientMessageId, bubble });

    connection
      .sendMessage(conversationId, body, clientMessageId, attachmentId)
      .then(() => {
        bubble.classList.remove("ago-message--pending");
      })
      .catch((error: unknown) => {
        if (error instanceof NotConnectedError) {
          this.markBubbleFailed(bubble, "Not sent - reconnecting. It will not be retried automatically.");
        } else if (error instanceof SendOutcomeUnknownError) {
          this.markBubbleFailed(bubble, "Not sure this was sent - the connection dropped mid-request.");
        } else {
          this.markBubbleFailed(bubble, "Failed to send.");
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
    const session = this.session;
    const body = this.input.value.trim() || file.name;
    this.input.value = "";
    this.updateSendButtonEnabled();

    const bubble = this.renderBubble("Visitor", body, "sending");
    const progress = document.createElement("div");
    progress.className = "ago-status";
    progress.textContent = "Uploading… 0%";
    bubble.appendChild(progress);

    this.uploadThenSend(file, body, conversationId, session, bubble, progress);
  }

  private uploadThenSend(
    file: File,
    body: string,
    conversationId: string,
    session: VisitorSession,
    bubble: HTMLDivElement,
    progress: HTMLDivElement,
  ): void {
    (async () => {
      const created = await createAttachment(this.config, session.token, conversationId, file);
      await uploadToPresignedUrl(created.uploadUrl, file, (fraction) => {
        progress.textContent = `Uploading… ${Math.round(fraction * 100)}%`;
      });
      await confirmAttachment(this.config, session.token, created.attachmentId);

      bubble.remove();
      this.dispatchSend(body, created.attachmentId);
    })().catch((error: unknown) => {
      this.markBubbleFailed(bubble, "Couldn't send the attachment.");
      logWidgetError(error);
    });
  }

  /**
   * A `MessageDto` from this visitor reconciles the oldest pending optimistic bubble instead of
   * appending a second one - by queue order, not by matching `message.clientMessageId` against the
   * id `dispatchSend` generated (see `protocol/dedup.ts`'s `newClientMessageId` doc comment for why
   * that's still a gap, not a wire-protocol limitation). Any other visitor DTO (no pending entry -
   * e.g. sent from another tab of the same visitor) and any operator DTO render as a genuinely new
   * incoming message.
   */
  private handleIncoming(message: MessageDto): void {
    if (message.authorKind === "Visitor" && this.pendingSends.length > 0) {
      const pending = this.pendingSends.shift()!;
      pending.bubble.remove();
    }

    this.appendMessageBubble(message);
  }

  private appendMessageBubble(message: MessageDto): void {
    const bubble = this.renderBubble(message.authorKind, message.body);
    if (message.attachmentId) {
      this.renderAttachmentInto(bubble, message.attachmentId);
    }
  }

  private renderBubble(authorKind: "Visitor" | "Operator", body: string, state?: "sending"): HTMLDivElement {
    const bubble = document.createElement("div");
    bubble.className = `ago-message ago-message--${authorKind.toLowerCase()}`;
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

    getAttachmentDownload(this.config, this.session.token, attachmentId)
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
