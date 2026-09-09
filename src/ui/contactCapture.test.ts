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

function emailInput(root: HTMLElement): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>('input[type="email"]');
  if (input === null) {
    throw new Error("no email input");
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

    setValue(nameInput(control), "Ivan");
    setValue(emailInput(control), "ivan@example.invalid");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await Promise.resolve();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  // `23-58`: name, phone and e-mail are all required now (`docs/backlog/23-58`'s own Done-when) -
  // before this item the name rode as optional, which is what this test used to cover instead.
  it("does not call onSubmit if the name field is empty - it is required", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit);
    const form = control.querySelector("form")!;

    setValue(phoneInput(control), "+7 000 000-00-01");
    setValue(emailInput(control), "ivan@example.invalid");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await Promise.resolve();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  // `23-58`: the new required field, and the manual guard it needs for exactly the reason
  // `phone`'s own guard already exists - a programmatically dispatched `submit` skips the browser's
  // own constraint validation.
  it("does not call onSubmit if the email field is empty - it is required", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit);
    const form = control.querySelector("form")!;

    setValue(nameInput(control), "Ivan");
    setValue(phoneInput(control), "+7 000 000-00-01");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await Promise.resolve();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the trimmed name, phone and email, and shows a confirmation once it resolves", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit);
    const form = control.querySelector("form")!;

    setValue(nameInput(control), "  Ivan  ");
    setValue(phoneInput(control), "  +7 000 000-00-01  ");
    setValue(emailInput(control), "  ivan@example.invalid  ");
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Ivan",
      phone: "+7 000 000-00-01",
      email: "ivan@example.invalid",
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

  // `25-28`: the +7 mask, wired via a live `input` listener - `phoneFormat.ts`'s own tests cover the
  // formatting logic in isolation; this is the wiring proof that it actually runs as the visitor
  // types, not just that the pure function is correct.
  it("masks a bare digit into a +7 Russian shape as the visitor types", () => {
    const control = renderContactCaptureControl(en, vi.fn());
    const input = phoneInput(control);

    setValue(input, "9");
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(input.value).toBe("+7 (9");
  });

  // `25-28`: the stated escape hatch - an explicit "+" followed by a country code other than 7 is
  // left as digits only, never forced into the +7 (9XX) shape.
  it("lets an explicit non-Russian country code through the mask unformatted", () => {
    const control = renderContactCaptureControl(en, vi.fn());
    const input = phoneInput(control);

    setValue(input, "+1555");
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(input.value).toBe("+1555");
  });

  // `25-28`: a real, named regex check runs before submit - not just `type="email"`'s own loose
  // native behaviour, which `jsdom`'s constraint validation would not catch here anyway since this
  // is a programmatically dispatched submit (the same gap the pre-existing required-field guards
  // above already exist to close).
  it("blocks submit and shows the invalid-email note when email fails the regex check", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit);
    const form = control.querySelector("form")!;

    setValue(nameInput(control), "Ivan");
    setValue(phoneInput(control), "+7 000 000-00-01");
    setValue(emailInput(control), "not-an-email");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await Promise.resolve();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(control.textContent).toContain(en.contactCaptureEmailInvalidNote);
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

    setValue(nameInput(control), "Ivan");
    setValue(phoneInput(control), "+7 000 000-00-01");
    setValue(emailInput(control), "ivan@example.invalid");
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

    setValue(nameInput(control), "Ivan");
    setValue(phoneInput(control), "+7 000 000-00-01");
    setValue(emailInput(control), "ivan@example.invalid");
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
  const POLICY_BASE_URL = "https://office.test.invalid";

  const requiredConsent: ConsentRequirement = {
    contactRequired: true,
    contact: {
      documentKey: "site-consent-contact-abc",
      title: "I agree to be contacted about my order.",
      body: "Full text.",
    },
    contactAlreadyAccepted: false,
    marketing: null,
    marketingAlreadyAccepted: false,
  };

  function consentCheckboxes(root: HTMLElement): HTMLInputElement[] {
    return [...root.querySelectorAll<HTMLInputElement>(".ago-contact-capture-consent-input")];
  }

  function consentLinks(root: HTMLElement): HTMLAnchorElement[] {
    return [...root.querySelectorAll<HTMLAnchorElement>(".ago-contact-capture-consent-link")];
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
    const control = renderContactCaptureControl(en, vi.fn(), requiredConsent, POLICY_BASE_URL);

    const label = control.querySelector(".ago-contact-capture-consent");
    expect(label?.textContent).toBe("I agree to be contacted about my order.");
    const checkbox = consentCheckboxes(control)[0]!;
    expect(checkbox.required).toBe(true);
    expect(checkbox.checked).toBe(false);
  });

  it("does not call onSubmit when required and the checkbox is left unticked", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit, requiredConsent, POLICY_BASE_URL);
    const form = control.querySelector("form")!;

    setValue(phoneInput(control), "+7 000 000-00-01");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await Promise.resolve();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onSubmit with acceptContact true once the required checkbox is ticked", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit, requiredConsent, POLICY_BASE_URL);
    const form = control.querySelector("form")!;

    setValue(nameInput(control), "Ivan");
    setValue(phoneInput(control), "+7 000 000-00-01");
    setValue(emailInput(control), "ivan@example.invalid");
    consentCheckboxes(control)[0]!.checked = true;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "+7 000 000-00-01", acceptContact: true, acceptMarketing: false }),
    );
  });

  it("renders no checkbox at all once this visitor has already accepted", () => {
    const alreadyAccepted: ConsentRequirement = { ...requiredConsent, contactAlreadyAccepted: true };
    const control = renderContactCaptureControl(en, vi.fn(), alreadyAccepted, POLICY_BASE_URL);

    expect(consentCheckboxes(control)).toHaveLength(0);
  });

  it("a marketing checkbox is never required, and refusing it still lets the contact write through", () => {
    const withMarketing: ConsentRequirement = {
      contactRequired: false,
      contact: null,
      contactAlreadyAccepted: false,
      marketing: { documentKey: "site-consent-marketing-abc", title: "Also send me offers.", body: "Full text." },
      marketingAlreadyAccepted: false,
    };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit, withMarketing, POLICY_BASE_URL);
    const form = control.querySelector("form")!;

    const checkboxes = consentCheckboxes(control);
    expect(checkboxes).toHaveLength(1);
    expect(checkboxes[0]!.required).toBe(false);
    expect(control.querySelector(".ago-contact-capture-consent")?.textContent).toBe("Also send me offers.");

    // Left unticked, deliberately - refusing marketing must never block the contact write.
    setValue(nameInput(control), "Ivan");
    setValue(phoneInput(control), "+7 000 000-00-01");
    setValue(emailInput(control), "ivan@example.invalid");
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ acceptContact: false, acceptMarketing: false }));
  });

  it("both checkboxes can be shown together, contact required and marketing optional, independently", () => {
    const both: ConsentRequirement = {
      ...requiredConsent,
      marketing: { documentKey: "site-consent-marketing-abc", title: "Also send me offers.", body: "Full text." },
    };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const control = renderContactCaptureControl(en, onSubmit, both, POLICY_BASE_URL);
    const form = control.querySelector("form")!;

    const checkboxes = consentCheckboxes(control);
    expect(checkboxes).toHaveLength(2);
    checkboxes[0]!.checked = true; // contact - required
    checkboxes[1]!.checked = true; // marketing - optional, ticked anyway
    setValue(nameInput(control), "Ivan");
    setValue(phoneInput(control), "+7 000 000-00-01");
    setValue(emailInput(control), "ivan@example.invalid");
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ acceptContact: true, acceptMarketing: true }));
  });

  // `25-27`: the item's own crux - before this item the document title rendered as plain text with
  // no way to open it at all. These prove the link itself: where it points, how it opens, and that
  // it does not disturb the checkbox it sits next to.
  describe("the document title is a real, absolute link to its public policy page", () => {
    it("points the contact document's link at policyBaseUrl + /policies/<documentKey>, URL-encoded", () => {
      const control = renderContactCaptureControl(en, vi.fn(), requiredConsent, POLICY_BASE_URL);

      const link = consentLinks(control)[0]!;
      expect(link.getAttribute("href")).toBe("https://office.test.invalid/policies/site-consent-contact-abc");
      expect(link.textContent).toBe("I agree to be contacted about my order.");
    });

    it("does the identical thing for the marketing document - both purposes, not just the first", () => {
      const withMarketing: ConsentRequirement = {
        ...requiredConsent,
        marketing: { documentKey: "site-consent-marketing-xyz", title: "Also send me offers.", body: "Full text." },
      };
      const control = renderContactCaptureControl(en, vi.fn(), withMarketing, POLICY_BASE_URL);

      const links = consentLinks(control);
      expect(links).toHaveLength(2);
      expect(links[1]!.getAttribute("href")).toBe("https://office.test.invalid/policies/site-consent-marketing-xyz");
      expect(links[1]!.textContent).toBe("Also send me offers.");
    });

    it("encodes a document key that needs it, rather than concatenating it raw into the URL", () => {
      const withOddKey: ConsentRequirement = {
        ...requiredConsent,
        contact: { ...requiredConsent.contact!, documentKey: "weird key/needs encoding" },
      };
      const control = renderContactCaptureControl(en, vi.fn(), withOddKey, POLICY_BASE_URL);

      const link = consentLinks(control)[0]!;
      expect(link.getAttribute("href")).toBe("https://office.test.invalid/policies/weird%20key%2Fneeds%20encoding");
    });

    it("opens in a new tab and does not hand the new tab a reference back to this page", () => {
      const control = renderContactCaptureControl(en, vi.fn(), requiredConsent, POLICY_BASE_URL);

      const link = consentLinks(control)[0]!;
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noreferrer");
    });

    it("is a real <a> element, not a styled span - visibly a link, not merely a colour change", () => {
      const control = renderContactCaptureControl(en, vi.fn(), requiredConsent, POLICY_BASE_URL);

      const link = consentLinks(control)[0]!;
      expect(link.tagName).toBe("A");
      expect(link.classList.contains("ago-contact-capture-consent-link")).toBe(true);
    });

    // The interaction the item's own "Where this is likely to go wrong" names by name: a link
    // nested inside a checkbox's own <label> is the classic way to get both behaviours firing on
    // one click. Both directions are asserted so a regression in either shows up here rather than
    // only ever being noticed by a visitor.
    it("clicking the link does not also toggle the checkbox underneath it", () => {
      const control = renderContactCaptureControl(en, vi.fn(), requiredConsent, POLICY_BASE_URL);
      // Attached to a real document, not left detached - jsdom only runs a <label>'s native
      // click-forwarding to its control for a connected element, matching real browsers.
      document.body.appendChild(control);
      const checkbox = consentCheckboxes(control)[0]!;
      const link = consentLinks(control)[0]!;
      expect(checkbox.checked).toBe(false);

      link.click();

      expect(checkbox.checked).toBe(false);
      control.remove();
    });

    it("clicking the checkbox itself still toggles it - the link's presence does not disturb that", () => {
      const control = renderContactCaptureControl(en, vi.fn(), requiredConsent, POLICY_BASE_URL);
      document.body.appendChild(control);
      const checkbox = consentCheckboxes(control)[0]!;
      expect(checkbox.checked).toBe(false);

      checkbox.click();

      expect(checkbox.checked).toBe(true);
      control.remove();
    });

    // `25-27`: `policyBaseUrl` has no fallback (`config.ts`'s own remarks on why) - a caller that
    // renders a checkbox but forgets to pass it must fail loudly rather than link a visitor to
    // `undefined/policies/...`. The only real caller (`ui/widget.ts`) always passes it; this proves
    // the guard exists for the case where a future caller does not.
    it("throws rather than building a link with a missing policyBaseUrl", () => {
      expect(() => renderContactCaptureControl(en, vi.fn(), requiredConsent)).toThrow(/policyBaseUrl/);
    });
  });
});
