import { beforeEach, describe, expect, it } from "vitest";
import { renderOutcome } from "./panel.js";
import type { MintedDemoTenant } from "./mint.js";

const NOW = new Date("2026-08-26T09:00:00Z");

const TENANT: MintedDemoTenant = {
  username: "demo-a1b2c3d4",
  password: "swordfish-2026",
  siteName: "Demo tenant — expires 2026-08-27 09:00 UTC",
  sitePublicKey: "demo_0199a1f2c4d34b7e8a1b2c3d4e5f6071",
  visitorUrl: "https://demo-shop1.example/?site=demo_0199a1f2c4d34b7e8a1b2c3d4e5f6071",
  expiresAt: "2026-08-27T09:00:00Z",
};

describe("renderOutcome", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.replaceChildren(container);
  });

  /**
   * The requirement `8-09` says makes the whole feature useless while looking finished if it is wrong:
   * a stranger has to type this password into a console in a second browser context, and it exists in
   * exactly one place - this response. It is shown in a field that can be selected and copied, not in
   * text that has to be highlighted by hand.
   */
  it("puts the credentials in copyable fields", () => {
    renderOutcome(container, { kind: "minted", tenant: TENANT }, NOW);

    const inputs = [...container.querySelectorAll("input")];
    expect(inputs.map((i) => i.value)).toEqual([TENANT.username, TENANT.password]);
    // Read-only rather than disabled: a disabled input cannot be selected, which would defeat the
    // fallback for anyone whose browser denies clipboard access.
    expect(inputs.every((i) => i.readOnly)).toBe(true);
    expect(inputs.every((i) => i.disabled)).toBe(false);
    expect(container.querySelectorAll("button").length).toBe(2);
  });

  /** A real bug, found live: the id/label read as "Username"/"Password" to Chrome's autofill
   * heuristics even though this is a read-only display, not a login form. Without this attribute
   * Chrome silently overwrites the value set above with a *saved* credential for the same
   * registrable domain - a viewer who had just typed a login on the Keycloak page moments earlier
   * saw that old value here instead of the one this response actually minted. */
  it("turns off autofill on both fields, so the browser cannot overwrite what was minted", () => {
    renderOutcome(container, { kind: "minted", tenant: TENANT }, NOW);

    const inputs = [...container.querySelectorAll("input")];
    expect(inputs.every((i) => i.getAttribute("autocomplete") === "off")).toBe(true);
  });

  /** The other half of the same requirement. A person who reloads loses the password permanently and
   * will find the cap or the rate limit waiting when they press the button again. */
  it("says plainly that the password cannot be recovered", () => {
    renderOutcome(container, { kind: "minted", tenant: TENANT }, NOW);

    const text = container.textContent ?? "";
    expect(text).toContain("shown once");
    expect(text).toContain("reloading");
  });

  it("says the tenant is temporary and roughly how long it lasts", () => {
    renderOutcome(container, { kind: "minted", tenant: TENANT }, NOW);

    // 8-09's Scope: "a viewer should learn it from the page rather than from a name".
    expect(container.textContent).toContain("in about 24 hours");
    expect(container.textContent).toContain("deletes itself");
  });

  it("offers the visitorUrl that carries this tenant's own key", () => {
    renderOutcome(container, { kind: "minted", tenant: TENANT }, NOW);

    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(TENANT.visitorUrl);
  });

  it("degrades to a vague window rather than lying when the expiry is unparseable", () => {
    renderOutcome(container, { kind: "minted", tenant: { ...TENANT, expiresAt: "not-a-date" } }, NOW);

    expect(container.textContent).toContain("about a day");
    expect(container.textContent).not.toContain("NaN");
  });

  /** `8-09`: "429 and the cap are ordinary states, both reachable by a stranger on a busy day, and
   * both must produce something a person can read." These two tests are that requirement. */
  it("renders a readable message for the rate limit, with the window when there is one", () => {
    renderOutcome(container, { kind: "rateLimited", retryAfterSeconds: 120 }, NOW);

    expect(container.textContent).toContain("2 minutes");
    expect(container.textContent).not.toContain("429");
  });

  it("renders a readable message for the rate limit when there is no window", () => {
    renderOutcome(container, { kind: "rateLimited", retryAfterSeconds: null }, NOW);

    expect(container.textContent).toContain("in a moment");
    expect(container.textContent).not.toContain("null");
  });

  it("tells a person the cap clears itself rather than just refusing", () => {
    renderOutcome(container, { kind: "atCapacity" }, NOW);

    expect(container.textContent).toContain("expire on their own");
  });

  it("explains the disabled case without looking like a fault", () => {
    renderOutcome(container, { kind: "disabled" }, NOW);

    expect(container.textContent).toContain("switched off");
  });

  it("shows the detail for an unexpected failure", () => {
    renderOutcome(container, { kind: "failed", detail: "The demo API answered 503." }, NOW);

    expect(container.textContent).toContain("503");
  });

  it("replaces the previous outcome rather than stacking outcomes", () => {
    renderOutcome(container, { kind: "atCapacity" }, NOW);
    renderOutcome(container, { kind: "minted", tenant: TENANT }, NOW);

    expect(container.textContent).not.toContain("expire on their own");
    expect(container.querySelectorAll("input").length).toBe(2);
  });
});
