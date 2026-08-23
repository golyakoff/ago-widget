/**
 * Injected inside the Shadow DOM root only - never touches the host page's own stylesheet
 * (embeddable-widget skill's Hard constraints). Sizes are `rem`/`em` and layout is flex-based so
 * the panel stays usable at 200% browser zoom rather than clipping at a fixed pixel size.
 */
export const widgetStyles = /* css */ `
  :host {
    all: initial;
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

  .ago-toggle {
    width: 3.5rem;
    height: 3.5rem;
    border-radius: 50%;
    border: none;
    background: #2f6fed;
    color: #fff;
    font-size: 1.5rem;
    cursor: pointer;
    box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.25);
  }

  .ago-toggle:focus-visible,
  .ago-send:focus-visible,
  .ago-close:focus-visible,
  .ago-input:focus-visible {
    outline: 0.1875rem solid #2f6fed;
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

  .ago-panel[hidden] {
    display: none;
  }

  .ago-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: #2f6fed;
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
    background: #2f6fed;
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
    background: #2f6fed;
    color: #fff;
    padding: 0 1rem;
    cursor: pointer;
    font: inherit;
  }

  .ago-send:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;
