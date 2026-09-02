/**
 * `15-11`, assertion 3: WCAG AA contrast, computed from **rendered** foreground/background - not
 * from `tokens.css`'s own recorded pairs (`adr/0030` point 5 already hand-computes contrast for the
 * pairs its author thought to check; this exists because "the pairs its author thought to check" is
 * exactly the gap that shipped a dark-grey-on-dark-blue message no token table would have caught,
 * since the message bubble's colours are not a token pair captured in that table at all).
 *
 * ## The trap this item names explicitly
 *
 * A text node's own `background-color` is almost always `rgba(0, 0, 0, 0)` - text does not paint its
 * own background, the element that visually contains it does, and that element is very often several
 * levels up (a message bubble's tint sits on `.ago-message__bubble`, not on the `<span>` carrying the
 * words). So this walks **up the ancestor chain** from the text's own parent element, taking the
 * first computed `background-color` that is not transparent, and only falls back to the page's own
 * rendered background (`document.documentElement`, then `document.body`) if nothing in the chain
 * paints one - never an assumed white, which is the whole point: an operator's actual browser paints
 * whatever the cascade resolves to, and this check has to agree with that browser, not with a guess.
 *
 * ## The formula
 *
 * WCAG 2.x's own relative-luminance and contrast-ratio definitions, verbatim - `relativeLuminance`
 * and `contrastRatio` below are the sRGB-to-linear transform and the `(L1+0.05)/(L2+0.05)` ratio from
 * the spec, not a library's black-box implementation, so a reviewer can check the arithmetic directly
 * against the spec text.
 *
 * ## "Large text"
 *
 * WCAG's own definition: **18.66px** (14pt at the loosest common px-per-pt rounding used by
 * `AAA`-adjacent checkers is 18.5px; this uses the more common 18.66px = 14pt bold cut translated at
 * 96dpi, i.e. `14 * 4/3`) and bold (`font-weight >= 700`), or **24px** (18pt) regardless of weight.
 * Below that: `4.5:1`. At or above it: `3:1`.
 */

export interface ContrastViolation {
  selector: string;
  text: string;
  color: string;
  background: string;
  ratio: number;
  requiredRatio: number;
  isLargeText: boolean;
  fontSizePx: number;
  fontWeight: number;
}

