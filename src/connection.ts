import * as signalR from "@microsoft/signalr";
import type { HistoryPage, MessageDto, VisitorJoinResult } from "./protocol/types.js";
import type { WidgetConfig } from "./config.js";
import type { VisitorSession, WidgetStorage } from "./storage.js";
import { defaultBackoffOptions, jitteredDelayMs } from "./protocol/backoff.js";
import { SeenMessageIds } from "./protocol/dedup.js";
import { SequenceTracker } from "./protocol/sequence.js";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

/** Thrown by `sendMessage` when nothing was sent to the server at all - safe for a caller to retry
 * on its own (e.g. once the connection reports "connected" again). */
export class NotConnectedError extends Error {
  constructor() {
    super("Not connected.");
    this.name = "NotConnectedError";
  }
}

/**
 * Thrown when an invoke was actually in flight and the outcome is unknown - `VisitorHub.SendMessageAsync`
 * has no `clientMessageId` parameter yet (see `protocol/dedup.ts`'s `newClientMessageId` doc comment),
 * so the server cannot tell a genuine retry from a second, real send. Auto-retrying here risks a
 * duplicate message; the caller must decide (surface "not sure it sent" rather than silently resend).
 */
export class SendOutcomeUnknownError extends Error {
  constructor(cause: unknown) {
    super("Send outcome unknown - the connection may have dropped mid-request.");
    this.name = "SendOutcomeUnknownError";
    this.cause = cause;
  }
}

/**
 * Wraps `@microsoft/signalr`'s `HubConnection` with exactly the behaviour realtime.md's Client
 * protocol section and the embeddable-widget skill require: resume by `lastKnownSequence`, strict
 * ordering by `sequence` (never arrival order), full-jitter reconnect backoff, and dedup of the
 * sender's own echoed-back message (Fan-out path). A hub method here is a thin wrapper, same rule
 * the server side follows - no protocol decisions live in the UI layer that calls this.
 */
export class VisitorConnection {
  private readonly connection: signalR.HubConnection;
  private readonly seenMessageIds = new SeenMessageIds();
  private messageListener: ((message: MessageDto) => void) | null = null;
  private stateListener: ((state: ConnectionState) => void) | null = null;
  private conversationId: string | null = null;
  private sequenceTracker = new SequenceTracker();

  constructor(
    private readonly config: WidgetConfig,
    session: VisitorSession,
    private readonly storage: WidgetStorage,
  ) {
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(`${config.apiBaseUrl}/hubs/visitor`, {
        accessTokenFactory: () => session.token,
        // The widget never uses cookies (embeddable-widget skill: "No cookies on the host
        // domain") - identity travels entirely through the JWT above. @microsoft/signalr's own
        // default is `withCredentials: true`, which sends the browser's cookie jar for this
        // origin and then requires the server's CORS policy to answer with
        // `Access-Control-Allow-Credentials: true` for every allowed origin - found live
        // (5-09): the negotiate preflight failed with exactly that CORS error against the real
        // per-site CORS policy (`5-01`), which does not set that header, on purpose, since this
        // widget was never supposed to be sending credentials in the first place.
        withCredentials: false,
      })
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (context) =>
          jitteredDelayMs(context.previousRetryCount + 1, defaultBackoffOptions),
      })
      .build();

    this.connection.on("MessageReceived", (dto: MessageDto) => this.handleIncoming(dto));

    // realtime.md: the server may ask a client to reconnect on its own schedule before a draining
    // node shuts down. Purely informational here - the drain sequence's own subsequent disconnect
    // is what actually triggers `onreconnecting`/`onreconnected` below; this hook exists so a host
    // page (or this widget's own UI) can log or display it, not to duplicate that flow.
    this.connection.on("Reconnect", (_hint: { after: string }) => {
      // Intentionally no-op beyond what onreconnecting/onreconnected already do - see doc comment.
    });

    this.connection.onreconnecting(() => this.stateListener?.("reconnecting"));
    this.connection.onreconnected(() => void this.resumeAfterReconnect());
    this.connection.onclose(() => this.stateListener?.("disconnected"));
  }

  onMessage(listener: (message: MessageDto) => void): void {
    this.messageListener = listener;
  }

  onStateChange(listener: (state: ConnectionState) => void): void {
    this.stateListener = listener;
  }

  async start(): Promise<VisitorJoinResult> {
    this.stateListener?.("connecting");
    await this.connection.start();

    const storedConversationId = this.storage.getConversationId();
    const lastKnownSequence =
      storedConversationId !== null ? this.storage.getLastKnownSequence(storedConversationId) : null;
    this.sequenceTracker = new SequenceTracker(lastKnownSequence);

    const result = await this.connection.invoke<VisitorJoinResult>(
      "JoinAsync",
      lastKnownSequence ?? undefined,
    );

    this.conversationId = result.conversationId;
    this.storage.setConversationId(result.conversationId);
    for (const message of result.history) {
      this.rememberSequence(message);
      this.seenMessageIds.markSeen(message.id);
    }

    this.stateListener?.("connected");
    return result;
  }

  /**
   * `NotConnectedError` is safe to retry once the widget observes "connected" again - nothing was
   * sent. `SendOutcomeUnknownError` is not: see that class's doc comment for why this widget does
   * not yet have a safe way to retry that case automatically.
   */
  async sendMessage(conversationId: string, body: string, attachmentId?: string): Promise<number> {
    if (this.connection.state !== signalR.HubConnectionState.Connected) {
      throw new NotConnectedError();
    }

    try {
      return await this.connection.invoke<number>("SendMessageAsync", conversationId, body, attachmentId ?? null);
    } catch (error) {
      if (this.connection.state !== signalR.HubConnectionState.Connected) {
        throw new SendOutcomeUnknownError(error);
      }

      throw error;
    }
  }

  async loadOlderHistory(conversationId: string, beforeSequence: number, pageSize: number): Promise<HistoryPage> {
    const page = await this.connection.invoke<HistoryPage>(
      "GetHistoryAsync",
      conversationId,
      beforeSequence,
      pageSize,
    );
    for (const message of page.messages) {
      this.seenMessageIds.markSeen(message.id);
    }

    return page;
  }

  async stop(): Promise<void> {
    await this.connection.stop();
  }

  private async resumeAfterReconnect(): Promise<void> {
    if (this.conversationId === null) {
      this.stateListener?.("connected");
      return;
    }

    const lastKnownSequence = this.sequenceTracker.lastKnownSequence;
    const result = await this.connection.invoke<VisitorJoinResult>("JoinAsync", lastKnownSequence ?? undefined);
    for (const message of result.history) {
      this.handleIncoming(message);
    }

    this.stateListener?.("connected");
  }

  private handleIncoming(dto: MessageDto): void {
    this.rememberSequence(dto);
    if (this.seenMessageIds.markSeen(dto.id)) {
      this.messageListener?.(dto);
    }
  }

  private rememberSequence(message: MessageDto): void {
    if (this.conversationId !== null && this.sequenceTracker.observe(message.sequence)) {
      this.storage.setLastKnownSequence(this.conversationId, message.sequence);
    }
  }
}
