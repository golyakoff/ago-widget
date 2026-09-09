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

    /* 23-63: the keyframe itself. Nested in this same media query as a second, independent line of
       defence alongside ui/widget.ts's own matchMedia check (that file's scheduleAttractAttention
       doc comment has the reasoning for checking twice) - a reduced-motion browser never even
       downloads a reason to render this rule as anything but a no-op, whatever ago-toggle--attract
       gets applied to. Never below scale(1): ux-gate's own minSize check measures the rendered box,
       and a keyframe that only ever grows the launcher (never shrinks it) cannot fail that check no
       matter which instant a screenshot lands on mid-pulse. transform only, both properties - never
       a change to width/height/margin/position, which is what keeps this the widget's own animation
       rather than something that could reflow the host page around it (Shadow DOM's own isolation
       does not by itself stop a layout-affecting property from moving *this element*, only from
       moving the host page's *other* elements - the constraint here is narrower and self-imposed). */
    @keyframes ago-attract {
      0%, 100% {
        transform: scale(1) rotate(0deg);
      }
      20% {
        transform: scale(1.12) rotate(-8deg);
      }
      40% {
        transform: scale(1.05) rotate(6deg);
      }
      60% {
        transform: scale(1.1) rotate(-5deg);
      }
      80% {
        transform: scale(1.02) rotate(3deg);
      }
    }

    /* Duration matches ui/widget.ts's own ATTRACT_PULSE_DURATION_MS - see that constant's doc
       comment for why the two have to agree and where the single source of truth for the number is
       (the JS side, since it is what decides when the class comes back off). */
    .ago-toggle--attract {
      animation: ago-attract 700ms ease-in-out;
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

  /* 16-04. Deliberately the opposite call from .ago-notice just above: that one is a warning and
     stays fixed-palette on purpose; this one is the tenant's own routine disclosure, not an alarm, so
     a neutral strip is the right register - painting it amber would make an ordinary privacy notice
     read as urgent, which it is not. .ago-processing-notice__link *is* tinted with --ago-accent,
     unlike the notice text around it: it is the one interactive element in the strip, and every other
     interactive element in this panel already uses the site's own brand colour to say so. */
  .ago-processing-notice {
    background: #f3f4f6;
    border-bottom: 0.0625rem solid #e5e7eb;
    color: #4b5563;
    font-size: 0.75rem;
    line-height: 1.35;
    padding: 0.5rem 0.75rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .ago-processing-notice__link {
    color: var(--ago-accent);
    font-weight: 600;
    text-decoration: underline;
    white-space: nowrap;
  }

  .ago-processing-notice__link:focus-visible {
    outline: 0.1875rem solid var(--ago-accent);
    outline-offset: 0.125rem;
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

  /* 14-04: an automatic reply. Same incoming-side shape as an operator bubble, because that is what
     it is - a message from the shop - with a label so a visitor is never misled into thinking a
     person answered. The label is a CSS content string rather than a DOM node so that textContent
     stays exactly the message body: a test, a copy-paste or a screen reader reading the bubble gets
     the reply, and the label is announced separately as decoration. */
  .ago-message--auto {
    align-self: flex-start;
    background: #f0f1f4;
    color: #1a1a1a;
    border-bottom-left-radius: 0.125rem;
    border-left: 2px solid #c7c9d1;
  }

  .ago-message--auto::before {
    /* 11-10: threaded through as a CSS custom property, the same mechanism --ago-accent already uses
       for the site's color - a content: pseudo-element string is not a DOM text node, so the widget's
       ordinary string-table lookup (ui/widget.ts's applyStrings) cannot reach it any other way. Set at
       the same point locale is resolved, defaulting to the English default until then. */
    content: var(--ago-auto-reply-label, "Automatic reply");
    display: block;
    font-size: 0.6875rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #6b7280;
    margin-bottom: 0.25rem;
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

  /* Found live: a failed-send note is appended inside the visitor's own bubble
     (markBubbleFailed, ui/widget.ts), whose background is the site's --ago-accent color (blue by
     default) - measured, not assumed: the plain .ago-status gray above (#6b7280) against the default
     accent (#2f6fed) computes to roughly 1.06:1, functionally invisible, not merely "muted". A reduced-
     opacity white (matching .ago-message--visitor .ago-primitive-line-label's own 0.75 a few rules
     below) computes to only ~3.7:1 here - short of WCAG AA's 4.5:1 for this font-size, since this note
     is a failure state a visitor needs to actually read, not a decorative label. Full white, matching
     .ago-message--visitor's own body text color exactly, computes to ~4.55:1 and passes. */
  .ago-message--visitor .ago-status {
    color: #fff;
  }

  /* 23-61: a column of two rows now, not one flex row - the field's own row, then the controls'.
     flex-direction: column is the only structural change here; both rows below are still flex
     rows exactly as .ago-composer used to be, just nested one level down. */
  .ago-composer {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border-top: 0.0625rem solid #e5e7eb;
  }

  /* 23-61: the field's own row - align-items: flex-end keeps the round send button pinned to the
     input's bottom edge as the textarea grows past one line (.ago-input's own max-height: 6rem),
     rather than drifting to the vertical centre of a now-taller row. */
  .ago-composer-row {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
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

  /* 23-61: small and round, icon-only - width/height fixed rather than padded-to-content,
     because a round button's hit area is exactly its box and justify-content/align-items: center
     is what keeps the glyph centred in it. 2.25rem (36px at the default root size) clears WCAG 2.5.8's
     24px floor with margin, checked by ux-gate's own minSize.ts rather than only measured here -
     the backlog item's own warning: "the one control that must never become hard to hit". */
  .ago-send {
    flex-shrink: 0;
    width: 2.25rem;
    height: 2.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: var(--ago-accent);
    color: #fff;
    padding: 0;
    cursor: pointer;
    font: inherit;
    font-size: 1rem;
    line-height: 1;
  }

  .ago-send:disabled,
  .ago-attach:disabled,
  .ago-save:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* 23-61/23-62: the second row - attach (moved down from the field's own row), the still-reserved
     emoji place, then save (23-62), align-items: center so every icon lines up on one baseline
     rather than sitting off it. */
  .ago-composer-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* 23-61: an explicit box, not padding-around-a-glyph - found by ux-gate's own minSize.ts, not by
     reasoning about it by hand (the backlog item's own warning about exactly that failure mode). This
     control used to sit in .ago-composer's single flex row, whose default align-items: stretch
     silently gave it the row's full height (set by .ago-input, its tallest sibling there); moving it
     into .ago-composer-controls - a row of same-sized icons, align-items: center - removed that
     accidental stretch and let it collapse to its own content box: 20px tall (font-size 1.25rem,
     line-height 1, no vertical padding), under WCAG 2.5.8's 24px floor. 2rem (32px) is a size chosen
     on purpose now rather than inherited from a neighbour by accident.

     23-62: .ago-save shares this exact box - the same reasoning applies to a second same-row icon
     button, and a mismatched size here would read as two different kinds of control rather than one
     aligned strip. */
  .ago-attach,
  .ago-save {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: none;
    background: transparent;
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  /* 23-61: a reserved place, styled to look reserved rather than broken or clickable - the
     backlog item's own requirement. Grayscale plus reduced opacity mutes the glyph without needing a
     second icon set; no :hover rule at all, deliberately (the same reasoning 23-31's own CSS
     states for the console's reserved nav entries: "the one thing this row must not look like is
     clickable"). Sized and positioned like .ago-attach so the row reads as one aligned icon strip,
     not because it needs to clear a target-size floor - ux-gate's minSize.ts never scores this
     element at all, because a bare span with no interactive role does not match its selector list
     (that file's own remarks: this is not an interactive element under-sized, it is not an
     interactive element). */
  .ago-composer-reserved {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    font-size: 1.25rem;
    line-height: 1;
    opacity: 0.45;
    filter: grayscale(1);
    cursor: default;
    user-select: none;
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
  /* 20-07: the module invocation chip - a small affordance in the header, not a second panel. Its
     only behaviour is inserting and sending a trigger phrase (ui/widget.ts's invokeModule), so it
     needs no view state of its own beyond disabled/hidden. */
  .ago-module-chip {
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0 0.5rem;
  }

  .ago-module-chip:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* 20-07: the closed primitive vocabulary's own rendering (ui/primitives/render.ts), appended
     inside an ordinary incoming bubble - never a separate panel, because a step is a message now,
     not a view. Sized to sit comfortably under a bubble's own body text rather than as a card of its
     own, matching how the same content would read as a numbered list over a text-only channel. */
  .ago-primitive {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .ago-primitive-title {
    font-weight: 600;
  }

  .ago-primitive-line {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.875rem;
  }

  .ago-primitive-line-label {
    color: #6b7280;
  }

  .ago-message--visitor .ago-primitive-line-label {
    color: rgba(255, 255, 255, 0.75);
  }

  .ago-primitive-choices {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .ago-primitive-choice {
    border: 1px solid var(--ago-accent);
    border-radius: 0.5rem;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
  }

  .ago-message--visitor .ago-primitive-choice {
    border-color: #fff;
  }

  .ago-primitive-choice:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .ago-primitive-form {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .ago-primitive-form-label {
    font-size: 0.8125rem;
  }

  .ago-primitive-form-input {
    font: inherit;
    padding: 0.5rem;
    border: 1px solid #d5d9e0;
    border-radius: 0.5rem;
    color: #1a1a1a;
  }

  .ago-primitive-form-submit {
    align-self: flex-start;
    border: none;
    border-radius: 0.5rem;
    background: var(--ago-accent);
    color: #fff;
    padding: 0.375rem 0.75rem;
    cursor: pointer;
    font: inherit;
  }

  .ago-primitive-form-submit:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* 23-09: the out-of-hours name-and-phone control (ui/contactCapture.ts). Visually similar to
     .ago-primitive-form above by deliberate choice - both are "a small form under an incoming bubble"
     - but under its own class names, because this control is structurally not one of adr/0065's four
     primitives (that file's own doc comment explains why) and sharing a name would suggest otherwise
     to a future reader grepping for it. */
  .ago-contact-capture {
    margin-top: 0.5rem;
  }

  .ago-contact-capture-form {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .ago-contact-capture-input {
    font: inherit;
    padding: 0.5rem;
    border: 1px solid #d5d9e0;
    border-radius: 0.5rem;
    color: #1a1a1a;
  }

  /* 24-05: the visitor's own consent checkbox(es) - a required one for handing over the contact
     itself, and an optional, never-required one for anything beyond it (marketing). Both share this
     one class; only the required attribute set in ui/contactCapture.ts tells them apart. */
  .ago-contact-capture-consent {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.8125rem;
    line-height: 1.3;
    cursor: pointer;
  }

  .ago-contact-capture-consent-input {
    margin-top: 0.15rem;
    flex-shrink: 0;
  }

  /* 25-27: the tenant's own document title, now a real link rather than plain text - underlined
     rather than a colour change alone (the backlog item's own Done-when), the identical
     .ago-processing-notice__link treatment a few rules up already gives the other tenant-facing
     link in this panel. */
  .ago-contact-capture-consent-link {
    color: var(--ago-accent);
    text-decoration: underline;
  }

  .ago-contact-capture-consent-link:focus-visible {
    outline: 0.1875rem solid var(--ago-accent);
    outline-offset: 0.125rem;
  }

  .ago-contact-capture-submit {
    align-self: flex-start;
    border: none;
    border-radius: 0.5rem;
    background: var(--ago-accent);
    color: #fff;
    padding: 0.375rem 0.75rem;
    cursor: pointer;
    font: inherit;
  }

  .ago-contact-capture-submit:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .ago-contact-capture-confirmation {
    margin: 0.5rem 0 0;
    font-size: 0.875rem;
  }

  /* 23-58: the online entry point - a modest, light-grey, link-like control under the visitor's own
     first message. A flex sibling of the message bubbles inside .ago-messages (ChatWidget's own
     appendVisitorIntroControl inserts it with insertAdjacentElement, never nested inside the visitor's
     own accent-colored bubble) - so its grey text sits on the panel's white background, not on
     --ago-accent, which is the whole reason it can use the same #6b7280 .ago-status/.ago-message--system
     already use elsewhere in this file rather than needing a lighter, bubble-specific color of its own
     (this file's own remarks a few rules up measure #6b7280 against --ago-accent's default blue at
     roughly 1.06:1 - functionally invisible - which is exactly the pairing this placement avoids). */
  .ago-contact-capture-intro {
    align-self: flex-end;
  }

  /* A real button element, styled to read as a link - ui/widget.ts's own remarks on why: the
     accessible name and keyboard reach a backlog item asked for come from the element being a button,
     not from imitating one with a span. min-height keeps it clear of the ux-gate's 24px
     undersized-interactive floor even though the label's own font-size is smaller than that. */
  .ago-contact-capture-intro-link {
    font: inherit;
    font-size: 0.8125rem;
    color: #6b7280;
    background: none;
    border: none;
    padding: 0.375rem 0.25rem;
    margin: 0;
    min-height: 1.5rem;
    text-decoration: underline;
    cursor: pointer;
  }
`;
