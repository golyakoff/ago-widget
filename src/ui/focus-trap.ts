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

  private focusableElements(): HTMLElement[] {
    return [
      ...this.container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => !element.hasAttribute("disabled"));
  }
}
