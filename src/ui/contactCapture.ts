import type { ConsentRequirement } from "../consent.js";
import type { WidgetStrings } from "../i18n/strings.js";

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
 * label is always the tenant's own document title (`ConsentDocumentSummary.title`), rendered as
 * `textContent` - the identical "escaped, never HTML" posture `applyProcessingNotice` already takes
 * for `WidgetConfig.NoticeText`, since this is exactly the same shape of risk: a tenant-supplied string
 * rendered inside a shadow tree this widget's own script controls. AGO never authors this sentence
 * either way (`adr/0076`'s stance, unchanged by this item).
 */
export function renderContactCaptureControl(
  strings: WidgetStrings,
  onSubmit: ContactCaptureSubmitHandler,
  consent?: ConsentRequirement | null,
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
    form.appendChild(buildConsentLabel(contactCheckbox, consent.contact.title));
  }

  if (marketingCheckbox && consent?.marketing) {
    form.appendChild(buildConsentLabel(marketingCheckbox, consent.marketing.title));
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

/** A `<label>` wrapping one checkbox and its own tenant-supplied sentence - `textContent`, never
 * `innerHTML`, this function's own doc comment on why. */
function buildConsentLabel(checkbox: HTMLInputElement, text: string): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "ago-contact-capture-consent";
  const span = document.createElement("span");
  span.textContent = text;
  label.append(checkbox, span);
  return label;
}
