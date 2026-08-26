import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageDto, VisitorJoinResult } from "./protocol/types.js";
import { WidgetStorage } from "./storage.js";
import type { WidgetConfig } from "./config.js";
import { HubConnectionState, currentHub, joinQueue, resetFakeSignalR } from "./testing/fakeSignalR.js";

/**
 * `11-08`, `testing.md`'s "Component / behaviour" level for this repository: **reconnect and resume
 * as behaviour**, not as the `backoff` function it is built out of.
 *
 * `protocol/backoff.test.ts`, `protocol/dedup.test.ts` and `protocol/sequence.test.ts` already prove
 * each piece is individually correct, and `5-16` in `ago-console` is the standing demonstration that
 * this is not the same thing: every one of that defect's pieces was correct and the connection that
 * owned them still went deaf. The behaviour under test here is the one `3-03` specifies and the one a
 * visitor on a train actually depends on - the connection drops, the client resumes from the
 * sequence it really saw, and nothing is duplicated or lost across the gap.
 *
 * `@microsoft/signalr` is faked (`testing/fakeSignalR.ts`, which carries the reasoning), never
 * `VisitorConnection` itself: the code between this widget and that library is the entire subject.
 */
vi.mock("@microsoft/signalr", () => import("./testing/fakeSignalR.js"));

const { NotConnectedError, SendOutcomeUnknownError, VisitorConnection } = await import("./connection.js");

const CONVERSATION_ID = "44444444-4444-4444-4444-444444444444";
const SITE_KEY = "shop_test";

const config: WidgetConfig = {
  siteKey: SITE_KEY,
  apiBaseUrl: "https://api.test.invalid",
  demoNotice: "none",
  booking: null,
};

/** : the connection takes a token *provider*, not a session - see its constructor for why
 * a captured token became a defect the moment renewal existed. Tests that do not care about
 * renewal hand it a provider that always answers the same thing. */
const tokenProvider = () => Promise.resolve("visitor-token");

function message(id: string, sequence: number, authorKind: "Visitor" | "Operator" = "Operator"): MessageDto {
  return {
    id,
    sequence,
    authorKind,
    authorId: "66666666-6666-6666-6666-666666666666",
    body: `message ${id}`,
    createdAt: "2026-08-25T09:00:00+00:00",
  };
}

function joinResult(history: MessageDto[]): VisitorJoinResult {
  return { conversationId: CONVERSATION_ID, isNew: false, history };
}

let storage: WidgetStorage;

function newConnection() {
  return new VisitorConnection(config, tokenProvider, storage);
}

beforeEach(() => {
  resetFakeSignalR();
  localStorage.clear();
  storage = new WidgetStorage(SITE_KEY);
});

