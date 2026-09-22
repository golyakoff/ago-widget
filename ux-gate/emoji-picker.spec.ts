import { test, expect } from "@playwright/test";

/**
 * `25-120`: the "jsdom cannot prove this" half of the emoji picker - `src/ui/widget.test.ts`'s own
 * unit tests already prove the cursor-position insert arithmetic and the roving-tabindex bookkeeping
 * against a synthetic DOM; what only a real browser can prove is that the popover actually paints
 * somewhere a visitor can see it, that the arrow keys actually move the browser's own focus (not
 * just a `tabIndex` property jsdom never renders), and that activating a cell actually lands a
 * character in the visible textarea.
 *
 * <b>Why this gate does not reuse `fixtures/openWidget.ts`.</b> Every other spec in this directory
 * aborts `/hubs/**` and leaves the composer's own `isConnected`-gated controls disabled on purpose
 * (`fixtures/openWidget.ts`'s own remarks: a real Hub Protocol mock is `ago-console`'s own gate's
 * problem, not this one's) - `booking-module.spec.ts` states outright that clicking through to a
 * live send "has nowhere to land without a live hub" and is not attempted here either. The emoji
 * button is gated the identical way `sendButton` already is (`isConnected ||
 * autoOpenedWithoutConnecting`, `ui/widget.ts`'s own `emojiButton`/`updateEmojiButtonEnabled` doc
 * comments), so this gate reaches the same "composer enabled, no live hub" state `adr/0148`'s
 * auto-open flow was built for - `widgetAutoOpenEnabled`/`widgetAutoOpenGreetingText` in the stubbed
 * handshake response, waited out for real (the shortest of `Ago.Chat.Domain.AutoOpenDelay`'s six
 * values, `ui/appearance.ts`'s own `parseAutoOpenDelaySeconds`) rather than faked, since a fake-clock
 * install racing the mocked handshake's own microtask chain would be a second thing to get wrong for
 * no real speed-up (the handshake resolves near-instantly either way; only the auto-open timer itself
 * needs the real 15 seconds).
 */
const API_ORIGIN = "http://localhost:5009";
const AUTO_OPEN_DELAY_SECONDS = 15;

const SESSION_RESPONSE = {
  token: "ux-gate-not-a-real-token",
  visitorId: "44444444-4444-4444-8444-444444444444",
  widgetPrimaryColorHex: null,
  widgetPosition: "BottomRight",
  widgetLocale: "En",
  widgetNoticeText: null,
  widgetNoticeUrl: null,
  enabledModules: [],
  widgetAutoOpenEnabled: true,
  widgetAutoOpenDelaySeconds: AUTO_OPEN_DELAY_SECONDS,
  widgetAutoOpenGreetingText: "Hi! Let us know if you have any questions.",
};

test.describe("the emoji picker, proved against a real browser", () => {
  test("renders visibly, moves real focus on arrow keys, and an activation inserts into the textarea", async ({
    page,
  }) => {
    test.setTimeout(45_000);

    await page.route(`${API_ORIGIN}/api/v1/visitor-sessions*`, async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(SESSION_RESPONSE),
      });
    });
    await page.route(`${API_ORIGIN}/hubs/**`, (route) => route.abort());

    await page.goto("/demo/index.html");

    const input = page.locator("textarea.ago-input");
    // Real elapsed time, not a faked clock - `triggerAutoOpen`'s fallback branch (no channel-switcher
    // is configured in `SESSION_RESPONSE` below) reveals the panel and enables the composer from a
    // real `setTimeout`, and this is the shortest delay the server-side enum allows.
    await input.waitFor({ state: "visible", timeout: (AUTO_OPEN_DELAY_SECONDS + 10) * 1000 });
    await expect(input).toBeEnabled();

    const trigger = page.locator(".ago-emoji");
    await expect(trigger).toBeVisible();
    await expect(trigger).toBeEnabled();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    const picker = page.locator(".ago-emoji-picker");
    await expect(picker).toBeHidden();

    await trigger.click();

    // Renders visibly - `toBeVisible()` is a real layout/paint assertion in a real browser, not a
    // `hidden` attribute check jsdom would pass just as happily on an element with zero size.
    await expect(picker).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    const cells = page.locator('.ago-emoji-picker [role="gridcell"]');
    await expect(cells).toHaveCount(40);
    await expect(cells.nth(0)).toHaveText("😀");
    // The picker opens focused on the first cell (`openEmojiPicker`'s own roving-tabindex reset) -
    // `toBeFocused()` reads the real browser's own `document.activeElement` (through the shadow
    // root), not a `tabIndex` property a script could set without anything actually being focused.
    await expect(cells.nth(0)).toBeFocused();

    // Arrow-key navigation actually moves the browser's own focus, not just an internal index.
    await page.keyboard.press("ArrowRight");
    await expect(cells.nth(1)).toBeFocused();
    await expect(cells.nth(0)).toHaveAttribute("tabindex", "-1");
    await expect(cells.nth(1)).toHaveAttribute("tabindex", "0");

    await page.keyboard.press("ArrowDown");
    await expect(cells.nth(9)).toBeFocused(); // one row down, same column - EMOJI_PICKER_COLUMNS is 8

    await page.keyboard.press("ArrowUp");
    await expect(cells.nth(1)).toBeFocused();

    // Enter activates the focused cell - a real `<button>`'s own native behaviour
    // (`buildEmojiPicker`'s own doc comment on why no hand-rolled Enter/Space handling exists), and
    // this is what actually lands the glyph in the visible textarea and returns focus to it.
    await page.keyboard.press("Enter");

    await expect(picker).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(input).toHaveValue("😊"); // EMOJI_PICKER_GLYPHS[1] - the cell Enter activated
    await expect(input).toBeFocused();

    // A second, independent proof that a mouse click (not just keyboard activation) inserts too,
    // and lands at the cursor - the composer already holds "😊" with the caret just after it.
    await trigger.click();
    await expect(picker).toBeVisible();
    const thirdCell = cells.nth(2); // 🙂
    await thirdCell.click();

    await expect(picker).toBeHidden();
    await expect(input).toHaveValue("😊🙂");
    await expect(input).toBeFocused();
  });
});
