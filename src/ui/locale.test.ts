import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetConfig } from "../config.js";
import { currentHub, joinQueue, resetFakeSignalR } from "../testing/fakeSignalR.js";
import { fakeJwt } from "../testing/fakeJwt.js";

/**
 * `11-10`'s own Done-when, read as a DOM test rather than asserted from the config value alone:
 *
 * - A widget booted against a site with `WidgetLocale = ru` renders every enumerated string in
 *   Russian.
 * - A widget booted against a site with no `WidgetLocale` set (every existing tenant today) renders
 *   identically to before this item.
 *
 * Follows `widget.test.ts`'s own pattern exactly: mock SignalR, stub `fetch` for the visitor-session
 * mint, mount, query into `shadowRoot`, assert `.textContent`/`.placeholder`/`aria-label` on specific
 * selectors - never the config value in isolation.
 */
vi.mock("@microsoft/signalr", () => import("../testing/fakeSignalR.js"));

const { ChatWidget } = await import("./widget.js");

const CONVERSATION_ID = "77777777-7777-7777-7777-777777777777";

const config: WidgetConfig = {
  siteKey: "shop_test",
  apiBaseUrl: "https://api.test.invalid",
  demoNotice: "none",
  // `20-07`: the module chip's own locale is `ui/modules.test.ts`'s job (it loads asynchronously
  // from a lazy bundle this file has no reason to mock) - panel chrome and connection status are
  // this file's whole subject, unrelated to whether a booking module is enabled.
  bookingModuleEnabled: false,
  scriptUrl: "https://cdn.test.invalid/dist/ago-chat.js",
};

function joinResult() {
  return { conversationId: CONVERSATION_ID, isNew: false, history: [] };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

interface Panel {
  root: ShadowRoot;
  toggle: HTMLButtonElement;
  panelEl: HTMLDivElement;
  title: HTMLHeadingElement;
  closeButton: HTMLButtonElement;
  input: HTMLTextAreaElement;
  send: HTMLButtonElement;
  attach: HTMLButtonElement;
  status: HTMLDivElement;
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
    panelEl: query<HTMLDivElement>(".ago-panel"),
    title: query<HTMLHeadingElement>(".ago-header h1"),
    closeButton: query<HTMLButtonElement>(".ago-close"),
    input: query<HTMLTextAreaElement>(".ago-input"),
    send: query<HTMLButtonElement>(".ago-send"),
    attach: query<HTMLButtonElement>(".ago-attach"),
    status: query<HTMLDivElement>(".ago-status"),
  };
}

/** Mounts and opens the widget - opening is what builds the connection (`5-09`'s lazy-on-first-open
 * rule) and is also the point every locale-dependent aria-label this file checks gets set. */
async function openWidget(): Promise<Panel> {
  joinQueue.push(joinResult());
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

function stubVisitorSession(widgetLocale?: string): void {
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
            ...(widgetLocale === undefined ? {} : { widgetLocale }),
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ),
  );
}