describe("a connection that drops and comes back", () => {
  it("resumes from the newest sequence the visitor actually saw", async () => {
    const connection = newConnection();
    joinQueue.push(joinResult([message("m1", 11), message("m2", 12)]));
    await connection.start();

    currentHub().push(message("m3", 13));

    joinQueue.push(joinResult([]));
    currentHub().dropToReconnecting();
    currentHub().completeReconnect();
    await Promise.resolve();

    expect(currentHub().invocationsOf("JoinAsync")).toHaveLength(2);
    expect(currentHub().invocationAt("JoinAsync", 1).args).toEqual([13]);
  });

  it("delivers what arrived while it was gone", async () => {
    const connection = newConnection();
    const received: MessageDto[] = [];
    connection.onMessage((dto) => received.push(dto));

    joinQueue.push(joinResult([message("m1", 11)]));
    await connection.start();

    joinQueue.push(joinResult([message("m2", 12), message("m3", 13)]));
    currentHub().dropToReconnecting();
    currentHub().completeReconnect();
    await Promise.resolve();

    expect(received.map((dto) => dto.sequence)).toEqual([12, 13]);
  });

  it("does not deliver a message twice when the resume delta overlaps a live push", async () => {
    // The realistic overlap: the server had already pushed #12 before the socket went, and its
    // resume delta contains #12 again.
    const connection = newConnection();
    const received: MessageDto[] = [];
    connection.onMessage((dto) => received.push(dto));

    joinQueue.push(joinResult([message("m1", 11)]));
    await connection.start();
    currentHub().push(message("m2", 12));

    joinQueue.push(joinResult([message("m2", 12), message("m3", 13)]));
    currentHub().dropToReconnecting();
    currentHub().completeReconnect();
    await Promise.resolve();

    expect(received.map((dto) => dto.id)).toEqual(["m2", "m3"]);
  });

  it("does not replay history the visitor had already read before the drop", async () => {
    const connection = newConnection();
    const received: MessageDto[] = [];
    connection.onMessage((dto) => received.push(dto));

    joinQueue.push(joinResult([message("m1", 11), message("m2", 12)]));
    await connection.start();

    joinQueue.push(joinResult([message("m1", 11), message("m2", 12)]));
    currentHub().dropToReconnecting();
    currentHub().completeReconnect();
    await Promise.resolve();

    expect(received).toEqual([]);
  });

  it("never asks the server to resume from further back than it already got to", async () => {
    // A stray out-of-order push must not move the cursor backwards - the next resume would otherwise
    // re-request messages already on screen.
    const connection = newConnection();
    joinQueue.push(joinResult([message("m1", 20)]));
    await connection.start();

    currentHub().push(message("m-late", 14));

    joinQueue.push(joinResult([]));
    currentHub().dropToReconnecting();
    currentHub().completeReconnect();
    await Promise.resolve();

    expect(currentHub().invocationAt("JoinAsync", 1).args).toEqual([20]);
  });

  it("reports reconnecting and then connected, so the panel can say so", async () => {
    const connection = newConnection();
    const states: string[] = [];
    connection.onStateChange((state) => states.push(state));

    joinQueue.push(joinResult([message("m1", 11)]));
    await connection.start();

    joinQueue.push(joinResult([]));
    currentHub().dropToReconnecting();
    currentHub().completeReconnect();
    await Promise.resolve();

    expect(states).toEqual(["connecting", "connected", "reconnecting", "connected"]);
  });
});

describe("a page reloaded after a conversation was already open", () => {
  it("resumes from the sequence the previous page load persisted", async () => {
    const first = newConnection();
    first.onMessage(() => undefined);
    joinQueue.push(joinResult([message("m1", 11)]));
    await first.start();
    currentHub().push(message("m2", 12));

    // A fresh page load: a new connection, a new storage reader, the same browser storage.
    const second = new VisitorConnection(config, tokenProvider, new WidgetStorage(SITE_KEY));
    joinQueue.push(joinResult([]));
    await second.start();

    expect(currentHub().invocationAt("JoinAsync", 0).args).toEqual([12]);
  });

  it("asks for everything when there is nothing stored yet", async () => {
    const connection = newConnection();
    joinQueue.push(joinResult([]));
    await connection.start();

    expect(currentHub().invocationAt("JoinAsync", 0).args).toEqual([undefined]);
  });
});

describe("a send that meets a connection which is not there", () => {
  it("is refused before anything reaches the server, so the caller can retry it safely", async () => {
    const connection = newConnection();
    joinQueue.push(joinResult([]));
    await connection.start();

    currentHub().dropToReconnecting();

    await expect(connection.sendMessage(CONVERSATION_ID, "hello", "client-1")).rejects.toBeInstanceOf(
      NotConnectedError,
    );
    expect(currentHub().invocationsOf("SendMessageAsync")).toHaveLength(0);
  });

  it("is reported as an unknown outcome, not as a failure, when the connection went away mid-invoke", async () => {
    const connection = newConnection();
    joinQueue.push(joinResult([]));
    await connection.start();

    currentHub().failNextSend = {
      error: new Error("Invocation canceled due to the underlying connection being closed."),
      leavingState: HubConnectionState.Reconnecting,
    };

    await expect(connection.sendMessage(CONVERSATION_ID, "hello", "client-1")).rejects.toBeInstanceOf(
      SendOutcomeUnknownError,
    );
  });

  it("is reported as itself when the connection is still up and the server refused it", async () => {
    const connection = newConnection();
    joinQueue.push(joinResult([]));
    await connection.start();

    const refusal = new Error("An unexpected error occurred invoking 'SendMessageAsync' on the server.");
    currentHub().failNextSend = { error: refusal, leavingState: HubConnectionState.Connected };

    await expect(connection.sendMessage(CONVERSATION_ID, "hello", "client-1")).rejects.toBe(refusal);
  });
});
