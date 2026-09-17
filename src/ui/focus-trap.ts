/**
 * Traps Tab/Shift+Tab inside `container` only while active - embeddable-widget skill's
 * accessibility baseline: "focus trapped only while open". Deliberately minimal: this widget's
 * own panel has a small, known set of focusable elements, so a full focus-trap library would add
 * bundle weight for a problem three lines of modulo arithmetic already solves.
 */
export class FocusTrap {
  private active = false;
  private readonly onKeydown = (event: KeyboardEvent): void => this.handleKeydown(event);

  constructor(private readonly container: HTMLElement) {}

  activate(): void {
    this.active = true;
    this.container.addEventListener("keydown", this.onKeydown);
  }

  deactivate(): void {
    this.active = false;
    this.container.removeEventListener("keydown", this.onKeydown);
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.active || event.key !== "Tab") {
      return;
    }

    const focusable = this.focusableElements();
    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const current = this.container.getRootNode() instanceof ShadowRoot
      ? (this.container.getRootNode() as ShadowRoot).activeElement
      : document.activeElement;

    if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * `25-120`: `.tabIndex !== -1` is the second half of the filter now, not only `disabled` - found
   * while wiring the emoji picker's own roving-tabindex grid (`ui/widget.ts`'s `emojiCells`), the
   * standard composite-widget technique where 39 of 40 sibling `<button>`s sit at `tabIndex = -1`
   * and one at `0`, all of them simultaneously **enabled** (a disabled button cannot be clicked by
   * the mouse either, so "disable the 39 you're not tabbed to" was never an option - only the
   * roving `tabindex` itself, never `disabled`, is allowed to vary here). The plain `button`/`input`/
   * `select`/`textarea` selectors above match every one of those 40 regardless of their own
   * `tabindex` value - only the extra, additional `[tabindex]:not([tabindex="-1"])` clause ever
   * excluded `-1`, and it only applies to elements that need a `tabindex` attribute to be focusable
   * at all (a `<div tabindex="0">`), never to a `<button>`, which this selector list already matches
   * unconditionally. Without this, `focusableElements()` counted all 40 (enabled) cells as
   * candidates for "first"/"last" whenever the picker was open, so `Tab`/`Shift+Tab` at the panel's
   * real boundary could wrap to a cell nobody could actually reach by pressing Tab (native tabbing
   * already skips `tabIndex === -1` on its own) instead of the panel's genuine last stop - focus
   * would walk straight out of the trap instead of wrapping. No existing control in this file sets an
   * explicit `tabIndex` away from its default, so this only ever changes behaviour for a
   * roving-tabindex group like the emoji grid's; every element this trap already handled correctly
   * keeps its default (unset) `tabIndex`, which is never `-1`.
   */
  private focusableElements(): HTMLElement[] {
    return [
      ...this.container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);
  }
}
