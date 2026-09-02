/**
 * `15-11`, assertion 2: "No interactive element rendered unusably small."
 *
 * ## The threshold: 24 CSS pixels, in both dimensions
 *
 * This is WCAG 2.2's own **2.5.8 Target Size (Minimum)** (AA) figure, not a number invented for this
 * gate - reached for rather than picked, because `CLAUDE.md` bans invented figures and a cited
 * standard is the honest alternative to "a guideline you didn't verify". It was checked against two
 * real measurements before being trusted, per `15-11`'s own brief:
 *
 * - **This repository's own smallest legitimate control.** `ago-calendar-console` has no design
 *   system to speak of - one 177-line `src/index.css` and five unnamespaced custom properties, against
 *   `ago-console`'s eighty-four and its `adr/0030` component set. Controls here are sized by padding
 *   alone: `button` is `padding: 0.4rem 0.9rem`, `input`/`select` `0.4rem 0.5rem`, and **no rule
 *   declares a `min-height` at all**. So the threshold cannot be grounded in a declared figure the way
 *   it is in `ago-console`; it is grounded in the measured result instead - the gate runs, and if a
 *   real control here fell under 24px the gate would say so on its first run rather than after a
 *   reader trusted this comment.
 * - **A deliberately-constructed one-character-wide input**, built in `fails-before.spec.ts` at
 *   `width: 6px` (roughly one monospace glyph) - `6 < 24`, so this threshold rejects it by a wide
 *   margin, not by a hair.
 *
 * The 84-versus-5 token gap named above is real and is somebody else's item; it is recorded here only
 * because it is why this file's justification had to be rewritten rather than copied across.
 *
 * ## The exemption: detecting the hiding pattern, not naming selectors
 *
 * A naive "every interactive element must be >= 24x24" immediately false-fails on a legitimately
 * tiny/hidden control. **This repository currently contains no such control** - grepped for
 * `visually-hidden`, `sr-only` and `clip-path: inset` and found none - so the exemption machinery
 * below is dormant here. It is kept in full rather than trimmed to what this repo needs today,
 * because `ago-console` has exactly that pattern (`input.ago-visually-hidden[type="file"]`) and
 * `ago-widget` has another (`input[type=file].ago-file-input`, measured at 1x1 on the live
 * deployment), and three divergent copies of one check is how the three gates stop agreeing about
 * what "usable" means.
 *
 * An element is exempt - excluded from the size check entirely, not scored against the threshold -
 * when it matches any of:
 *
 * - `aria-hidden="true"`
 * - computed `display: none` or `visibility: hidden` or `opacity: 0`
 * - a `clip-path`/`clip` that clips the element to nothing (the sr-only pattern above)
 * - taken out of normal flow (`position: fixed`/`absolute`/`sticky`) **and** positioned entirely
 *   outside the viewport - deliberately narrower than "currently outside the viewport" alone: a
 *   `position: static` element merely below the fold of a long, scrollable page is not hidden, it is
 *   one scroll away, and an early version of this check exempted it by mistake (found live against
 *   `queue-conversation`'s own long thread - see the code's own comment for the detail).
 * - near-zero box (`<= 2px` in both dimensions) **and** taken out of normal flow - the general shape
 *   of the sr-only/offscreen-input trick, detected by the pattern rather than by this repository's
 *   own class name, so a future component using the identical technique under a different name is
 *   still exempted correctly.
 * - a plain `<a>` still in normal inline flow (`display: inline`) - WCAG 2.5.8's own explicit
 *   exception, "the target is in a sentence or block of text". the case that surfaced this in `ago-console` was a mobile-only
 *   back link: an inline hyperlink sized by its own text, not a control laid out like a button.
 * - any ancestor computes `display: none` - not the element's own `display`, which does not inherit
 *   this property from an ancestor at all (the code's own comment on `hasHiddenAncestor` has the
 *   detail). Without this, a control inside a closed native `<dialog>` (`EraseConversationButton`'s
 *   "Cancel"/"Erase it", rendered unconditionally by `Dialog` and shown via `showModal()`) reports its
 *   own natural `display` value while genuinely being 0x0 and invisible, and was flagged as a false
 *   violation the first time this ran against `/admin`.
 *
 * Every element that survives that filter and is still visible (non-zero rendered box) is scored: a
 * width or height under the threshold is a violation, including a genuine `0×0` - a collapsed control
 * is not "hidden", it is broken, and this check must not read a layout bug as an exemption.
 */

