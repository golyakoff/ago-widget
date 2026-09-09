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
  policyBaseUrl: "https://office.test.invalid",
  scriptUrl: "https://cdn.test.invalid/dist/widget.js",
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

function joinResult(history: MessageDto[], hasAttachmentUploadGrant?: boolean): VisitorJoinResult {
  return {
    conversationId: CONVERSATION_ID,
    isNew: false,
    history,
    // `exactOptionalPropertyTypes`: leaves the key out entirely when no grant answer was given,
    // rather than setting it to `undefined` - see `ui/widget.test.ts`'s own identical helper.
    ...(hasAttachmentUploadGrant !== undefined ? { hasAttachmentUploadGrant } : {}),
  };
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

    // `18-12`: the initial join now calls `JoinWithTrafficSourceAsync` (one call), and only the
    // resume after reconnect still calls plain `JoinAsync` (one call, at index 0 - it is the only one).
    expect(currentHub().invocationsOf("JoinWithTrafficSourceAsync")).toHaveLength(1);
    expect(currentHub().invocationsOf("JoinAsync")).toHaveLength(1);
    expect(currentHub().invocationAt("JoinAsync", 0).args).toEqual([13]);
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

    // `18-12`: only the resume calls `JoinAsync` now - the initial join above is
    // `JoinWithTrafficSourceAsync`, so the resume is `JoinAsync`'s own first and only call.
    expect(currentHub().invocationAt("JoinAsync", 0).args).toEqual([20]);
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

  /**
   * `23-78`: `onAttachmentUploadGrantChange` fires with the fresh `VisitorJoinResult.hasAttachmentUploadGrant`
   * on the initial join, and fires again on every later automatic reconnect too - a resume
   * (`resumeAfterReconnect`) already calls plain `JoinAsync` for its own message-history reason, and
   * this connection now reads the same field off that same response rather than discarding it.
   */
  it("reports the join result's attachment-upload grant, and reports it again on every reconnect", async () => {
    const connection = newConnection();
    const grants: boolean[] = [];
    connection.onAttachmentUploadGrantChange((hasGrant) => grants.push(hasGrant));

    joinQueue.push(joinResult([], true));
    await connection.start();
    expect(grants).toEqual([true]);

    joinQueue.push(joinResult([], false));
    currentHub().dropToReconnecting();
    currentHub().completeReconnect();
    await Promise.resolve();

    expect(grants).toEqual([true, false]);
  });

  // A server predating this field never sends it at all - `undefined`, not `false` - and this
  // connection must still report `false` to whatever is listening, the same closed-by-default
  // direction `VisitorJoinResult.hasAttachmentUploadGrant`'s own remarks commit to.
  it("reports false when the join result omits the attachment-upload grant field entirely", async () => {
    const connection = newConnection();
    const grants: boolean[] = [];
    connection.onAttachmentUploadGrantChange((hasGrant) => grants.push(hasGrant));

    joinQueue.push({ conversationId: CONVERSATION_ID, isNew: false, history: [] });
    await connection.start();

    expect(grants).toEqual([false]);
  });
});

describe("a page reloaded after a conversation was already open", () => {
  /**
   * `23-53`: this used to be named "resumes from the sequence the previous page load persisted" and
   * asserted the opposite of what is asserted below - that the fresh `.start()` sent the stored
   * cursor (`12`) as `JoinWithTrafficSourceAsync`'s first argument, and got back `joinResult([])`,
   * an empty page, with a comment calling that "not a gap in this test". It was a gap: `12` is
   * exactly the sequence this browser had already seen everything up to, so the server's honest
   * answer to "what changed since 12" is nothing, and a fresh page load has an empty DOM to put that
   * nothing into - the visitor's own bug report, "not stale, not partial - nothing". Restated here as
   * what a fresh page load actually needs: the *history* page, unconditionally, never a delta.
   */
  it("asks for the history page on every fresh start, never a delta - even with a cursor already stored", async () => {
    const first = newConnection();
    first.onMessage(() => undefined);
    joinQueue.push(joinResult([message("m1", 11)]));
    await first.start();
    currentHub().push(message("m2", 12));

    // A fresh page load: a new connection, a new storage reader, the same browser storage - which by
    // now holds a cursor of 12, the highest sequence this browser has seen. A visitor who already read
    // everything before closing the tab is the *ordinary* case, not an edge one (`23-53`'s own words).
    const second = new VisitorConnection(config, tokenProvider, new WidgetStorage(SITE_KEY));
    joinQueue.push(joinResult([message("m1", 11), message("m2", 12)]));
    const result = await second.start();

    // The request never carries the stored cursor - `undefined`, identical to a first-ever visit's
    // own call below, so the server takes the "most recent page" branch (`VisitorHub.cs`'s
    // `JoinCoreAsync`) rather than the delta-since-N branch.
    expect(currentHub().invocationAt("JoinWithTrafficSourceAsync", 0).args).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);

    // And the point of asking that way: the visitor's own history actually comes back, into a DOM
    // that started this page load with nothing in it at all.
    expect(result.history.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("asks for everything when there is nothing stored yet", async () => {
    const connection = newConnection();
    joinQueue.push(joinResult([]));
    await connection.start();

    expect(currentHub().invocationAt("JoinWithTrafficSourceAsync", 0).args).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  /**
   * `23-53`'s exact bug report, reproduced against a fake that actually behaves like
   * `VisitorHub.JoinCoreAsync` does: a present `lastKnownSequence` gets the delta since it (empty
   * when nothing changed since), `undefined` gets the visitor's own history page. A plain
   * `joinResult(...)` entry cannot tell those two calls apart, which is why the test above only
   * checks the arguments sent - this one goes further and proves the *consequence*: fails before
   * this item's own fix (the stored cursor was sent, the real server's own answer to that would have
   * been empty, and `.history` came back empty into a page that had never rendered a single bubble),
   * passes after it.
   */
  it("still shows the visitor their own history when they had already read all of it before leaving", async () => {
    const first = newConnection();
    first.onMessage(() => undefined);
    joinQueue.push(joinResult([message("m1", 11), message("m2", 12)]));
    await first.start();
    // No live push in between - the visitor read both messages, then closed the tab. The stored
    // cursor is now 12, the highest sequence there is; a delta since 12 is empty by construction.

    const second = new VisitorConnection(config, tokenProvider, new WidgetStorage(SITE_KEY));
    const fullHistory = [message("m1", 11), message("m2", 12)];
    joinQueue.push((args: unknown[]) =>
      // The real server's own branch (`VisitorHub.cs`'s `JoinCoreAsync`): a present
      // lastKnownSequence answers with the delta after it (empty here, since 12 is the newest
      // sequence there is); only `undefined` gets the history page.
      args[0] === undefined
        ? joinResult(fullHistory)
        : joinResult(fullHistory.filter((m) => m.sequence > (args[0] as number))),
    );
    const result = await second.start();

    expect(result.history).not.toEqual([]);
    expect(result.history.map((m) => m.id)).toEqual(["m1", "m2"]);
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
