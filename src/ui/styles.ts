/**
 * Injected inside the Shadow DOM root only - never touches the host page's own stylesheet
 * (embeddable-widget skill's Hard constraints). Sizes are `rem`/`em` and layout is flex-based so
 * the panel stays usable at 200% browser zoom rather than clipping at a fixed pixel size.
 */
export const widgetStyles = /* css */ `
  :host {
    all: initial;
    /* 11-03: the widget's own built-in default - overridden per-instance via
       host.style.setProperty("--ago-accent", ...) once a valid site color is known
       (ui/appearance.ts's parseWidgetColor). "all: initial" above does not reset this: custom
       properties are explicitly excluded from the "all" shorthand, so inheritance from the host
       element into this shadow tree still works. */
    --ago-accent: #2f6fed;
  }

  * {
    box-sizing: border-box;
  }

  .ago-root {
    position: fixed;
    right: 1.25rem;
    bottom: 1.25rem;
    z-index: 2147483647;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 1rem;
    line-height: 1.4;
    color: #1a1a1a;
  }

  /* 11-03: the launcher's mirror-image placement - Ago.Chat.Domain.Position.BottomLeft
     (ui/appearance.ts's parseWidgetPosition maps it to this class). Both the toggle's own
     fixed position and the panel's attachment side (below) flip together, so the panel always
     opens on the side its own toggle button sits on. */
  .ago-root.ago-position-left {
    right: auto;
    left: 1.25rem;
  }

  .ago-toggle {
    width: 3.5rem;
    height: 3.5rem;
    border-radius: 50%;
    border: none;
    background: var(--ago-accent);
    color: #fff;
    font-size: 1.5rem;
    cursor: pointer;
    box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.25);
  }

  .ago-toggle:focus-visible,
  .ago-send:focus-visible,
  .ago-close:focus-visible,
  .ago-input:focus-visible {
    outline: 0.1875rem solid var(--ago-accent);
    outline-offset: 0.125rem;
  }

  @media (prefers-reduced-motion: no-preference) {
    .ago-panel {
      transition: opacity 120ms ease-out, transform 120ms ease-out;
    }
  }

  .ago-panel {
    position: absolute;
    right: 0;
    bottom: 4.25rem;
    width: min(22rem, calc(100vw - 2.5rem));
    max-height: min(32rem, calc(100vh - 8rem));
    display: flex;
    flex-direction: column;
    background: #fff;
    border-radius: 0.75rem;
    box-shadow: 0 0.5rem 2rem rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .ago-root.ago-position-left .ago-panel {
    right: auto;
    left: 0;
  }

  .ago-panel[hidden] {
    display: none;
  }

  .ago-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: var(--ago-accent);
    color: #fff;
  }

  .ago-header h1 {
    font-size: 1rem;
    margin: 0;
    font-weight: 600;
  }

  .ago-close {
    background: transparent;
    border: none;
    color: #fff;
    font-size: 1.25rem;
    cursor: pointer;
    line-height: 1;
    padding: 0.25rem;
  }

  /* 8-06. Deliberately not tinted with --ago-accent: the accent is the site's own brand colour
     (11-03), and a warning painted in the brand colour reads as decoration. Amber-on-dark-amber at
     a contrast ratio well past 4.5:1, fixed rather than themed, so it looks like an interruption in
     the panel rather than part of it - and so it renders identically regardless of which of the two
     demo pages (light or dark) it is floating over, since the panel's own background is white in
     both. Full width, no border-radius, no icon: it is a strip, not a card. */
  .ago-notice {
    background: #fff4d6;
    border-bottom: 0.0625rem solid #e0b34a;
    color: #5c4008;
    font-size: 0.8125rem;
    line-height: 1.35;
    padding: 0.5rem 0.75rem;
  }

  .ago-messages {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 12rem;
  }

  .ago-message {
    max-width: 85%;
    padding: 0.5rem 0.75rem;
    border-radius: 0.75rem;
    word-wrap: break-word;
    white-space: pre-wrap;
  }

  .ago-message--visitor {
    align-self: flex-end;
    background: var(--ago-accent);
    color: #fff;
    border-bottom-right-radius: 0.125rem;
  }

  .ago-message--pending {
    opacity: 0.6;
  }

  .ago-message--operator {
    align-self: flex-start;
    background: #f0f1f4;
    color: #1a1a1a;
    border-bottom-left-radius: 0.125rem;
  }

  .ago-message--system {
    align-self: center;
    background: transparent;
    color: #6b7280;
    font-size: 0.8125rem;
    text-align: center;
    max-width: 100%;
  }

  .ago-attachment-link {
    display: block;
    margin-top: 0.375rem;
    color: inherit;
  }

  .ago-message--visitor .ago-attachment-link {
    color: #fff;
  }

  .ago-attachment-image {
    display: block;
    max-width: 100%;
    max-height: 12rem;
    border-radius: 0.5rem;
  }

  .ago-status {
    font-size: 0.8125rem;
    color: #6b7280;
    padding: 0 0.75rem 0.5rem;
  }

  .ago-composer {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem;
    border-top: 0.0625rem solid #e5e7eb;
  }

  .ago-input {
    flex: 1;
    resize: none;
    border: 0.0625rem solid #d1d5db;
    border-radius: 0.5rem;
    padding: 0.5rem 0.625rem;
    font: inherit;
    max-height: 6rem;
  }

  .ago-send {
    border: none;
    border-radius: 0.5rem;
    background: var(--ago-accent);
    color: #fff;
    padding: 0 1rem;
    cursor: pointer;
    font: inherit;
  }

  .ago-send:disabled,
  .ago-attach:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .ago-attach {
    border: none;
    background: transparent;
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
  }

  .ago-file-input {
    /* Visually hidden, not display:none - triggered via the visible ago-attach button, but a
       hidden native input stays discoverable to assistive tech this way rather than vanishing
       outright. */
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  /* 20-06: the booking module's own surface, inside the same panel and the same Shadow DOM.
     A list of choices, never a calendar grid - see booking/steps.ts for why the shape of the UI is
     the shape of a message. */
  .ago-booking {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
    overflow-y: auto;
    flex: 1;
  }

  .ago-booking-body {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.4;
  }

  .ago-booking-choices {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .ago-booking-choice {
    border: 1px solid var(--ago-accent);
    border-radius: 0.5rem;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
  }

  .ago-booking-choice:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .ago-booking-form {
    display: flex;
    gap: 0.5rem;
  }

  .ago-booking-input {
    flex: 1;
    font: inherit;
    padding: 0.5rem;
    border: 1px solid #d5d9e0;
    border-radius: 0.5rem;
  }

  .ago-booking-send {
    border: none;
    border-radius: 0.5rem;
    background: var(--ago-accent);
    color: #fff;
    padding: 0 0.75rem;
    cursor: pointer;
    font: inherit;
  }

  .ago-book {
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0 0.5rem;
  }
`;