export interface MinSizeViolation {
  selector: string;
  tag: string;
  width: number;
  height: number;
  text: string;
}

export interface MinSizeResult {
  thresholdPx: number;
  scanned: number;
  exempted: number;
  violations: MinSizeViolation[];
}

/**
 * `measureUndersizedInteractiveElements` is passed straight to Playwright's `page.evaluate`, which
 * serialises only *this function's own source text* into the browser - not this module, not any
 * top-level `const`/`function` declared beside it. Every helper it needs is therefore declared
 * **inside** its body (nested function declarations are part of the same source text and travel with
 * it); a module-level `INTERACTIVE_SELECTOR`/`describeSelector` here would compile and typecheck
 * fine and then throw `ReferenceError` the first time this actually ran in a page - found exactly
 * that way while first wiring this gate up.
 */
export function measureUndersizedInteractiveElements(thresholdPx: number): MinSizeResult {
  const INTERACTIVE_SELECTOR = [
    "button",
    "a[href]",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "[role='button']",
    "[role='link']",
    "[role='combobox']",
    "[role='option']",
    "[role='checkbox']",
    "[role='switch']",
  ].join(", ");

  function describeSelector(el: Element): string {
    const id = el.id ? `#${el.id}` : "";
    const cls = el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  }

  // `display: none` does not inherit and does not cascade into a descendant's own *computed* style -
  // `getComputedStyle(button).display` still answers the button's own natural value (e.g.
  // `"inline-block"`) even when an ancestor is `display: none`, only the actual rendering (and so
  // `getBoundingClientRect()`, which correctly reports 0x0) is suppressed. Checking only `el`'s own
  // `display` therefore misses every control inside a closed native `<dialog>` - the UA stylesheet's
  // own `dialog:not([open]) { display: none }` - which is exactly the real case this surfaced against:
  // `EraseConversationButton`'s "Cancel"/"Erase it" buttons live inside a `Dialog` (`adr/0030`) that
  // renders its children unconditionally and toggles `open`/`showModal()`, so they are always in the
  // DOM and were showing up as 0x0 "violations" while the dialog was simply closed. `visibility`, by
  // contrast, *does* inherit, so the element's own computed `visibility` already reflects an ancestor's
  // `visibility: hidden` correctly and needs no separate walk.
  function hasHiddenAncestor(el: Element): boolean {
    let node = el.parentElement;
    while (node) {
      if (window.getComputedStyle(node).display === "none") {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  // CSS's own "blockification" rule (CSS Display Module Level 3 §2.7) computes `display: block` for
  // any flex/grid *item* whose author-specified `display` was `inline`, regardless of what the
  // stylesheet actually says - `getComputedStyle` only ever reports this *used* value, never the
  // authored one. Found live: `.ago-workspace__back` is `display: inline` in `workspace.css`, but its
  // parent (`.ago-workspace__main-head`) is a flex row, so `getComputedStyle(link).display` reports
  // `"block"` and the naive `computed display === "inline"` check above missed it entirely - the very
  // link this exemption exists for. This walks the live CSSOM instead of the computed style, looking
  // for a matching rule (including inside `@media` blocks, which is where this repository's own rule
  // lives) that authors `display: inline` - the question this exemption actually needs answered is
  // "did the author write this as running text", not "did the box model blockify it afterwards".
  function authoredAsInlineDisplay(el: Element): boolean {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        // A cross-origin stylesheet throws on `.cssRules` (CORS) - not a case this app has today,
        // skipped defensively rather than letting one bad sheet abort the whole scan.
        continue;
      }
      if (scanRulesForInlineMatch(rules, el)) {
        return true;
      }
    }
    return false;
  }

  function scanRulesForInlineMatch(rules: CSSRuleList, el: Element): boolean {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
        if (scanRulesForInlineMatch(rule.cssRules, el)) {
          return true;
        }
        continue;
      }
      if (!(rule instanceof CSSStyleRule)) {
        continue;
      }
      if (rule.style.display !== "inline") {
        continue;
      }
      try {
        if (el.matches(rule.selectorText)) {
          return true;
        }
      } catch {
        // An unparseable-by-`matches` selector (a rare modern-CSS edge case) - skip it rather than
        // let one rule abort the scan.
      }
    }
    return false;
  }

  // **Shadow-piercing, and this is the whole reason this file differs from the console gates'.**
  // `ago-widget` renders its entire UI inside a shadow root - `document.querySelectorAll` does not
  // descend into one, so the console version of this line finds *nothing* in the widget and reports
  // a clean pass over an unexamined UI. That is the vacuous green this project keeps meeting: the
  // check runs, returns no violations, and has looked at nothing. Verified on the live deployment
  // before writing this: an accessibility-tree read of a page carrying the widget returns "(empty
  // page)", because nothing outside pierces the boundary.
  //
  // `collectDeep` walks the light DOM and every open shadow root it meets, so the widget's own
  // composer, send button and attach button are measured like any other control. A closed shadow
  // root would be invisible to this and to every other tool; the widget's is open (confirmed by
  // reading `.shadowRoot` from an ordinary page script on the live stand).
  function collectDeep(root: ParentNode, selector: string, out: Element[]): void {
    for (const el of Array.from(root.querySelectorAll(selector))) {
      out.push(el);
    }
    // `*` rather than a shadow-host selector: there is no way to query "elements with a shadow root".
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const shadow = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
      if (shadow) {
        collectDeep(shadow, selector, out);
      }
    }
  }

  function shadowRootsOf(root: ParentNode, out: ShadowRoot[]): void {
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const shadow = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
      if (shadow) {
        out.push(shadow);
        shadowRootsOf(shadow, out);
      }
    }
  }

  // **Scoped to the widget's own shadow roots, never the host page.** This is the one place where
  // this repository's gate must differ from the consoles', and the demo page proves why: it is
  // deliberately styled as a hostile neighbour - `rgb(0, 255, 0)` on white, its own copy describing
  // it as "a bad neighbour" - and the first run of this check dutifully reported all of it. Those are
  // somebody else's colours on somebody else's page. A widget is judged on what it renders, and
  // policing the shop's own stylesheet would make this gate permanently red for something no change
  // here can fix.
  //
  // Overflow stays document-wide, in `gate.spec.ts`, and the asymmetry is deliberate: not damaging
  // the host page's layout *is* the widget's promise, so that one is measured on the whole document.

  const elements: Element[] = [];
  const shadowRoots: ShadowRoot[] = [];
  shadowRootsOf(document, shadowRoots);
  for (const shadow of shadowRoots) {
    collectDeep(shadow, INTERACTIVE_SELECTOR, elements);
  }
  const violations: MinSizeViolation[] = [];
  let exempted = 0;

  // **A control wrapped in a `<label>` is measured by the label, not by itself.** Found by running
  // this gate against `ago-calendar-console` for the first time: it flagged two bare
  // `<input type="checkbox">` at 13x13 (the browser's own unstyled default) as undersized, and both
  // turned out to sit inside a `<label>` whose text toggles them. The clickable target is therefore
  // the whole label, and the check was measuring the wrong box - it would have produced a defect
  // report for a control that is genuinely fine, which is worse than missing one, because a gate that
  // cries wolf gets switched off.
  //
  // Measured rather than exempted: a `<label>` that is *itself* tiny is still a real defect, and
  // substituting its rect keeps that case caught instead of waving the whole pattern through.
  function targetRect(el: Element): DOMRect {
    const label = el.closest("label");
    return (label ?? el).getBoundingClientRect();
  }

  for (const el of elements) {
    const style = window.getComputedStyle(el);
    const rect = targetRect(el);

    const ariaHidden = el.getAttribute("aria-hidden") === "true";
    const displayNone = style.display === "none";
    const visibilityHidden = style.visibility === "hidden";
    const opacityZero = parseFloat(style.opacity || "1") === 0;
    // Deliberately narrow: only the specific clip-shapes the sr-only idiom actually uses ("clip
    // to nothing"), never "has any clip-path at all" - a real, visible control clipped to a rounded
    // corner or a decorative shape must not be exempted just for having a `clip-path` set.
    const clipsToNothing =
      style.clipPath === "inset(50%)" ||
      style.clipPath === "circle(0px)" ||
      style.clipPath === "circle(0)" ||
      style.clip === "rect(0px, 0px, 0px, 0px)" ||
      style.clip === "rect(0, 0, 0, 0)";
    // Off-canvas only counts as the hiding pattern when the element is taken out of normal flow to
    // get there (`position: fixed/absolute/sticky`) - the older "shove it off-screen" sr-only
    // technique. A `position: static` element that is merely *below the fold* of a long, scrollable
    // page is not hidden at all, it is one scroll away - found live, the first time this ran against
    // `queue-conversation`'s own long message thread: an element appended at the end of a tall
    // `document.body` landed below `window.innerHeight` by ordinary flow, not by any hiding technique,
    // and this exemption almost swallowed it. Requiring non-static positioning is what keeps a
    // genuinely tiny control at the bottom of a real page from being waved through.
    const takenOutOfFlow = style.position === "fixed" || style.position === "absolute" || style.position === "sticky";
    const offscreen =
      takenOutOfFlow &&
      (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight);
    const nearZeroAndPositioned = rect.width <= 2 && rect.height <= 2 && takenOutOfFlow;

    // WCAG 2.2's own 2.5.8 Target Size (Minimum) carries an explicit exception this repository's
    // threshold (this file's own doc comment) is cited from: "the target is in a sentence or block of
    // text". `WorkspaceLayout`'s own `.ago-workspace__back` ("← Conversations", mobile only,
    // `workspace.css`'s `display: inline`) is exactly that - an ordinary inline hyperlink whose size
    // is however tall its own text happens to be, not a tap target laid out like a button. Checked
    // against the *authored* display (`authoredAsInlineDisplay`, this file's own comment on why the
    // computed value cannot be trusted here), not the computed one - narrow on purpose either way:
    // only a plain `<a>` counts, never a `button`/`input`/`[role="button"]` styled to look like
    // running text, which is a control regardless of its CSS.
    const inlineTextLink = el.tagName === "A" && (style.display === "inline" || authoredAsInlineDisplay(el));
    const ancestorHidden = hasHiddenAncestor(el);

    const exempt =
      ariaHidden ||
      displayNone ||
      visibilityHidden ||
      opacityZero ||
      clipsToNothing ||
      offscreen ||
      nearZeroAndPositioned ||
      inlineTextLink ||
      ancestorHidden;

    if (exempt) {
      exempted++;
      continue;
    }

    if (rect.width < thresholdPx || rect.height < thresholdPx) {
      violations.push({
        selector: describeSelector(el),
        tag: el.tagName.toLowerCase(),
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        text: (el.textContent || "").trim().slice(0, 60),
      });
    }
  }

  return { thresholdPx, scanned: elements.length, exempted, violations };
}