beforeEach(() => {
  resetFakeSignalR();
  document.body.innerHTML = "";
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a widget booted against a site with WidgetLocale = ru", () => {
  beforeEach(() => {
    stubVisitorSession("Ru");
  });

  it("renders the panel chrome and composer in Russian", async () => {
    const panel = await openWidget();

    expect(panel.toggle.getAttribute("aria-label")).toBe("Закрыть чат");
    expect(panel.panelEl.getAttribute("aria-label")).toBe("Чат");
    expect(panel.title.textContent).toBe("Чат с нами");
    expect(panel.closeButton.getAttribute("aria-label")).toBe("Закрыть чат");
    expect(panel.input.getAttribute("aria-label")).toBe("Сообщение");
    expect(panel.input.placeholder).toBe("Введите сообщение…");
    expect(panel.send.textContent).toBe("Отправить");
    expect(panel.attach.getAttribute("aria-label")).toBe("Прикрепить файл");
  });

  it("renders the closed-launcher aria-label in Russian before the panel is ever opened", async () => {
    joinQueue.push(joinResult());
    const widget = new ChatWidget(config);
    widget.mount(document.body);
    await flush();

    const host = document.querySelector("[data-ago-chat-widget]");
    const toggle = host?.shadowRoot?.querySelector(".ago-toggle");
    expect(toggle?.getAttribute("aria-label")).toBe("Открыть чат");
  });

  it("renders the connection status in Russian", async () => {
    const panel = await openWidget();

    currentHub().dropToReconnecting();
    await flush();

    expect(panel.status.textContent).toBe("Переподключение…");
  });

  it("renders the public demo notice in Russian, not the English default it was built with", async () => {
    // Found live: `this.notice`'s text was set once in the constructor, from that moment's still-
    // English `this.strings`, and `applyStrings` had no line of its own re-visiting it - every other
    // string in the "renders the panel chrome" test above went through `applyStrings` and passed; this
    // one did not, and stayed in English on a real `ru` site. `demoNotice: "public"` here, not the
    // module-level `config`'s own `"none"`, because that is the one case the bug needs to be visible in.
    joinQueue.push(joinResult());
    const widget = new ChatWidget({ ...config, demoNotice: "public" });
    widget.mount(document.body);
    await flush();

    const host = document.querySelector("[data-ago-chat-widget]");
    const notice = host?.shadowRoot?.querySelector(".ago-notice");
    expect(notice?.textContent).toBe(
      "Это публичная демонстрация. Всё, что вы здесь напишете, может прочитать любой, кто откроет демо-консоль оператора. Не указывайте реальные данные.",
    );
  });

  it("renders a restarted-session note in Russian for a returning visitor whose token could not be renewed", async () => {
    // A stored token already past its own exp, which puts VisitorSessionManager.start into its
    // renewal path immediately - session.test.ts's own fixtures use fakeJwt the same way. The
    // renewal endpoint refusing with 401 is what turns that into VisitorSessionExpiredError and the
    // "restarted" branch (session.ts's own start() doc comment states the three paths).
    const expiredToken = fakeJwt({ issuedAtMs: Date.now() - 10_000, expiresAtMs: Date.now() - 1_000 });
    localStorage.setItem("ago-chat:shop_test:visitor-token", expiredToken);
    localStorage.setItem("ago-chat:shop_test:visitor-id", "11111111-1111-1111-1111-111111111111");

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/visitor-sessions/renew")) {
        return Promise.resolve(new Response(null, { status: 401 }));
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            token: "visitor-token-2",
            visitorId: "22222222-2222-2222-2222-222222222222",
            widgetPrimaryColorHex: null,
            widgetPosition: "BottomRight",
            widgetLocale: "Ru",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    joinQueue.push(joinResult());
    const widget = new ChatWidget(config);
    widget.mount(document.body);
    // More microtask hops than a first-time mint (session.ts's own start()): the renewal attempt,
    // its 401, VisitorSessionExpiredError, clearConversation, then a fresh mint - each its own await.
    await flush();
    await flush();
    await flush();
    await flush();

    const host = document.querySelector("[data-ago-chat-widget]");
    const messages = host?.shadowRoot?.querySelectorAll(".ago-message--system");
    const texts = [...(messages ?? [])].map((el) => el.textContent);
    expect(texts.some((t) => t?.includes("Срок действия предыдущего чата истёк"))).toBe(true);
  });
});

describe("a widget booted against a site with no WidgetLocale set", () => {
  beforeEach(() => {
    stubVisitorSession(undefined);
  });

  // `11-10`'s other Done-when: every existing tenant today (no WidgetLocale column value beyond the
  // server's own En default, or - as here - a response that predates the field entirely) must render
  // identically to before this item, not merely be assumed to. Same assertions as the Russian test
  // above, English side.
  it("renders the panel chrome and composer in English, unchanged", async () => {
    const panel = await openWidget();

    expect(panel.toggle.getAttribute("aria-label")).toBe("Close chat");
    expect(panel.panelEl.getAttribute("aria-label")).toBe("Chat");
    expect(panel.title.textContent).toBe("Chat with us");
    expect(panel.closeButton.getAttribute("aria-label")).toBe("Close chat");
    expect(panel.input.getAttribute("aria-label")).toBe("Message");
    expect(panel.input.placeholder).toBe("Type a message…");
    expect(panel.send.textContent).toBe("Send");
    expect(panel.attach.getAttribute("aria-label")).toBe("Attach a file");
  });

  it("renders the connection status in English", async () => {
    const panel = await openWidget();

    currentHub().dropToReconnecting();
    await flush();

    expect(panel.status.textContent).toBe("Reconnecting…");
  });

  it("renders the private demo notice in English, unchanged", async () => {
    joinQueue.push(joinResult());
    const widget = new ChatWidget({ ...config, demoNotice: "private" });
    widget.mount(document.body);
    await flush();

    const host = document.querySelector("[data-ago-chat-widget]");
    const notice = host?.shadowRoot?.querySelector(".ago-notice");
    expect(notice?.textContent).toBe(
      "This is your own demo tenant. Only the operator login you were given can read this conversation, and the tenant deletes itself after about a day.",
    );
  });
});
