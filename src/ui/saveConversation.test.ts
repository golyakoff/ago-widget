import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inflateRawSync } from "node:zlib";
import type { MessageDto, VisitorJoinResult } from "../protocol/types.js";
import type { WidgetConfig } from "../config.js";
import { currentHub, historyQueue, joinQueue, resetFakeSignalR } from "../testing/fakeSignalR.js";
import { en } from "../i18n/en.js";
import * as saveConversationArchiveModule from "../modules/saveConversation/archive.js";

/**
 * `23-62`: «Сохранить диалог», driven through the real panel - the click, the button's own
 * enabled/disabled state, and (this file's real point) the wiring between `ui/widget.ts` and the
 * lazily-loaded `modules/saveConversation/archive.ts`. What `archive.test.ts` already proves at the
 * pure-function level (a multi-page walk reaches every message, an attachment's real bytes land in
 * the file, only `body`/`authorKind`/`createdAt` ever render) is not re-proven byte-for-byte here;
 * this file instead proves the seam that connects that function to an actual visitor click:
 * `GetHistoryAsync` is called against *this* conversation, the walk the widget kicks off actually
 * reaches a message that was never rendered, and a failure at any point in the chain becomes a
 * system note, never a thrown exception.
 *
 * `ui/moduleLoader.ts`'s real `loadModule` does a runtime `import()` of a URL nothing in this test
 * environment serves - mocked here exactly as `ui/modules.test.ts` already mocks it for the booking
 * chip, except this mock resolves to the **real** `archive.js` module rather than a hand-written
 * stub, so the archive actually gets built through its own real logic, not a pretend one.
 *
 * `archive.js` is imported statically, once, at the top of this file rather than dynamically inside
 * the mock at click time: a real `import()` of a real file goes through Node's module loader, which
 * needs an actual event-loop turn (I/O), not merely a resolved microtask - this file's own `flush()`
 * (like every other test file's here) only drains microtasks, and a dynamic import inside the click
 * path left `GetHistoryAsync` never invoked within that budget the first time this was written.
 * Importing the module before any test runs sidesteps the question entirely: by click time the
 * module is already resolved, and the mock only ever returns it.
 */
vi.mock("@microsoft/signalr", () => import("../testing/fakeSignalR.js"));

const loadModuleMock = vi.fn((_scriptUrl: string, fileName: string) => {
  if (fileName === "widget-module-save.js") {
    return Promise.resolve(saveConversationArchiveModule);
  }
  return Promise.reject(new Error(`saveConversation.test.ts: unexpected lazy module requested: ${fileName}`));
});
vi.mock("./moduleLoader.js", () => ({
  loadModule: (scriptUrl: string, fileName: string) => loadModuleMock(scriptUrl, fileName),
}));

const { ChatWidget } = await import("./widget.js");

const CONVERSATION_ID = "77777777-7777-7777-7777-777777777777";

const config: WidgetConfig = {
  siteKey: "shop_test",
  apiBaseUrl: "https://api.test.invalid",
  demoNotice: "none",
  policyBaseUrl: "https://office.test.invalid",
  scriptUrl: "https://cdn.test.invalid/dist/widget.js",
};

function message(id: string, sequence: number, body: string, authorKind: MessageDto["authorKind"] = "Operator"): MessageDto {
  return {
    id,
    sequence,
    authorKind,
    authorId: "88888888-8888-8888-8888-888888888888",
    body,
    createdAt: "2026-09-09T09:00:00+00:00",
  };
}

function joinResult(history: MessageDto[]): VisitorJoinResult {
  return { conversationId: CONVERSATION_ID, isNew: false, history };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 25; i++) {
    await Promise.resolve();
  }
}

interface Panel {
  root: ShadowRoot;
  toggle: HTMLButtonElement;
  save: HTMLButtonElement;
  messagesEl: HTMLDivElement;
}

function panelOf(root: ShadowRoot): Panel {
  const query = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (element === null) {
      throw new Error(`the widget has no ${selector}`);
    }
    return element;
  };

  return {
    root,
    toggle: query<HTMLButtonElement>(".ago-toggle"),
    save: query<HTMLButtonElement>(".ago-save"),
    messagesEl: query<HTMLDivElement>(".ago-messages"),
  };
}