export interface ContrastResult {
  scanned: number;
  violations: ContrastViolation[];
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Passed straight to Playwright's `page.evaluate`, which serialises only *this function's own
 * source text* into the browser - not this module, not any top-level `const`/`function` declared
 * beside it. Every helper and threshold it needs is therefore declared **inside** its body (nested
 * declarations are part of the same source text and travel with it) - `ux-gate/lib/minSize.ts`'s own
 * doc comment has the fuller version of this note, found the same way: a module-level helper here
 * compiled and typechecked fine and then threw `ReferenceError` the first time it actually ran.
 */
export function measureContrastViolations(): ContrastResult {
  const LARGE_TEXT_REGULAR_PX = 24;
  const LARGE_TEXT_BOLD_PX = 18.66;
  const BOLD_WEIGHT_THRESHOLD = 700;
  const AA_NORMAL_RATIO = 4.5;
  const AA_LARGE_RATIO = 3;

  function parseColor(value: string): Rgba | null {
    const match = /rgba?\(([^)]+)\)/.exec(value);
    if (!match) {
      return null;
    }
    const parts = match[1].split(",").map((part) => parseFloat(part.trim()));
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) {
      return null;
    }
    return {
      r: parts[0],
      g: parts[1],
      b: parts[2],
      a: parts.length > 3 ? parts[3] : 1,
    };
  }

  function channelToLinear(channel255: number): number {
    const c = channel255 / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(color: Rgba): number {
    return (
      0.2126 * channelToLinear(color.r) +
      0.7152 * channelToLinear(color.g) +
      0.0722 * channelToLinear(color.b)
    );
  }

  function contrastRatio(a: Rgba, b: Rgba): number {
    const l1 = relativeLuminance(a);
    const l2 = relativeLuminance(b);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function describeSelector(el: Element): string {
    const id = el.id ? `#${el.id}` : "";
    const cls =
      el.className && typeof el.className === "string"
        ? `.${el.className.trim().split(/\s+/).join(".")}`
        : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  }

  function findRenderedBackground(start: Element): {
    color: Rgba;
    source: string;
  } {
    let node: Element | null = start;
    while (node) {
      const style = window.getComputedStyle(node);
      const bg = parseColor(style.backgroundColor);
      // `a > 0` rather than `a === 1`: a partially transparent paint still visually contributes, and
      // treating it as "the" background (rather than compositing it against whatever is further up) is
      // a documented simplification, not an oversight - true alpha compositing would need every ancestor
      // layer's own paint order, which this mechanical check does not attempt. Almost every real pair in
      // this codebase is fully opaque (`tokens.css` declares solid colours throughout), so the
      // simplification costs nothing in practice and is stated here rather than silently assumed.
      if (bg && bg.a > 0) {
        return { color: bg, source: describeSelector(node) };
      }
      node = node.parentElement;
    }

    // Nothing in the chain painted a background - the page's own rendered background, never an assumed
    // white (this file's own doc comment).
    const htmlBg = parseColor(
      window.getComputedStyle(document.documentElement).backgroundColor,
    );
    if (htmlBg && htmlBg.a > 0) {
      return { color: htmlBg, source: "html" };
    }
    const bodyBg = parseColor(
      window.getComputedStyle(document.body).backgroundColor,
    );
    if (bodyBg && bodyBg.a > 0) {
      return { color: bodyBg, source: "body" };
    }

    // Both `html` and `body` are themselves transparent - genuinely nothing in this document paints a
    // background at all, which would make the page's own true rendered colour whatever the browser
    // chrome's default canvas is (conventionally white, but that is the *browser's* default, not this
    // page's). Reached only in that edge case; every real screen in this repository has an opaque
    // `--ago-paper` background on `body` (`design/tokens.css`), so this branch is not expected to fire.
    return {
      color: { r: 255, g: 255, b: 255, a: 1 },
      source: "browser-default(unreachable in this app)",
    };
  }

  function isRenderedVisible(el: Element): boolean {
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      parseFloat(style.opacity || "1") === 0
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // **Shadow-piercing, for the same reason `minSize.ts` is.** A `TreeWalker` rooted at
  // `document.body` never enters a shadow root, so on this repository the console version of this
  // check would walk the host page's own text, find it fine, and report a clean pass having examined
  // none of the widget - the UI this gate exists for. One walker per root, collected below.
  function collectRoots(root: ParentNode, out: ParentNode[]): void {
    out.push(root);
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const shadow = (el as Element & { shadowRoot: ShadowRoot | null })
        .shadowRoot;
      if (shadow) {
        collectRoots(shadow, out);
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

  const roots: ParentNode[] = [];
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const shadow = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (shadow) {
      collectRoots(shadow, roots);
    }
  }

  const makeWalker = (root: Node) =>
    document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent || node.textContent.trim().length === 0) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }
        const tag = parent.tagName.toLowerCase();
        if (tag === "script" || tag === "style") {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

  let scanned = 0;
  const violations: ContrastViolation[] = [];
  const seen = new Set<Element>();

  for (const root of roots) {
    const walker = makeWalker(root);
    let current: Node | null = walker.nextNode();
    while (current) {
      const parent = current.parentElement;
      current = walker.nextNode();
      if (!parent || seen.has(parent) || !isRenderedVisible(parent)) {
        continue;
      }
      seen.add(parent);
      scanned++;

      const style = window.getComputedStyle(parent);
      const fg = parseColor(style.color);
      if (!fg) {
        continue;
      }

      const { color: bg, source } = findRenderedBackground(parent);
      const ratio = contrastRatio(fg, bg);

      const fontSizePx = parseFloat(style.fontSize || "16");
      const fontWeightRaw = style.fontWeight || "400";
      const fontWeight =
        fontWeightRaw === "bold"
          ? 700
          : fontWeightRaw === "normal"
            ? 400
            : parseInt(fontWeightRaw, 10);
      const isLargeText =
        fontSizePx >= LARGE_TEXT_REGULAR_PX ||
        (fontSizePx >= LARGE_TEXT_BOLD_PX &&
          fontWeight >= BOLD_WEIGHT_THRESHOLD);
      const requiredRatio = isLargeText ? AA_LARGE_RATIO : AA_NORMAL_RATIO;

      if (ratio < requiredRatio) {
        violations.push({
          selector: `${describeSelector(parent)} (bg from ${source})`,
          text: (parent.textContent || "").trim().slice(0, 60),
          color: style.color,
          background: `rgba(${bg.r}, ${bg.g}, ${bg.b}, ${bg.a})`,
          ratio: Math.round(ratio * 100) / 100,
          requiredRatio,
          isLargeText,
          fontSizePx,
          fontWeight,
        });
      }
    }
  }

  return { scanned, violations };
}
