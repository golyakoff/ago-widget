import { describe, expect, it, vi } from "vitest";
import { renderPrimitiveContent } from "./render.js";
import { en } from "../../i18n/en.js";
import type { MessageDto } from "../../protocol/types.js";

function baseMessage(overrides: Partial<MessageDto>): MessageDto {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    sequence: 1,
    authorKind: "Operator",
    authorId: "operator-1",
    body: "What would you like to book?",
    createdAt: "2026-08-29T00:00:00+00:00",
    ...overrides,
  };
}

describe("renderPrimitiveContent", () => {
  it("returns null for a message with no contentKind, and never touches the DOM", () => {
    const onReply = vi.fn();
    expect(renderPrimitiveContent(baseMessage({}), en, onReply)).toBeNull();
    expect(onReply).not.toHaveBeenCalled();
  });

  it("returns null for a contentKind this widget does not recognise, rather than throwing", () => {
    const onReply = vi.fn();
    const message = baseMessage({ contentKind: "week_grid", content: { anything: true }, actions: [] });
    expect(() => renderPrimitiveContent(message, en, onReply)).not.toThrow();
    expect(renderPrimitiveContent(message, en, onReply)).toBeNull();
  });

  it("renders choice_list actions as buttons and replies with the clicked action's own value", () => {
    const onReply = vi.fn();
    const message = baseMessage({
      contentKind: "choice_list",
      content: { prompt: "What would you like to book?" },
      actions: [
        { label: "Haircut (45 min)", value: "svc-1" },
        { label: "Beard trim (20 min)", value: "svc-2" },
      ],
    });

    const element = renderPrimitiveContent(message, en, onReply)!;
    const buttons = [...element.querySelectorAll<HTMLButtonElement>(".ago-primitive-choice")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Haircut (45 min)", "Beard trim (20 min)"]);

    buttons[1]!.click();
    expect(onReply).toHaveBeenCalledWith("choice_list", "svc-2", "Beard trim (20 min)");
  });

  it("disables every action after one is clicked, so a second click cannot send a second reply", () => {
    const message = baseMessage({
      contentKind: "choice_list",
      content: {},
      actions: [
        { label: "Alex", value: "w1" },
        { label: "Bo", value: "w2" },
      ],
    });

    const element = renderPrimitiveContent(message, en, vi.fn())!;
    const buttons = [...element.querySelectorAll<HTMLButtonElement>(".ago-primitive-choice")];
    buttons[0]!.click();

    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  it("renders a form as a labelled text input, not buttons, and replies with the typed text as both value and displayText", () => {
    const onReply = vi.fn();
    const message = baseMessage({
      contentKind: "form",
      content: { prompt: "What is your phone number?", fieldId: "phone", fieldLabel: "Phone number" },
      actions: [],
    });

    const element = renderPrimitiveContent(message, en, onReply)!;
    expect(element.querySelectorAll(".ago-primitive-choice")).toHaveLength(0);

    const input = element.querySelector<HTMLInputElement>(".ago-primitive-form-input")!;
    expect(input.getAttribute("aria-label")).toBe("Phone number");

    // A numeric-looking answer is still free text on a form step, never mistaken for an action's
    // opaque value - contentKind alone decides how the reply is interpreted.
    input.value = "+1 555 0100";
    element.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(onReply).toHaveBeenCalledWith("form", "+1 555 0100", "+1 555 0100");
  });

  it("renders a confirmation_card's title and lines, and still wires its actions", () => {
    const onReply = vi.fn();
    const message = baseMessage({
      contentKind: "confirmation_card",
      content: {
        title: "Confirm your booking",
        lines: [
          { label: "Service", value: "Haircut" },
          { label: "When", value: "Tue 10:00" },
        ],
      },
      actions: [
        { label: "Confirm", value: "confirm" },
        { label: "Cancel", value: "cancel" },
      ],
    });

    const element = renderPrimitiveContent(message, en, onReply)!;
    expect(element.querySelector(".ago-primitive-title")!.textContent).toBe("Confirm your booking");
    const lines = [...element.querySelectorAll(".ago-primitive-line")].map((line) => line.textContent);
    expect(lines).toEqual(["ServiceHaircut", "WhenTue 10:00"]);

    element.querySelectorAll<HTMLButtonElement>(".ago-primitive-choice")[0]!.click();
    expect(onReply).toHaveBeenCalledWith("confirmation_card", "confirm", "Confirm");
  });

  it("renders date_time_picker's actions as a flat button list (slots/startsAt are enrichment only)", () => {
    const onReply = vi.fn();
    const message = baseMessage({
      contentKind: "date_time_picker",
      content: {
        prompt: "When would you like to come?",
        slots: [{ value: "slot-1", startsAt: "2026-09-01T10:00:00+00:00", label: "Tue 10:00" }],
      },
      actions: [{ label: "Tue 10:00", value: "slot-1" }],
    });

    const element = renderPrimitiveContent(message, en, onReply)!;
    const buttons = [...element.querySelectorAll<HTMLButtonElement>(".ago-primitive-choice")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Tue 10:00"]);

    buttons[0]!.click();
    expect(onReply).toHaveBeenCalledWith("date_time_picker", "slot-1", "Tue 10:00");
  });

  it("survives content that is not the object shape a known kind expects, without throwing", () => {
    const onReply = vi.fn();
    const odd = baseMessage({ contentKind: "confirmation_card", content: "not an object", actions: [] });
    expect(() => renderPrimitiveContent(odd, en, onReply)).not.toThrow();

    const missing = baseMessage({ contentKind: "form" });
    const element = renderPrimitiveContent(missing, en, onReply)!;
    // Falls back to the base string table's own label rather than a blank/undefined one.
    expect(element.querySelector(".ago-primitive-form-label")!.textContent).toBe(en.yourAnswer);
  });

  it("renders no choices list at all for a kind with an empty actions array", () => {
    const message = baseMessage({ contentKind: "choice_list", content: {}, actions: [] });
    const element = renderPrimitiveContent(message, en, vi.fn())!;
    expect(element.querySelector(".ago-primitive-choices")).toBeNull();
  });

  describe("25-158: URLs embedded in prompt/title/label/value text", () => {
    it("renders a URL inside a choice_list/date_time_picker prompt as a real, clickable anchor", () => {
      const message = baseMessage({
        contentKind: "choice_list",
        content: {
          prompt: "Please review the policy: https://office.reserve-me.ru/policies/site-consent-01 before continuing",
        },
        actions: [],
      });

      const element = renderPrimitiveContent(message, en, vi.fn())!;
      const title = element.querySelector(".ago-primitive-title")!;
      const link = title.querySelector("a")!;
      expect(link).not.toBeNull();
      expect(link.href).toBe("https://office.reserve-me.ru/policies/site-consent-01");
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noreferrer");
      // The surrounding plain text is preserved, and the element's full text is unchanged overall.
      expect(title.textContent).toBe(
        "Please review the policy: https://office.reserve-me.ru/policies/site-consent-01 before continuing",
      );
    });

    it("renders a URL inside a confirmation_card's title and a line's label/value as clickable anchors", () => {
      const message = baseMessage({
        contentKind: "confirmation_card",
        content: {
          title: "See https://example.com/terms for details",
          lines: [{ label: "Policy https://example.com/policy", value: "Accepted https://example.com/receipt" }],
        },
        actions: [],
      });

      const element = renderPrimitiveContent(message, en, vi.fn())!;
      const titleLink = element.querySelector(".ago-primitive-title a")!;
      expect(titleLink.getAttribute("href")).toBe("https://example.com/terms");
      expect(titleLink.getAttribute("target")).toBe("_blank");
      expect(titleLink.getAttribute("rel")).toBe("noreferrer");

      const labelLink = element.querySelector(".ago-primitive-line-label a")!;
      expect(labelLink.getAttribute("href")).toBe("https://example.com/policy");

      const valueLink = element.querySelector(".ago-primitive-line-value a")!;
      expect(valueLink.getAttribute("href")).toBe("https://example.com/receipt");
    });

    it("renders a URL inside a form's field label as a clickable anchor", () => {
      const message = baseMessage({
        contentKind: "form",
        content: { fieldLabel: "See https://example.com/help for guidance" },
        actions: [],
      });

      const element = renderPrimitiveContent(message, en, vi.fn())!;
      const link = element.querySelector(".ago-primitive-form-label a")!;
      expect(link.getAttribute("href")).toBe("https://example.com/help");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noreferrer");
    });

    it("renders a prompt with no URL exactly as before - plain text, no anchor at all", () => {
      const message = baseMessage({
        contentKind: "choice_list",
        content: { prompt: "What would you like to book?" },
        actions: [],
      });

      const element = renderPrimitiveContent(message, en, vi.fn())!;
      const title = element.querySelector(".ago-primitive-title")!;
      expect(title.querySelector("a")).toBeNull();
      expect(title.textContent).toBe("What would you like to book?");
      // Regression safety: a single text node, exactly as the old plain `textContent =` assignment
      // would have produced - not merely the same concatenated text.
      expect(title.childNodes).toHaveLength(1);
      expect(title.childNodes[0]!.nodeType).toBe(Node.TEXT_NODE);
    });

    it("never turns a javascript:-shaped string into a live anchor - it stays inert plain text", () => {
      const message = baseMessage({
        contentKind: "choice_list",
        content: { prompt: "click javascript://%0aalert(1) to continue" },
        actions: [],
      });

      const element = renderPrimitiveContent(message, en, vi.fn())!;
      const title = element.querySelector(".ago-primitive-title")!;
      expect(title.querySelector("a")).toBeNull();
      expect(title.textContent).toBe("click javascript://%0aalert(1) to continue");
    });
  });
});
