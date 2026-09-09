import type { ConsentDocumentSummary, ConsentRequirement } from "../consent.js";
import type { WidgetStrings } from "../i18n/strings.js";
import { isValidEmail } from "./emailValidation.js";
import { formatPhoneInput } from "./phoneFormat.js";

/**
 * `23-09`/`docs/design/decisions.md` §4: the visitor's own name-and-phone control - a widget-native
 * form, **not** one of `adr/0065`'s four primitives (`choice_list`/`form`/`confirmation_card`/
 * `date_time_picker`). That ADR's own §4 closes the primitive vocabulary at four kinds, and this item
 * does not amend it: `ui/primitives/render.ts` turns a *message*'s `contentKind`/`content` into DOM,
 * riding a wire contract `ago-chat`/`ago-calendar` both produce steps against - this control is never a
 * message at all, it POSTs straight to `Ago.Chat.Application.UseCases.RecordVisitorContactDetail`
 * (`contactDetails.ts`), so it has no `contentKind` to speak of and reusing `ago-primitive-form`'s own
 * CSS class names here would misname a structurally unrelated thing as one of the four. New,
 * similarly-shaped class names exist for it instead (`ui/styles.ts`'s own `.ago-contact-capture*` rules).
 *
 * <b>Two modes exist in `decisions.md` §4 - verified and unverified. Only the unverified one is built
 * here.</b> The verified mode's own caller (booking, `14-15`/`20-09`) is out of this item's scope; this
 * function's signature carries no verification-related parameter at all, matching that.
 *
 * <b>`23-58`: name, phone and e-mail are all required.</b> Before this item the name rode as optional
 * and there was no e-mail field at all; the author's own decision (the backlog item's own "What this
 * costs" section, recorded there rather than here) trades completion rate for completeness now that a
 * second entry point (the online «Представиться…» link, `ui/widget.ts`'s `appendVisitorIntroControl`)
 * means this form is offered far more often. Submitting records three rows: the phone as
 * `Kind: "Phone"`, the name as `Kind: "Other"` (`VisitorContactDetailKind.Other`'s own remarks name "a
 * preferred name" as exactly this case), and the e-mail as `Kind: "Email"` - not a new kind this item
 * had to add: `VisitorContactDetailKind.Email` already existed in `ago-chat`'s domain (`14-14`) and was
 * simply never a field this widget offered.
 *
 * `24-05`: two more, independently-refusable booleans - `acceptContact`/`acceptMarketing`. Both are
 * `false` unless a checkbox for that purpose was actually rendered *and* ticked; a caller
 * (`ChatWidget.submitContactCapture`) records a consent acceptance only for the ones that came back
 * `true`, and records nothing at all for a purpose this control never showed a control for (a site
 * that never turned `RequireContactConsent` on, or a visitor who already accepted on an earlier visit).
 */
export interface ContactCaptureResult {
  name: string;
  phone: string;
  email: string;
  acceptContact: boolean;
  acceptMarketing: boolean;
}

export type ContactCaptureSubmitHandler = (result: ContactCaptureResult) => Promise<void>;

/**
 * Builds the control's whole DOM subtree: the tenant's own processing notice is not repeated here -
 * `ChatWidget`'s existing panel-level notice (`16-04`, `applyProcessingNotice`) already sits above the
 * whole messages list, so it is read *before* this field in document order without this function
 * needing a second, field-local copy (a decision this item makes explicitly - see the backlog item's
 * own Done-when: "the processing notice is shown before the field", satisfied structurally rather than
 * by building a second notice mechanism).
 *
 * Three states, all in one element the caller can drop into a message bubble the same way
 * `renderPrimitiveContent` does: the form, a disabled/busy form while a submission is in flight, and a
 * plain confirmation sentence once it succeeds. There is no "try again" affordance on failure by
 * design - the form simply re-enables and the visitor can press submit again, the same recoverable
 * shape `ui/widget.ts`'s own `markBubbleFailed` gives a failed message send.
 *
 * `24-05`: `consent` is `null` for every site that has not turned on `RequireContactConsent` (the
 * unchanged-default case) and for a visitor who already accepted on an earlier visit
 * (`contactAlreadyAccepted`/`marketingAlreadyAccepted`) - in both cases this function renders exactly
 * what `23-09` always rendered, no checkbox at all. When a contact checkbox *is* rendered, it carries
 * the native `required` attribute, the identical HTML5-validation mechanism `phoneInput.required`
 * already uses - the browser itself refuses to fire `submit` while it is unticked, so there is no
 * second, hand-rolled validation path to keep in sync with the server's own gate. The checkbox's own
 * label names the tenant's own document title (`ConsentDocumentSummary.title`), set as `textContent`
 * on the link built below - the identical "escaped, never HTML" posture `applyProcessingNotice`
 * already takes for `WidgetConfig.NoticeText`, since this is exactly the same shape of risk: a
 * tenant-supplied string rendered inside a shadow tree this widget's own script controls. AGO never
 * authors this sentence either way (`adr/0076`'s stance, unchanged by this item).
 *
 * `25-27`: before this item that title rendered as a plain, unclickable `<span>` - a visitor was
 * asked to accept a document they had no way to open. `buildConsentLabel` now renders it as a real
 * `<a>`, pointed at that document's public page (`ago-console`'s `/policies/:documentKey`, `23-37`)
 * on the console's own origin (`policyBaseUrl` - a different host from the widget's own `apiBaseUrl`,
 * `config.ts`'s own remarks on `WidgetConfig.policyBaseUrl` say why neither can be inferred from the
 * other), `target="_blank" rel="noreferrer"` so opening it never navigates the visitor's own
 * conversation away. `policyBaseUrl` is threaded through as this function's own parameter rather than
 * the whole `WidgetConfig` for the same reason `siteKey` alone rides through `archive.ts`'s params
 * (this file's own sibling module) instead of a config object: the smallest thing the callee actually
 * needs, not everything the caller happens to have.
 */
