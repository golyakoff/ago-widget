import { test, expect } from "@playwright/test";
import { openWidget } from "./fixtures/openWidget.js";
import { measureHorizontalOverflow } from "./lib/overflow.js";
import { measureUndersizedInteractiveElements } from "./lib/minSize.js";
import { measureContrastViolations } from "./lib/contrast.js";

const MIN_INTERACTIVE_SIZE_PX = 24;

/**
 * `15-11`: each assertion shown failing against a deliberately introduced defect, then passing once
 * it is removed. An assertion never seen to fail might be checking nothing, and on this repository
 * that risk is not theoretical - see the shadow-DOM proof below.
 */
test.describe("fails-before proof", () => {
  test("no horizontal overflow: an element wider than the viewport fails, removing it passes", async ({ page }) => {
    await openWidget(page, { open: true });

    const before = await page.evaluate(measureHorizontalOverflow);
    expect(before.overflowPx, "expected the demo page to start with no overflow").toBe(0);

    await page.evaluate(() => {
      const defect = document.createElement("div");
      defect.id = "ux-gate-overflow-defect";
      defect.style.cssText = "position: absolute; top: 0; left: 0; width: 5000px; height: 4px;";
      document.body.appendChild(defect);
    });

    const during = await page.evaluate(measureHorizontalOverflow);
    expect(during.overflowPx).toBeGreaterThan(0);

    await page.evaluate(() => document.getElementById("ux-gate-overflow-defect")?.remove());

    const after = await page.evaluate(measureHorizontalOverflow);
    expect(after.overflowPx, "expected removing the defect to restore a clean page").toBe(0);
  });

  /**
   * **The proof this repository exists to have.** The defect is injected *inside the widget's shadow
   * root*, not into the host page - so it is only detectable by a check that pierces the boundary.
   *
   * Without `minSize.ts`'s `collectDeep`, `document.querySelectorAll` finds nothing in there, the
   * check reports zero violations, and the gate passes having examined none of the UI it exists for.
   * That is the exact vacuous green this project keeps meeting in other costumes - a hub negotiate
   * succeeding while the console could not connect (`5-18`), an advisory lock re-entering its own
   * session, jsdom having no layout engine. If this test ever starts passing without the shadow
   * traversal, the traversal has been broken and nothing else will say so.
   */
  test("shadow DOM is actually traversed: a tiny control inside the widget's shadow root is caught", async ({
    page,
  }) => {
    await openWidget(page, { open: true });

    const before = await page.evaluate(measureUndersizedInteractiveElements, MIN_INTERACTIVE_SIZE_PX);
    expect(before.violations, JSON.stringify(before.violations, null, 2)).toEqual([]);

    // Confirm the check is looking inside the shadow root at all, rather than passing because it
    // found nothing anywhere: the widget's own composer and buttons must be among what it scanned.
    expect(
      before.scanned,
      "expected the size check to have scanned the widget's own controls - if this is 0, the shadow traversal is not working and every pass below is vacuous",
    ).toBeGreaterThan(0);

    const injected = await page.evaluate(() => {
      const host = Array.from(document.querySelectorAll("*")).find(
        (el) => (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot,
      ) as (Element & { shadowRoot: ShadowRoot }) | undefined;
      if (!host) {
        throw new Error("ux-gate: no shadow host on the page - the widget did not mount.");
      }
      const defect = document.createElement("button");
      defect.id = "ux-gate-tiny-control";
      defect.textContent = "x";
      defect.style.cssText = "width: 6px; height: 6px; padding: 0; border: 0;";
      host.shadowRoot.appendChild(defect);
      return true;
    });
    expect(injected).toBe(true);

    const during = await page.evaluate(measureUndersizedInteractiveElements, MIN_INTERACTIVE_SIZE_PX);
    expect(
      during.violations.some((v) => v.width <= 6 && v.height <= 6),
      `expected the 6x6 control inside the shadow root to be reported. Got: ${JSON.stringify(during.violations, null, 2)}`,
    ).toBe(true);

    await page.evaluate(() => {
      const host = Array.from(document.querySelectorAll("*")).find(
        (el) => (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot,
      ) as (Element & { shadowRoot: ShadowRoot }) | undefined;
      host?.shadowRoot.getElementById("ux-gate-tiny-control")?.remove();
    });

    const after = await page.evaluate(measureUndersizedInteractiveElements, MIN_INTERACTIVE_SIZE_PX);
    expect(after.violations, "expected removing the defect to restore a clean pass").toEqual([]);
  });

  test("WCAG AA contrast: a low-contrast pair inside the shadow root fails, removing it passes", async ({
    page,
  }) => {
    await openWidget(page, { open: true });

    const before = await page.evaluate(measureContrastViolations);
    expect(before.violations, JSON.stringify(before.violations, null, 2)).toEqual([]);
    expect(
      before.scanned,
      "expected the contrast check to have scanned text inside the widget - if this is 0 the shadow traversal is broken",
    ).toBeGreaterThan(0);

    await page.evaluate(() => {
      const host = Array.from(document.querySelectorAll("*")).find(
        (el) => (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot,
      ) as (Element & { shadowRoot: ShadowRoot }) | undefined;
      if (!host) {
        throw new Error("ux-gate: no shadow host on the page - the widget did not mount.");
      }
      const probe = document.createElement("div");
      probe.id = "ux-gate-contrast-probe";
      // `15-11`'s own named historical defect, reproduced literally: dark grey on dark blue.
      probe.style.backgroundColor = "#1a1a6e";
      const body = document.createElement("p");
      body.textContent = "ux-gate contrast probe";
      body.style.color = "#3a3a3a";
      probe.appendChild(body);
      host.shadowRoot.appendChild(probe);
    });

    const during = await page.evaluate(measureContrastViolations);
    const defectViolation = during.violations.find((v) => v.background.includes("26, 26, 110"));
    expect(defectViolation, JSON.stringify(during.violations, null, 2)).toBeTruthy();
    expect(defectViolation?.ratio).toBeLessThan(defectViolation?.requiredRatio ?? 0);

    await page.evaluate(() => {
      const host = Array.from(document.querySelectorAll("*")).find(
        (el) => (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot,
      ) as (Element & { shadowRoot: ShadowRoot }) | undefined;
      host?.shadowRoot.getElementById("ux-gate-contrast-probe")?.remove();
    });

    const after = await page.evaluate(measureContrastViolations);
    expect(after.violations, "expected removing the probe to restore a clean pass").toEqual([]);
  });
});
