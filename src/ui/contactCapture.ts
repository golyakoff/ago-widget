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
 * <b>Name is optional, phone is not.</b> The control asks for both (the author's own suggestion, quoted
 * in `flows.md` 1.2: "показать ему форму ввода телефона и имени"), but only the phone number is what
 * the promise ("we will call you back") depends on - a visitor who skips the name field still gets
 * called back. Submitting records the phone as `Kind: "Phone"` and, only if a name was typed, a second
 * row as `Kind: "Other"` (`VisitorContactDetailKind.Other`'s own remarks name "a preferred name" as
 * exactly this case) - two rows rather than a wider domain schema for one item.
 */
export interface ContactCaptureResult {
  name: string;
  phone: string;
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
 */
export function renderContactCaptureControl(
  strings: WidgetStrings,
  onSubmit: ContactCaptureSubmitHandler,
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

  const phoneInput = document.createElement("input");
  phoneInput.type = "tel";
  phoneInput.className = "ago-contact-capture-input";
  phoneInput.placeholder = strings.contactCapturePhonePlaceholder;
  phoneInput.setAttribute("aria-label", strings.contactCapturePhonePlaceholder);
  phoneInput.autocomplete = "tel";
  phoneInput.required = true;

  const submitButton = document.createElement("button");
  submitButton.type = "submit";
  submitButton.className = "ago-contact-capture-submit";
  submitButton.textContent = strings.contactCaptureSubmitButton;

  const errorNote = document.createElement("div");
  errorNote.className = "ago-status";
  errorNote.hidden = true;
  errorNote.setAttribute("role", "alert");

  form.append(nameInput, phoneInput, submitButton);
  container.append(form, errorNote);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const phone = phoneInput.value.trim();
    if (!phone) {
      return;
    }

    errorNote.hidden = true;
    nameInput.disabled = true;
    phoneInput.disabled = true;
    submitButton.disabled = true;
    submitButton.textContent = strings.contactCaptureSubmittingButton;

    onSubmit({ name: nameInput.value.trim(), phone })
      .then(() => {
        const confirmation = document.createElement("p");
        confirmation.className = "ago-contact-capture-confirmation";
        confirmation.textContent = strings.contactCaptureConfirmation;
        container.replaceChildren(confirmation);
      })
      .catch(() => {
        nameInput.disabled = false;
        phoneInput.disabled = false;
        submitButton.disabled = false;
        submitButton.textContent = strings.contactCaptureSubmitButton;
        errorNote.textContent = strings.contactCaptureFailedNote;
        errorNote.hidden = false;
      });
  });

  return container;
}