export function renderContactCaptureControl(
  strings: WidgetStrings,
  onSubmit: ContactCaptureSubmitHandler,
  consent?: ConsentRequirement | null,
  // `25-27`: required whenever a caller passes a `consent` that can actually show a checkbox -
  // there is no fallback value to reach for instead (`WidgetConfig.policyBaseUrl`'s own doc comment
  // says why none exists), so a caller that forgets it gets a broken link rather than a silently
  // guessed host. Optional only so every pre-25-27 call site that never renders a checkbox at all
  // (`consent` omitted or `null`) does not have to pass a value that would never be read.
  policyBaseUrl?: string,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "ago-contact-capture";

  const form = document.createElement("form");
  form.className = "ago-contact-capture-form";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "ago-contact-capture-input";
  nameInput.placeholder = strings.contactCaptureNamePlaceholder;
  nameInput.setAttribute("aria-label", strings.contactCaptureNamePlaceholder);
  nameInput.autocomplete = "name";
  nameInput.required = true;

  const phoneInput = document.createElement("input");
  phoneInput.type = "tel";
  phoneInput.className = "ago-contact-capture-input";
  phoneInput.placeholder = strings.contactCapturePhonePlaceholder;
  phoneInput.setAttribute("aria-label", strings.contactCapturePhonePlaceholder);
  phoneInput.autocomplete = "tel";
  phoneInput.required = true;

  // `25-28`: the +7 mask, live on every keystroke - `phoneFormat.ts`'s own doc comment carries the
  // full reasoning (hand-rolled vs. library, and the "+<code>" escape hatch for a non-Russian
  // visitor). Reformatting always moves the caret to the end; a hand-rolled mask this small does not
  // attempt to preserve a mid-string cursor position (see that file's own remarks on the trade-off).
  phoneInput.addEventListener("input", () => {
    phoneInput.value = formatPhoneInput(phoneInput.value);
  });

  // `23-58`: the third required field - `VisitorContactDetailKind.Email` on the wire
  // (`recordContactDetail(..., "Email", ...)`, `ui/widget.ts`'s `submitContactCapture`), a kind that
  // already existed in `ago-chat`'s domain and needed no migration to accept.
  const emailInput = document.createElement("input");
  emailInput.type = "email";
  emailInput.className = "ago-contact-capture-input";
  emailInput.placeholder = strings.contactCaptureEmailPlaceholder;
  emailInput.setAttribute("aria-label", strings.contactCaptureEmailPlaceholder);
  emailInput.autocomplete = "email";
  emailInput.required = true;

  // `24-05`: a contact-consent checkbox exists only when the site requires one and this visitor has
  // not already accepted it - `showContactCheckbox`/`showMarketingCheckbox` are each independently
  // false the moment either condition is not met, which is what keeps "already accepted" from nagging
  // a returning visitor and "not required" from ever showing a control at all.
  const showContactCheckbox = Boolean(consent?.contactRequired && consent.contact && !consent.contactAlreadyAccepted);
  const showMarketingCheckbox = Boolean(consent?.marketing && !consent.marketingAlreadyAccepted);

  const contactCheckbox = showContactCheckbox ? document.createElement("input") : null;
  if (contactCheckbox) {
    contactCheckbox.type = "checkbox";
    contactCheckbox.className = "ago-contact-capture-consent-input";
    contactCheckbox.required = true;
  }

  const marketingCheckbox = showMarketingCheckbox ? document.createElement("input") : null;
  if (marketingCheckbox) {
    marketingCheckbox.type = "checkbox";
    marketingCheckbox.className = "ago-contact-capture-consent-input";
    // Deliberately no `.required` - `24-05`'s own crux: anything beyond the contact itself is a
    // separate, independently *refusable* control, never a second tick that blocks submission.
  }

  const submitButton = document.createElement("button");
  submitButton.type = "submit";
  submitButton.className = "ago-contact-capture-submit";
  submitButton.textContent = strings.contactCaptureSubmitButton;

  const errorNote = document.createElement("div");
  errorNote.className = "ago-status";
  errorNote.hidden = true;
  errorNote.setAttribute("role", "alert");

  form.append(nameInput, phoneInput, emailInput);
  if (contactCheckbox && consent?.contact) {
    form.appendChild(buildConsentLabel(contactCheckbox, consent.contact, requirePolicyBaseUrl(policyBaseUrl)));
  }

  if (marketingCheckbox && consent?.marketing) {
    form.appendChild(buildConsentLabel(marketingCheckbox, consent.marketing, requirePolicyBaseUrl(policyBaseUrl)));
  }

  form.appendChild(submitButton);
  container.append(form, errorNote);

  const allInputs = [nameInput, phoneInput, emailInput, contactCheckbox, marketingCheckbox].filter(
    (el): el is HTMLInputElement => el !== null,
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    const email = emailInput.value.trim();

    // `23-58`: all three are required (`nameInput.required`/`phoneInput.required`/
    // `emailInput.required` above ask the browser itself), but the browser's own constraint
    // validation only runs for a *user-driven* submit - a programmatically dispatched `submit` event
    // skips it entirely, the same gap `24-05`'s own consent-checkbox guard below already exists to
    // close - so every required field is re-checked here too, never left to the DOM alone.
    if (!name || !phone || !email) {
      return;
    }

    // `25-28`: a real, named regex check (`emailValidation.ts`'s own doc comment names the pattern
    // and why), not `type="email"`'s own loose native checking alone - and, unlike the empty-field
    // guard above, this is the one failure a visitor gets no other signal about, so it is the one
    // that surfaces in `errorNote` rather than silently refusing to submit.
    if (!isValidEmail(email)) {
      errorNote.textContent = strings.contactCaptureEmailInvalidNote;
      errorNote.hidden = false;
      return;
    }

    if (contactCheckbox && !contactCheckbox.checked) {
      return;
    }

    errorNote.hidden = true;
    for (const input of allInputs) {
      input.disabled = true;
    }

    submitButton.disabled = true;
    submitButton.textContent = strings.contactCaptureSubmittingButton;

    onSubmit({
      name,
      phone,
      email,
      acceptContact: contactCheckbox?.checked ?? false,
      acceptMarketing: marketingCheckbox?.checked ?? false,
    })
      .then(() => {
        const confirmation = document.createElement("p");
        confirmation.className = "ago-contact-capture-confirmation";
        confirmation.textContent = strings.contactCaptureConfirmation;
        container.replaceChildren(confirmation);
      })
      .catch(() => {
        for (const input of allInputs) {
          input.disabled = false;
        }

        submitButton.disabled = false;
        submitButton.textContent = strings.contactCaptureSubmitButton;
        errorNote.textContent = strings.contactCaptureFailedNote;
        errorNote.hidden = false;
      });
  });

  return container;
}

