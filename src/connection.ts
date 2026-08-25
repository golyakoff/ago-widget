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
 * Thrown when an invoke was actually in flight and the outcome is unknown. `VisitorHub.SendMessageAsync`
 * does dedup by `clientMessageId` server-side (`5-07`) - a same-id retry would be safe in principle -
 * but this widget does not yet build that retry path (`ui/widget.ts`'s send failure UI surfaces "not
 * sure it sent" rather than resending); the caller must decide instead of this class silently resending.
 *
 * `5-17`: what `ui/widget.ts` does do is keep the message's optimistic bubble paired to its
 * `clientMessageId` after this is thrown, so that if the send *had* landed, the server's own copy -
 * live, or in the history a resuming `JoinAsync` replays - resolves that bubble instead of rendering
 * the same message a second time. See that method's own branch for why the warning may only be
 * cleared by that arrival and by nothing else.
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
      // `5-14`: without this, `@microsoft/signalr`'s default logger is `ConsoleLogger(Information)`,
      // and `WebSocketTransport` logs "WebSocket connected to {url}" at exactly `Information` - after
      // it has appended `access_token=` to that url. Confirmed live against a running API, not
      // assumed from the console's own case: the visitor's real JWT was printed in full on every
      // connect. `coding-style.md` bans it outright ("Never log message bodies, tokens, presigned
      // URLs..."), and a visitor token being a smaller blast radius than an operator one
      // (`api-design.md`: it grants only that visitor's own conversation) does not make it a
      // different rule. It is worse here in one respect the console does not share: this bundle runs
      // on a page the widget does not control, alongside whatever else that page loaded.
      //
      // `Warning` rather than `Error`/`None` because it is the *lowest* level that suppresses that
      // line while still surfacing the diagnostics worth having: HTTP request errors and timeouts,
      // the page-freeze warning that predicts a dropped connection, and an unhandled server->client
      // method name.
      //
      // Unconditional, with no build-mode branch. Two reasons. The token-bearing line sits at
      // `Information`, which is *above* `Debug` and `Trace` on this library's ladder, so every level
      // verbose enough to be worth switching to also prints the token - there is no dev setting that
      // is both more informative and token-free. And `build.mjs` has no dev/production mode to hang a
      // condition on in the first place (one esbuild invocation, always minified; `define` carries
      // only the version and the API base URL, and esbuild gives no `import.meta.env`), so a
      // conditional would mean inventing a build flag whose only effect is to reintroduce the leak.
      .configureLogging(signalR.LogLevel.Warning)
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
   *
   * `clientMessageId` is required, not optional: `VisitorHub.SendMessageAsync` is a 4-parameter hub
   * method (`5-07`) and this server's SignalR dispatcher does not fill a missing trailing argument
   * from the C# default - found live (`8-02`), omitting it here made every real send fail with a
   * generic "error on the server", never reaching `SendVisitorMessageHandler` at all.
   */
  async sendMessage(
    conversationId: string,
    body: string,
    clientMessageId: string,
    attachmentId?: string,
  ): Promise<number> {
    if (this.connection.state !== signalR.HubConnectionState.Connected) {
      throw new NotConnectedError();
    }

    try {
      return await this.connection.invoke<number>(
        "SendMessageAsync",
        conversationId,
        body,
        attachmentId ?? null,
        clientMessageId,
      );
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
