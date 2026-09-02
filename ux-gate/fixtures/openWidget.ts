/**
 * `15-11`: load the demo page, stub the API, and open the widget's panel.
 *
 * **No sign-in of any kind here, and that is not a shortcut.** The two consoles need an operator
 * token injected into `sessionStorage`; this widget has no operator at all. It identifies a tenant by
 * `data-site` on its own script tag and mints a visitor session for itself, so the only thing to fake
 * is the API that answers.
 *
 * The page is `demo/index.html`, unchanged - the same file a developer opens by hand, including its
 * deliberately hostile host-page CSS and its double `<script>` inclusion. Gating a bespoke harness
 * page instead would measure a widget nobody ships.
 */
import { expect, type Page } from "@playwright/test";

/** The demo page's own `data-api`, which the widget will call. Stubbed, never reached. */
const API_ORIGIN = "http://localhost:5009";

const SESSION_RESPONSE = {
  token: "ux-gate-not-a-real-token",
  visitorId: "11111111-1111-4111-8111-111111111111",
  widgetPrimaryColorHex: null,
  widgetPosition: "BottomRight",
  widgetLocale: "Ru",
  widgetNoticeText: null,
  widgetNoticeUrl: null,
};

export async function openWidget(page: Page, { open }: { open: boolean }): Promise<void> {
  await page.route(`${API_ORIGIN}/api/v1/visitor-sessions*`, async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(SESSION_RESPONSE),
    });
  });

  // The hub is deliberately *not* faked. `@microsoft/signalr` negotiating against a dead endpoint
  // leaves the panel rendered and unconnected, which is a real state a visitor can be in (a backend
  // outage) and is the one this gate can reach without hand-rolling a Hub Protocol mock the way
  // `ago-console`'s gate had to. What is measured either way is the rendered panel: its composer,
  // its buttons, its colours.
  await page.route(`${API_ORIGIN}/hubs/**`, (route) => route.abort());

  await page.goto("/demo/index.html");

  // The launcher is inside the shadow root, so `page.locator` has to pierce it - Playwright's own
  // selectors do, which is worth stating because nothing else in this project's tooling does. An
  // accessibility-tree read of this same page on the live deployment answers "(empty page)", and a
  // coordinate click times out; both were tried before this file existed.
  const launcher = page.locator(".ago-toggle");
  await expect(launcher).toBeVisible();

  if (open) {
    await launcher.click();
    // The composer is the panel's own evidence that it rendered, not merely that a class toggled.
    await expect(page.locator("textarea.ago-input")).toBeVisible();
  }
}
