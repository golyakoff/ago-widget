import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * `25-200`: the touch routing sheet's icons and text, at twice and one-and-a-half times their
 * previous size respectively. `25-201`: the text size alone was revised again, from `25-200`'s own
 * `23px` down to `16px` - the author's pick from a live comparison, after seeing 23px next to the
 * icons at their new size and deciding it was still too big. The icon size (`30px`) is unchanged by
 * `25-201` and stays covered by the second test below exactly as `25-200` wrote it.
 *
 * **Why this is not a `getComputedStyle` assertion against the mounted widget**, the way most of
 * this file's siblings work. Measured directly (see the throwaway script this item's own worker ran
 * before writing anything): jsdom's `getComputedStyle` does not apply a shadow root's own `<style>`
 * rules to elements inside that root at all - `isolation.test.ts`'s own top comment already
 * documents the identical limitation for the opposite direction (host rules leaking in). A
 * `<style>` element appended to a shadow root does not even get a `.sheet` in jsdom, so there is no
 * CSSOM to query from inside the real widget shape either. `cssMinification.test.ts` already
 * establishes this repository's own answer to "jsdom cannot compute the cascade": read the real
 * source file and assert on it directly, rather than on a browser behaviour jsdom does not
 * implement. This file goes one step further than that one's plain text `toContain` and parses the
 * source into real CSS rules (a `<style>` in `document.head`, where jsdom's CSSOM parsing does work)
 * so the assertions below are keyed to selectors and declarations, not to incidental formatting.
 *
 * What this *can* prove: the exact declared values, and that the icon's sizing rule is scoped to
 * `.ago-touch-routing-row` and not the bare `.ago-channel-switcher-row` every other placement's row
 * also carries - which is what keeps `AboveComposer`'s card and `BelowLauncher`'s row untouched.
 * What it cannot prove is that a real browser paints these numbers - that is `docs/backlog/25-200-
 * *.md`'s own explicit live-verification ask, done separately against `golyakov.net` and a local
 * build, not something jsdom can stand in for.
 */
function touchRoutingSheetRules(): CSSRuleList {
  const cssSource = readFileSync(path.join(process.cwd(), "src", "ui", "styles.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = cssSource;
  document.head.append(style);
  const sheet = style.sheet;
  if (sheet === null) {
    throw new Error("jsdom did not parse styles.css into a CSSStyleSheet");
  }
  return sheet.cssRules;
}

function ruleFor(rules: CSSRuleList, selectorText: string): CSSStyleRule {
  const match = [...rules].find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === selectorText);
  if (match === undefined) {
    throw new Error(`no rule found for selector ${selectorText}`);
  }
  return match;
}

describe("the touch routing sheet's row sizing (25-200, revised by 25-201)", () => {
  it("sets the row's own text to 16px - the author's own pick from a live 23px/20px/18px comparison, seen next to the real 30px icons (25-201)", () => {
    const rows = touchRoutingSheetRules();
    const row = ruleFor(rows, ".ago-touch-routing-row");

    expect(row.style.fontSize).toBe("16px");
    // The author's own explicit ask, unchanged since `25-200`: no fractional unit left behind - not
    // a `rem` value of any kind.
    expect(row.style.fontSize).not.toContain("rem");
  });

  it("sets every icon inside a row to 30px - 15px confirmed live, doubled - as a fixed pixel size decoupled from the row's own font-size", () => {
    const rows = touchRoutingSheetRules();
    const iconRule = ruleFor(rows, ".ago-touch-routing-row svg");

    expect(iconRule.style.width).toBe("30px");
    expect(iconRule.style.height).toBe("30px");
    // The decoupling itself: a value expressed in `em` would still scale with the row's own
    // font-size (the exact coupling this item exists to break); a literal `30px` cannot, by
    // construction, regardless of what `.ago-touch-routing-row`'s own font-size rule above does -
    // this is the CSS-source-level version of "changes font-size, icon size is unaffected" that a
    // real browser's `getComputedStyle` would show and jsdom's cannot.
    expect(iconRule.style.width).not.toContain("em");
    expect(iconRule.style.height).not.toContain("em");
  });

  it("never applies the row's icon sizing to the bare .ago-channel-switcher-row every other placement's row also carries", () => {
    const rows = touchRoutingSheetRules();

    // AboveComposer (buildChannelSwitcherRow's own <a class="ago-channel-switcher-row">, no
    // .ago-touch-routing-row) must not pick up a fixed pixel icon size meant for the sheet alone -
    // there is no rule at all for the bare class's own svg.
    const bareRowSvgRule = [...rows].find(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === ".ago-channel-switcher-row svg",
    );
    expect(bareRowSvgRule).toBeUndefined();

    // BelowLauncher's own icon class is sized by its own, entirely separate rule family
    // (.ago-channel-switcher-launcher-icon and its --large/--medium/--small modifiers) - confirm
    // that family is untouched and still expresses sizes in rem, not the sheet's new fixed px.
    const launcherIconRule = ruleFor(rows, ".ago-channel-switcher-launcher--large .ago-channel-switcher-launcher-icon");
    expect(launcherIconRule.style.width).toBe("3.5rem");
    expect(launcherIconRule.style.height).toBe("3.5rem");
  });
});
