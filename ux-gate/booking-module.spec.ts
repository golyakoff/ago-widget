import { test, expect } from "@playwright/test";

/**
 * `#342`: the promise this item exists to keep is not "the file exists under the new name" - it is
 * "a real page still loads booking after the rename". `ui/moduleLoader.ts`'s own doc comment names
 * the trap directly: `moduleBundleUrl` takes the sibling's file name as a **literal**, resolved
 * relative to the widget's own `<script src>` - so renaming the entry point alone leaves the chunk
 * reachable under its old name and turns nothing red. A file-existence check would not catch that
 * either; only a page that actually opens the widget, waits for the module chip to render from the
 * fetched bundle, and clicks it to send `/booking` down the real connection proves the sibling still
 * resolves under the new name.
 *
 * `demo/booking.html` is the fixture, unmodified from what a real booking-enabled tenant embeds -
 * `data-booking="true"` on a plain `<script src="../dist/widget.js">` tag, no bespoke harness markup.
 * Only the visitor-session REST call is stubbed (`gate.spec.ts`'s own `openWidget` does the same); the
 * hub is aborted rather than faked, since the chip does not need it - `loadBookingModuleChip` awaits
 * `sessionPromise`, not a hub connection.
 */
const API_ORIGIN = "http://localhost:5009";

const SESSION_RESPONSE = {
  token: "ux-gate-not-a-real-token",
  visitorId: "22222222-2222-4222-8222-222222222222",
  widgetPrimaryColorHex: null,
  widgetPosition: "BottomRight",
  widgetLocale: "En",
  widgetNoticeText: null,
  widgetNoticeUrl: null,
};

test.describe("the booking module is fetched as a sibling of the renamed entry", () => {
  test("a page that actually loads booking - not merely a file that exists", async ({ page }) => {
    await page.route(`${API_ORIGIN}/api/v1/visitor-sessions*`, async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(SESSION_RESPONSE),
      });
    });
    await page.route(`${API_ORIGIN}/hubs/**`, (route) => route.abort());

    // The real, unmocked network request for the lazy chunk - a genuine dynamic `import()` against
    // this gate's own static server (`server.mjs` serves the whole repository root, `dist/` included),
    // exactly as a browser resolves it against a real deployment's `/widget/` prefix. Recorded rather
    // than asserted-on-arrival, so a request that never happens at all fails loudly below instead of
    // the assertion simply finding nothing to check.
    const moduleResponses: { url: string; status: number; ok: boolean }[] = [];
    page.on("response", (response) => {
      if (response.url().includes("widget-module-booking.js")) {
        moduleResponses.push({ url: response.url(), status: response.status(), ok: response.ok() });
      }
    });

    await page.goto("/demo/booking.html");

    const launcher = page.locator(".ago-toggle");
    await expect(launcher).toBeVisible();
    await launcher.click();
    await expect(page.locator("textarea.ago-input")).toBeVisible();

    // The chip only becomes visible once `loadBookingModuleChip` has awaited a *successful*
    // `loadModule` call and read `bookingChipSpec` off the returned module - so a visible chip with
    // the right label is itself proof the sibling fetch resolved and executed as real JavaScript, not
    // just that some response came back with a 200. It stays disabled here (`this.isConnected` never
    // becomes true because this gate deliberately aborts `/hubs/**`, exactly as `gate.spec.ts`'s own
    // `openWidget` does - a live hub is a different fixture's job) - disabled-but-labelled-correctly
    // is still conclusive for what this test exists to prove: the label came from the real module, so
    // the module genuinely executed.
    const chip = page.locator(".ago-module-chip");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toHaveText("Book");
    await expect(chip).toHaveAttribute("aria-label", "Book an appointment");

    expect(
      moduleResponses.length,
      "expected at least one network request for widget-module-booking.js - moduleBundleUrl resolves " +
        "the chunk name as a literal against the entry's own directory, so a rename of only the entry " +
        "would leave this request unmade (a 404) while every other check on this page still passed",
    ).toBeGreaterThan(0);
    expect(
      moduleResponses.every((response) => response.ok),
      `expected every widget-module-booking.js request to succeed. Got: ${JSON.stringify(moduleResponses)}`,
    ).toBe(true);
    expect(moduleResponses.some((response) => response.url.endsWith("/dist/widget-module-booking.js"))).toBe(true);

    // What is deliberately not asserted here: clicking the chip through to a rendered `/booking`
    // message. That send has nowhere to land without a live hub, and this gate aborts `/hubs/**` on
    // purpose (`gate.spec.ts`'s own `openWidget` does the same - a live hub is a different fixture's
    // job). The click-then-send wiring itself (the trigger phrase reaching `SendMessageAsync` with the
    // right arity) is covered against a real hub mock in `src/ui/modules.test.ts` and is not repeated
    // here. What this test proves, and what `#342` needs proved, stops at the assertions above: a real
    // browser, given only the renamed entry's URL, resolved and executed the renamed sibling chunk
    // over the network exactly as `ui/moduleLoader.ts` computes it at runtime.
  });
});
