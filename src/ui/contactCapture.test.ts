import { describe, expect, it, vi } from "vitest";
import { renderContactCaptureControl } from "./contactCapture.js";
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

    expect(onSubmit).toHaveBeenCalledWith({ name: "Ivan", phone: "+7 000 000-00-01" });

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

    expect(onSubmit).toHaveBeenCalledWith({ name: "", phone: "+7 000 000-00-01" });
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
