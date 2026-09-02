/**
 * `15-11`, assertion 1: "No horizontal overflow". The exact measurement the backlog item names -
 * `document.documentElement.scrollWidth` must not exceed `window.innerWidth` - reproduced verbatim
 * rather than approximated, since the item's own scope records this having been hand-verified on the
 * live widget (375 = 375) as the known-good baseline this check starts from.
 *
 * Passed to `page.evaluate` directly, so it must be self-contained: no imports, no closure over
 * anything outside the browser's own global scope.
 */
export function measureHorizontalOverflow(): { scrollWidth: number; innerWidth: number; overflowPx: number } {
  const scrollWidth = document.documentElement.scrollWidth;
  const innerWidth = window.innerWidth;
  return { scrollWidth, innerWidth, overflowPx: Math.max(0, scrollWidth - innerWidth) };
}
