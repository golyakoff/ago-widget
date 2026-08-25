/**
 * A hand-written stand-in for `@microsoft/signalr`'s `HubConnectionBuilder`/`HubConnection`, used by
 * the behaviour tests in this repository (`11-08`).
 *
 * **Why a fake rather than a mocking framework**: `testing.md` - hand-written fakes are readable,
 * reusable, and do not encode call-order assumptions nobody meant to make. **Why fake this at all**,
 * when the same document says never to mock the database: this is a third-party interface, which that
 * rule explicitly permits, and the code between this widget and it is the whole subject of those
 * tests. The alternative - a real `HubConnection` against a real hub - is `demo/index.html` and live
 * verification, which stay, and which cannot be made to drop a socket at an exact instant.
 *
 * Nothing here is imported by `src/index.ts`, so it never reaches the bundle esbuild builds.
 *
 * The three things only a server or a network can do are exposed as methods a test calls directly:
 * `push`, `dropToReconnecting`, `completeReconnect`.
 */
import type { MessageDto } from "../protocol/types.js";

export const HubConnectionState = {
  Disconnected: "Disconnected",
  Connecting: "Connecting",
  Connected: "Connected",
  Disconnecting: "Disconnecting",
  Reconnecting: "Reconnecting",
} as const;

export const LogLevel = { Trace: 0, Debug: 1, Information: 2, Warning: 3, Error: 4, Critical: 5, None: 6 } as const;

export interface Invocation {
  method: string;
  args: unknown[];
}

/**
 * Answers to `JoinAsync`, consumed in order across every hub built. Shared rather than per-hub on
 * purpose: a test that drives the widget through its own UI cannot reach the `HubConnection` before
 * `ChatWidget.connect()` builds it, so the answers have to be primed in advance.
 */
export const joinQueue: unknown[] = [];

export class FakeHubConnection {
  state: string = HubConnectionState.Disconnected;
  readonly invocations: Invocation[] = [];
  /** Makes the next `SendMessageAsync` reject, standing in for a send whose connection went away
   * mid-invoke (`leavingState`) or for a server that refused it while the socket stayed up. */
  failNextSend: { error: Error; leavingState: string } | null = null;
  private readonly handlers = new Map<string, (payload: never) => void>();
  private readonly reconnectingCallbacks: (() => void)[] = [];
  private readonly reconnectedCallbacks: (() => void)[] = [];
  private readonly closeCallbacks: (() => void)[] = [];

  on(method: string, handler: (payload: never) => void): void {
    this.handlers.set(method, handler);
  }

  onreconnecting(callback: () => void): void {
    this.reconnectingCallbacks.push(callback);
  }

  onreconnected(callback: () => void): void {
    this.reconnectedCallbacks.push(callback);
  }

  onclose(callback: () => void): void {
    this.closeCallbacks.push(callback);
  }

  start(): Promise<void> {
    this.state = HubConnectionState.Connected;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.state = HubConnectionState.Disconnected;
    for (const callback of this.closeCallbacks) {
      callback();
    }

    return Promise.resolve();
  }

  invoke(method: string, ...args: unknown[]): Promise<unknown> {
    this.invocations.push({ method, args });
    if (method === "JoinAsync") {
      return Promise.resolve(joinQueue.shift() ?? { conversationId: null, isNew: false, history: [] });
    }

    if (method === "SendMessageAsync" && this.failNextSend !== null) {
      const { error, leavingState } = this.failNextSend;
      this.failNextSend = null;
      this.state = leavingState;
      return Promise.reject(error);
    }

    return Promise.resolve(1);
  }

  /** The server pushing over this connection. */
  push(dto: MessageDto): void {
    this.handlers.get("MessageReceived")?.(dto as never);
  }

  /** The transport noticing the connection is gone and starting to retry. */
  dropToReconnecting(): void {
    this.state = HubConnectionState.Reconnecting;
    for (const callback of this.reconnectingCallbacks) {
      callback();
    }
  }

  /** `@microsoft/signalr`'s own reconnect succeeding. */
  completeReconnect(): void {
    this.state = HubConnectionState.Connected;
    for (const callback of this.reconnectedCallbacks) {
      callback();
    }
  }

  invocationsOf(method: string): Invocation[] {
    return this.invocations.filter((invocation) => invocation.method === method);
  }

  /** The `index`-th call to `method`, or a failure naming what was actually invoked - a test asking
   * for a call that never happened should say so, not read `undefined` off an array. */
  invocationAt(method: string, index: number): Invocation {
    const invocation = this.invocationsOf(method)[index];
    if (invocation === undefined) {
      throw new Error(`no ${method} invocation at index ${index}; invoked: ${this.invocations.map((i) => i.method).join(", ")}`);
    }

    return invocation;
  }
}

/** Every hub built since the last `resetFakeSignalR()`, oldest first. */
export const hubs: FakeHubConnection[] = [];

export class HubConnectionBuilder {
  withUrl(): HubConnectionBuilder {
    return this;
  }

  configureLogging(): HubConnectionBuilder {
    return this;
  }

  withAutomaticReconnect(): HubConnectionBuilder {
    return this;
  }

  build(): FakeHubConnection {
    const hub = new FakeHubConnection();
    hubs.push(hub);
    return hub;
  }
}

export function resetFakeSignalR(): void {
  hubs.length = 0;
  joinQueue.length = 0;
}

/** The hub most recently built - the one a test's next action reaches. */
export function currentHub(): FakeHubConnection {
  const hub = hubs[hubs.length - 1];
  if (hub === undefined) {
    throw new Error("no HubConnection has been built yet");
  }

  return hub;
}
