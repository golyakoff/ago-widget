import { beforeEach, describe, expect, it } from "vitest";
import { WidgetStorage, WIDGET_STORAGE_DISCLOSURE } from "./storage.js";

const SITE_KEY = "site_a";
const PREFIX = `ago-chat:${SITE_KEY}:`;

/**
 * `24-15`'s own test: the document a tenant reads must never drift from what this widget actually
 * writes, the way `16-02`'s own remarks record it once did for a different pair of facts. Rather than
 * hand-list the expected key names a second time here (a second copy that could itself drift from
 * `WIDGET_STORAGE_DISCLOSURE`), this drives every public write path of `WidgetStorage` against a
 * real `localStorage` and compares what actually landed there to that one exported list - the single
 * place both this test and `ago-console`'s tenant-facing document are meant to read (`storage.ts`'s
 * own doc comment on `WIDGET_STORAGE_DISCLOSURE` has the full reasoning, including why the console
 * copy cannot be a live import across two independently-built repositories).
 */
describe("WIDGET_STORAGE_DISCLOSURE matches what WidgetStorage actually writes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function actualKeySuffixes(): string[] {
    return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
  }

  /** `last-sequence:<conversationId>` is templated in the document - one physical key per
   * conversation, not the literal string `last-sequence:<conversationId>`. Collapse every
   * `last-sequence:...` key actually written down to that one documented shape before comparing. */
  function normalise(suffixes: string[]): string[] {
    return suffixes.map((s) => (s.startsWith("last-sequence:") ? "last-sequence:<conversationId>" : s));
  }

  it("writes exactly the keys the document lists, once every write path has run", () => {
    const storage = new WidgetStorage(SITE_KEY);

    // Every documented key with a value, at least once: the identity plus every cached config field
    // (`visitor-token`, `visitor-id`, `widget-color`, `widget-position`, `widget-locale`,
    // `widget-notice-text`, `widget-notice-url`, `widget-attract-attention`), the conversation cursor
    // (`conversation-id`, `last-sequence:<conversationId>`).
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: "#2F6FED",
      widgetPosition: "BottomLeft",
      widgetLocale: "Ru",
      widgetNoticeText: "We read what you send us.",
      widgetNoticeUrl: "https://tenant.example/privacy",
      widgetAttractAttention: true,
    });
    storage.setConversationId("conv-1");
    storage.setLastKnownSequence("conv-1", 3);

    const actual = new Set(normalise(actualKeySuffixes()));
    const documented = new Set(WIDGET_STORAGE_DISCLOSURE.map((entry) => entry.key));

    expect(actual).toEqual(documented);
  });

  it("documents no key this widget does not actually write - an undocumented write fails here, not in review", () => {
    // Same drive as above, but proven the other direction: nothing in `WIDGET_STORAGE_DISCLOSURE` is
    // a stale entry for a key the class no longer writes. Guards the document against over-claiming,
    // the same way the test above guards it against under-claiming.
    const storage = new WidgetStorage(SITE_KEY);
    storage.setVisitorSession({
      token: "t",
      visitorId: "v",
      widgetPrimaryColorHex: "#2F6FED",
      widgetPosition: "BottomLeft",
      widgetLocale: "Ru",
      widgetNoticeText: "We read what you send us.",
      widgetNoticeUrl: "https://tenant.example/privacy",
      widgetAttractAttention: true,
    });
    storage.setConversationId("conv-1");
    storage.setLastKnownSequence("conv-1", 3);

    const actual = new Set(normalise(actualKeySuffixes()));
    for (const entry of WIDGET_STORAGE_DISCLOSURE) {
      expect(actual.has(entry.key), `documented key "${entry.key}" was never actually written`).toBe(true);
    }
  });
});