/**
 * A `<label>` wrapping one checkbox and a link naming the tenant's own document.
 *
 * `25-27`: before this item the title rendered as a plain, unclickable `<span>` - a visitor was
 * asked to accept a document they had no way to open. It is now a real `<a>` to that document's
 * public page (`ago-console`'s `/policies/:documentKey`, `23-37`), `target="_blank" rel="noreferrer"`
 * - the exact pattern `DocumentsPage.tsx`'s own "read as visitor" link already uses in `ago-console`
 * - so opening it never navigates the visitor's own conversation away. `textContent`, never
 * `innerHTML`: the tenant's own title is untrusted, escaped exactly as the `<span>` it replaces
 * already escaped it (`renderContactCaptureControl`'s own doc comment on this, above).
 *
 * The link's own `click` handler calls `stopPropagation`, and that is what keeps the checkbox's own
 * click target from becoming ambiguous: without it, a click on the link both opens the policy *and*
 * bubbles up to this `<label>`, whose native click-forwarding would toggle the checkbox underneath it
 * - a visitor who meant only to read the document would also have silently agreed to it. Nothing
 * about the checkbox's own click target changes: clicking it directly, or anywhere else in the
 * label, is unaffected (`contactCapture.test.ts`'s own "consent link" tests verify both directions).
 */
function buildConsentLabel(
  checkbox: HTMLInputElement,
  summary: ConsentDocumentSummary,
  policyBaseUrl: string,
): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "ago-contact-capture-consent";
  const link = document.createElement("a");
  link.className = "ago-contact-capture-consent-link";
  link.href = `${policyBaseUrl}/policies/${encodeURIComponent(summary.documentKey)}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = summary.title;
  link.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  label.append(checkbox, link);
  return label;
}

/**
 * `25-27`: `policyBaseUrl` has no fallback to guess - `WidgetConfig.policyBaseUrl`'s own doc comment
 * says why no such fallback exists to reach for. A caller that gets this far (a checkbox is actually
 * about to render) with no value passed failed to wire the one thing this feature needs; a loud
 * throw here beats silently linking a visitor to `undefined/policies/...`.
 */
function requirePolicyBaseUrl(policyBaseUrl: string | undefined): string {
  if (!policyBaseUrl) {
    throw new Error("AGO Chat widget: a consent document is being rendered with no policyBaseUrl configured.");
  }

  return policyBaseUrl;
}
