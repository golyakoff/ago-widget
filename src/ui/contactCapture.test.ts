import { describe, expect, it, vi } from "vitest";
import { renderContactCaptureControl } from "./contactCapture.js";
import type { ConsentRequirement } from "../consent.js";
import { en } from "../i18n/en.js";

function submitButton(root: HTMLElement): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(".ago-contact-capture-submit");
  if (button === null) {
    throw new Error("no submit button");
  }

  return button;
}

function phoneInput(root: HTMLElement): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>('input[type="tel"]');
  if (input === null) {
    throw new Error("no phone input");
  }

  return input;
}

function nameInput(root: HTMLElement): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>('input[type="text"]');
  if (input === null) {
    throw new Error("no name input");
  }

  return input;
}

function setValue(element: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
}

describe("renderContactCaptureControl", () => {
  it("does not call onSubmit if the phone field is empty - it is required", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit);
    const form = control.querySelector("form")!;

    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await Promise.resolve();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the trimmed phone and name, and shows a confirmation once it resolves", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit);
    const form = control.querySelector("form")!;

    setValue(nameInput(control), "  Ivan  ");
    setValue(phoneInput(control), "  +7 000 000-00-01  ");
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Ivan",
      phone: "+7 000 000-00-01",
      acceptContact: false,
      acceptMarketing: false,
    });

    await vi.waitFor(() => {
      expect(control.textContent).toContain(en.contactCaptureConfirmation);
    });
    // The form is gone entirely once confirmed, not merely disabled - `renderContactCaptureControl`'s
    // own `container.replaceChildren(confirmation)`.
    expect(control.querySelector("form")).toBeNull();
  });

  it("submits with an empty name when the visitor leaves it blank", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit);
    const form = control.querySelector("form")!;

    setValue(phoneInput(control), "+7 000 000-00-01");
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "",
      phone: "+7 000 000-00-01",
      acceptContact: false,
      acceptMarketing: false,
    });
  });

  it("disables the form while a submission is in flight", async () => {
    let resolveSubmit: () => void = () => undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const control = renderContactCaptureControl(en, onSubmit);
    const form = control.querySelector("form")!;

    setValue(phoneInput(control), "+7 000 000-00-01");
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(phoneInput(control).disabled).toBe(true);
    expect(submitButton(control).disabled).toBe(true);
    expect(submitButton(control).textContent).toBe(en.contactCaptureSubmittingButton);

    resolveSubmit();
    await vi.waitFor(() => {
      expect(control.textContent).toContain(en.contactCaptureConfirmation);
    });
  });

  it("re-enables the form and shows an error note when the submission is rejected", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("server said no"));
    const control = renderContactCaptureControl(en, onSubmit);
    const form = control.querySelector("form")!;

    setValue(phoneInput(control), "+7 000 000-00-01");
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    await vi.waitFor(() => {
      expect(phoneInput(control).disabled).toBe(false);
    });
    expect(submitButton(control).disabled).toBe(false);
    expect(control.textContent).toContain(en.contactCaptureFailedNote);
    // Recoverable, not terminal: the form itself is still there to try again.
    expect(control.querySelector("form")).not.toBeNull();
  });
});

// `24-05`: the visitor's own consent checkbox(es) - a required one gating the contact write, and an
// optional one for anything beyond it.
describe("renderContactCaptureControl - consent", () => {
  const requiredConsent: ConsentRequirement = {
    contactRequired: true,
    contact: { title: "I agree to be contacted about my order.", body: "Full text." },
    contactAlreadyAccepted: false,
    marketing: null,
    marketingAlreadyAccepted: false,
  };

  function consentCheckboxes(root: HTMLElement): HTMLInputElement[] {
    return [...root.querySelectorAll<HTMLInputElement>(".ago-contact-capture-consent-input")];
  }

  it("renders no checkbox at all when consent is not passed (the pre-24-05 shape)", () => {
    const control = renderContactCaptureControl(en, vi.fn());

    expect(consentCheckboxes(control)).toHaveLength(0);
  });

  it("renders no checkbox when the site does not require contact consent", () => {
    const notRequired: ConsentRequirement = {
      contactRequired: false,
      contact: null,
      contactAlreadyAccepted: false,
      marketing: null,
      marketingAlreadyAccepted: false,
    };
    const control = renderContactCaptureControl(en, vi.fn(), notRequired);

    expect(consentCheckboxes(control)).toHaveLength(0);
  });

  it("renders the tenant's own title as the required checkbox's own label text, escaped", () => {
    const control = renderContactCaptureControl(en, vi.fn(), requiredConsent);

    const label = control.querySelector(".ago-contact-capture-consent");
    expect(label?.textContent).toBe("I agree to be contacted about my order.");
    const checkbox = consentCheckboxes(control)[0]!;
    expect(checkbox.required).toBe(true);
    expect(checkbox.checked).toBe(false);
  });

  it("does not call onSubmit when required and the checkbox is left unticked", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit, requiredConsent);
    const form = control.querySelector("form")!;

    setValue(phoneInput(control), "+7 000 000-00-01");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await Promise.resolve();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onSubmit with acceptContact true once the required checkbox is ticked", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit, requiredConsent);
    const form = control.querySelector("form")!;

    setValue(phoneInput(control), "+7 000 000-00-01");
    consentCheckboxes(control)[0]!.checked = true;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "+7 000 000-00-01", acceptContact: true, acceptMarketing: false }),
    );
  });

  it("renders no checkbox at all once this visitor has already accepted", () => {
    const alreadyAccepted: ConsentRequirement = { ...requiredConsent, contactAlreadyAccepted: true };
    const control = renderContactCaptureControl(en, vi.fn(), alreadyAccepted);

    expect(consentCheckboxes(control)).toHaveLength(0);
  });

  it("a marketing checkbox is never required, and refusing it still lets the contact write through", () => {
    const withMarketing: ConsentRequirement = {
      contactRequired: false,
      contact: null,
      contactAlreadyAccepted: false,
      marketing: { title: "Also send me offers.", body: "Full text." },
      marketingAlreadyAccepted: false,
    };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit, withMarketing);
    const form = control.querySelector("form")!;

    const checkboxes = consentCheckboxes(control);
    expect(checkboxes).toHaveLength(1);
    expect(checkboxes[0]!.required).toBe(false);
    expect(control.querySelector(".ago-contact-capture-consent")?.textContent).toBe("Also send me offers.");

    // Left unticked, deliberately - refusing marketing must never block the contact write.
    setValue(phoneInput(control), "+7 000 000-00-01");
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ acceptContact: false, acceptMarketing: false }));
  });

  it("both checkboxes can be shown together, contact required and marketing optional, independently", () => {
    const both: ConsentRequirement = {
      ...requiredConsent,
      marketing: { title: "Also send me offers.", body: "Full text." },
    };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit, both);
    const form = control.querySelector("form")!;

    const checkboxes = consentCheckboxes(control);
    expect(checkboxes).toHaveLength(2);
    checkboxes[0]!.checked = true; // contact - required
    checkboxes[1]!.checked = true; // marketing - optional, ticked anyway
    setValue(phoneInput(control), "+7 000 000-00-01");
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ acceptContact: true, acceptMarketing: true }));
  });
});