async function openWidget(): Promise<Panel> {
  const widget = new ChatWidget(config);
  widget.mount(document.body);
  await flush();

  const host = document.querySelector("[data-ago-chat-widget]");
  if (host?.shadowRoot == null) {
    throw new Error("the widget did not mount");
  }

  const panel = panelOf(host.shadowRoot);
  panel.toggle.click();
  await flush();
  return panel;
}

/** Extracts `conversation.html`'s own decompressed text from a produced archive `Blob` - the same
 * hand-parse `archive.test.ts` and `zip.test.ts` already use, kept local rather than shared: each
 * test file stays readable on its own, the existing convention in this repository's own test suite. */
async function extractTranscriptText(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const method = view.getUint16(8, true);
  const compressedSize = view.getUint32(18, true);
  const nameLength = view.getUint16(26, true);
  const dataStart = 30 + nameLength;
  const raw = bytes.slice(dataStart, dataStart + compressedSize);
  const decoded = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
  return decoded.toString("utf8");
}

let capturedBlob: Blob | null = null;
let capturedDownloadName: string | null = null;

beforeEach(() => {
  resetFakeSignalR();
  document.body.innerHTML = "";
  localStorage.clear();
  loadModuleMock.mockClear();
  capturedBlob = null;
  capturedDownloadName = null;

  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            token: "visitor-token",
            visitorId: "99999999-9999-9999-9999-999999999999",
            widgetPrimaryColorHex: null,
            widgetPosition: "BottomRight",
            enabledModules: [],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ),
  );

  // jsdom implements neither `URL.createObjectURL`/`revokeObjectURL` nor a real navigation for
  // `HTMLAnchorElement.prototype.click()` - both are stubbed so `triggerBrowserDownload` (`ui/
  // widget.ts`) runs to completion instead of throwing "not implemented", and so this test can
  // inspect exactly what it was about to hand the visitor: the real `Blob` and the file name.
  URL.createObjectURL = vi.fn((blob: Blob) => {
    capturedBlob = blob;
    return "blob:mock-url";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    capturedDownloadName = this.download;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("saving the conversation", () => {
  it("is disabled until connected, and clicking it while disconnected does nothing", async () => {
    joinQueue.push(joinResult([]));
    const panel = await openWidget();

    expect(panel.save.disabled).toBe(false); // connected once JoinAsync resolves
    expect(panel.save.getAttribute("aria-label")).toBe(en.saveConversation);

    currentHub().dropToReconnecting();
    await flush();
    expect(panel.save.disabled).toBe(true);

    panel.save.click();
    await flush();
    expect(loadModuleMock).not.toHaveBeenCalled();
  });

  it("walks GetHistoryAsync backward against this conversation to reach a message older than the loaded page, and bundles it into the download", async () => {
    // Only the "recent" page is loaded via JoinAsync - message 1 has never been rendered by this
    // panel at all, which is exactly the gap `collectFullHistory` (`archive.ts`) exists to close.
    joinQueue.push(joinResult([message("m2", 2, "second message")]));
    historyQueue.push((args: unknown[]) => {
      const [conversationId, beforeSequence] = args as [string, number, number];
      expect(conversationId).toBe(CONVERSATION_ID);
      expect(beforeSequence).toBe(2);
      return { messages: [message("m1", 1, "the very first message")], nextBeforeSequence: null };
    });

    const panel = await openWidget();
    panel.save.click();
    await flush();
    await flush();

    expect(currentHub().invocationsOf("GetHistoryAsync")).toHaveLength(1);
    expect(capturedBlob).not.toBeNull();
    expect(capturedDownloadName).toMatch(/^ago-chat-shop_test-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/);

    const text = await extractTranscriptText(capturedBlob!);
    expect(text).toContain("second message");
    expect(text).toContain("the very first message");
  });

  it("shows a system note and never throws when the lazy module cannot be loaded", async () => {
    joinQueue.push(joinResult([]));
    loadModuleMock.mockImplementationOnce(() => {
      throw new Error("simulated: the lazy chunk 404s");
    });

    const panel = await openWidget();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    panel.save.click();
    await flush();

    expect(panel.messagesEl.textContent).toContain(en.saveConversationFailedNote);
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });
});
