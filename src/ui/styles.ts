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
    /* 25-141: the unread badge's own colour, deliberately independent of --ago-accent above - the
       badge has to read as "something new happened" against whatever brand colour a tenant's site
       configured for the launcher itself (ui/appearance.ts's parseWidgetColor can set --ago-accent
       to anything), so unlike every other custom property in this file this one is never
       overridden per-site. */
    --ago-unread-badge-bg: #e5372e;
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
    background:
      radial-gradient(140% 140% at 100% 0%, color-mix(in srgb, var(--ago-accent) 65%, white 25%), transparent 60%),
      color-mix(in srgb, var(--ago-accent) 82%, black);
    color: #fff;
    font-size: 1.5rem;
    cursor: pointer;
    box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.25);
    /* 25-141: the unread badge (.ago-unread-badge below) is positioned relative to this button. */
    position: relative;
  }

  /* 25-141: the closed launcher's own unread-count badge (ui/widget.ts's renderUnreadBadge is the
     only thing that ever shows or sizes it - this rule only ever draws it when the JS has already
     decided it should be visible, via the plain hidden attribute rather than a class). Pinned to
     the button's own top-right corner rather than laid out beside the icon, the common "notification
     badge on an icon button" placement. The white ring (box-shadow) keeps it visually separate from
     the launcher's own background at any --ago-accent a tenant has configured, so the two never
     merge into one blob at the corner they share. */
  .ago-unread-badge {
    position: absolute;
    top: -0.1875rem;
    right: -0.1875rem;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 0.25rem;
    border-radius: 999px;
    background: var(--ago-unread-badge-bg);
    color: #fff;
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 1.25rem;
    text-align: center;
    box-shadow: 0 0 0 0.125rem #fff;
  }

  .ago-toggle:focus-visible,
  .ago-send:focus-visible,
  .ago-close:focus-visible,
  .ago-input:focus-visible,
  .ago-emoji:focus-visible,
  .ago-emoji-cell:focus-visible,
  .ago-channel-switcher-row:focus-visible {
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
    background:
      radial-gradient(140% 140% at 100% 0%, color-mix(in srgb, var(--ago-accent) 65%, white 25%), transparent 60%),
      color-mix(in srgb, var(--ago-accent) 82%, black);
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

  /* 23-78's own finding, restated for the identical bug found one element over on the same pass:
     createProcessingNotice builds this element hidden = true and only reveals it once a site's own
     notice text or URL actually arrives - but the display: flex two rules above is an author rule
     with no [hidden] exception, so it silently outranks the browser's own [hidden] default the same
     way .ago-attach's did. Every widget on every site that has never configured a processing notice
     was rendering this as a real, empty, 17px grey strip under the header - not absent, just blank. */
  .ago-processing-notice[hidden] {
    display: none;
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
    background:
      radial-gradient(140% 140% at 100% 0%, color-mix(in srgb, var(--ago-accent) 65%, white 25%), transparent 60%),
      color-mix(in srgb, var(--ago-accent) 82%, black);
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
     it is - a message from the shop - with a left-border accent distinguishing it from an operator's
     own reply. 14-04 also gave this bubble a visible "automatic reply" label so a visitor was never
     misled into thinking a person answered; 25-154 removed that label entirely (the author's own
     explicit decision, not an oversight) - this base shape is unrelated to the label and is unchanged
     by that removal. A reader of 14-04 should not conclude the label still exists from this rule's
     survival. */
  .ago-message--auto {
    align-self: flex-start;
    background: #f0f1f4;
    color: #1a1a1a;
    border-bottom-left-radius: 0.125rem;
    border-left: 2px solid #c7c9d1;
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

  /* 25-130: min-height joins the existing max-height here rather than as a rows attribute on the
     <textarea> element (ui/widget.ts) - both bounds on this box's own vertical size already live
     in this one rule, and a floor set as a DOM attribute instead would split "how tall this box is
     allowed to be" across a stylesheet and a piece of markup for no reason. 5.5rem, not a round
     guess: this element is box-sizing: border-box (this file's own * rule), so the floor has to
     account for the padding and border below it too - 0.5rem*2 vertical padding + 0.0625rem*2 border
     leaves 4.4375rem for content, and three lines at this element's own inherited line-height (.ago-
     root's line-height: 1.4 against its font-size: 1rem, i.e. 1.4rem/line) need 4.2rem, so 5.5rem
     clears three full lines with a little to spare rather than clipping the third by a hair. */
  .ago-input {
    flex: 1;
    resize: none;
    border: 0.0625rem solid #d1d5db;
    border-radius: 0.5rem;
    padding: 0.5rem 0.625rem;
    font: inherit;
    min-height: 5.5rem;
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
    background:
      radial-gradient(140% 140% at 100% 0%, color-mix(in srgb, var(--ago-accent) 65%, white 25%), transparent 60%),
      color-mix(in srgb, var(--ago-accent) 82%, black);
    color: #fff;
    padding: 0;
    cursor: pointer;
    font: inherit;
    font-size: 1rem;
    line-height: 1;
  }

  .ago-send:disabled,
  .ago-attach:disabled,
  .ago-emoji:disabled,
  .ago-save:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* 23-61/23-62/25-120: the second row - attach (moved down from the field's own row), the emoji
     picker's own trigger (25-120, filling the place 23-61 reserved), then save (23-62),
     align-items: center so every icon lines up on one baseline rather than sitting off it.

     25-120: position: relative is new - the one thing .ago-emoji-picker below needs from this
     row in order to anchor itself above it (position: absolute there) rather than the viewport;
     nothing else in this rule changes for it. */
  .ago-composer-controls {
    position: relative;
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
     aligned strip.

     25-120: .ago-emoji fills 23-61's own reserved place with the identical box, for the identical
     reason - it used to be .ago-composer-reserved's own copy of these same four rules further down;
     this is that rule inherited by the real button rather than duplicated a third time. */
  .ago-attach,
  .ago-emoji,
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

  /* 23-78: found live, 2026-09-16 - attachButton.hidden = true (this button's own default, and
     onAttachmentUploadGrantChange's own toggle) set the hidden attribute correctly, but had no
     visible effect: the browser's own [hidden] display:none UA rule loses to any author rule that
     sets display on the same element, regardless of selector specificity, because author-origin CSS
     always outranks user-agent-origin CSS for a plain, non-important declaration - and the rule just
     above sets display: flex unconditionally. .ago-panel[hidden] above already has to say this
     explicitly for the identical reason; this button needed the same explicit override and never had
     it, so every visitor saw the attach button regardless of whether they held a grant. */
  .ago-attach[hidden] {
    display: none;
  }

  /* 25-120: the picker's own popover - anchored to .ago-composer-controls (position: relative
     above), not to the viewport, so it moves with the row it belongs to rather than needing its own
     coordinate math. left: 0 only, no right - an explicit width would either overflow the panel
     on the narrow side or leave dead space on the wide one; shrink-to-fit content sizing (the default
     for an absolutely positioned block with no width set) sizes it to the grid's own eight columns
     and nothing more, comfortably inside .ago-panel's own content width either way this row's
     buttons sit. A second, differently-styled overlay mechanism is exactly what this item's own
     "Where this is likely to go wrong" warns against - this reuses the row's own icon sizing
     (.ago-emoji-cell below matches .ago-attach/.ago-emoji/.ago-save's own 2rem box) and the
     panel's own surface (white, rounded, shadowed) rather than inventing a second look. */
  .ago-emoji-picker {
    position: absolute;
    left: 0;
    bottom: calc(100% + 0.5rem);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    background: #fff;
    border: 0.0625rem solid #d1d5db;
    border-radius: 0.5rem;
    box-shadow: 0 0.25rem 1rem rgba(0, 0, 0, 0.2);
    padding: 0.375rem;
    z-index: 1;
  }

  .ago-emoji-picker[hidden] {
    display: none;
  }

  .ago-emoji-picker-row {
    display: flex;
    gap: 0.25rem;
  }

  /* Same 2rem box .ago-attach/.ago-emoji/.ago-save already use, for the identical WCAG 2.5.8
     reason that rule's own comment states - forty of these are ux-gate's own minSize.ts scanning
     every one of them, not just the row's three single buttons. */
  .ago-emoji-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: none;
    background: transparent;
    border-radius: 0.25rem;
    font-size: 1.25rem;
    line-height: 1;
    padding: 0;
    cursor: pointer;
  }

  .ago-emoji-cell:hover {
    background: rgba(0, 0, 0, 0.08);
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
  /* 20-07: the module invocation chip. Its only behaviour is inserting and sending a trigger phrase
     (ui/widget.ts's invokeModule), so it needs no view state of its own beyond disabled/hidden.

     25-126: found live, squeezed into the cramped header row and styled as plain, transparent text -
     a real, already-wired <button> that read as a link. ui/widget.ts's loadBookingModuleChip now
     inserts it as its own child of .ago-panel (a flex column), directly above the composer, rather
     than into the header - so this rule now also has to size and place it there, not just paint it.
     align-self: flex-end overrides .ago-panel's own default align-items: stretch (which would
     otherwise stretch a plain block-level flex child to the panel's full width, the cross-axis
     behaviour a column flex container gives every child that does not opt out of it) - the chip
     should size to its own label, sitting to the right, above the composer, matching the author's own
     screenshot annotation. margin on three sides only (not top) keeps it clear of .ago-messages
     above and .ago-composer below without a fourth, redundant gap collapsing against either.

     Painted as the panel's one existing labelled call-to-action already is
     (.ago-contact-capture-submit/.ago-primitive-form-submit: solid --ago-accent, white text,
     0.5rem radius) rather than invented fresh - a second, differently-styled "primary button" look
     in the same panel would read as two different vocabularies for the same kind of control. Padding
     is a notch more generous than those two (0.5rem 1rem vs 0.375rem 0.75rem) since this chip is
     the one call-to-action a visitor sees before typing anything, not a small in-thread affordance. */
  .ago-module-chip {
    align-self: flex-end;
    margin: 0 0.75rem 0.5rem;
    border: none;
    border-radius: 0.5rem;
    background:
      radial-gradient(140% 140% at 100% 0%, color-mix(in srgb, var(--ago-accent) 65%, white 25%), transparent 60%),
      color-mix(in srgb, var(--ago-accent) 82%, black);
    color: #fff;
    font: inherit;
    font-weight: 600;
    padding: 0.5rem 1rem;
    cursor: pointer;
  }

  .ago-module-chip:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* 25-149: the channel-switcher card - "directly above the composer," the item's own words, the
     identical anchor .ago-module-chip above already uses (this file's own remarks up there). Reuses
     existing tokens only, nothing parallel: background/radius are .ago-panel's own literal values
     (#fff, 0.75rem) rather than a second surface colour, and the three-sided margin is
     .ago-module-chip's own (0 0.75rem 0.5rem) - the identical clearance from .ago-messages above and
     .ago-composer below. A role="group" region (ui/widget.ts), not a list - the rows read as one
     group of alternatives, not an enumerated sequence. */
  .ago-channel-switcher {
    display: flex;
    flex-direction: column;
    background: #fff;
    border-radius: 0.75rem;
    margin: 0 0.75rem 0.5rem;
  }

  /* 25-149: one row, whether a real anchor (a connected channel) or a button (the "stay here" row
     below) - both need the identical layout, so this rule targets the shared class rather than each
     element type. No brand colour here: ui/widget.ts sets color per row inline, a small,
     widget-local per-kind constant deliberately independent of --ago-accent (this file's own remarks
     on --ago-unread-badge-bg already give the identical "must read against whatever a tenant
     configured" reasoning) - .ago-channel-switcher-row itself stays colour-neutral so the "stay here"
     row (which never gets that inline colour) reads in the panel's own ordinary text colour instead. */
  .ago-channel-switcher-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border: none;
    background: transparent;
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }

  /* 25-149: "visually distinct (no brand colour)" - the item's own words for the final row. The
     divider is .ago-composer's own border-top literal (0.0625rem solid #e5e7eb), reused rather than a
     second rule invented for one more horizontal line - and a lighter weight than the channel rows
     above it, since it is the fallback action, not one more channel to pick. */
  .ago-channel-switcher-row--dismiss {
    border-top: 0.0625rem solid #e5e7eb;
    font-weight: 500;
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
    background:
      radial-gradient(140% 140% at 100% 0%, color-mix(in srgb, var(--ago-accent) 65%, white 25%), transparent 60%),
      color-mix(in srgb, var(--ago-accent) 82%, black);
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
    background:
      radial-gradient(140% 140% at 100% 0%, color-mix(in srgb, var(--ago-accent) 65%, white 25%), transparent 60%),
      color-mix(in srgb, var(--ago-accent) 82%, black);
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
