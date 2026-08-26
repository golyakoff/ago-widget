import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootWidget, wireMintButton } from "./boot.js";

describe("bootWidget", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  /**
   * The whole point of `8-09`, expressed as one assertion: the widget is *told* which tenant to talk
   * to, through the same `data-site` attribute it has always read. `adr/0058` forbids the widget
   * reading `?site=` itself, because a widget that did could be repointed at another tenant by any
   * page hosting it.
   */
  it("injects the widget script carrying the resolved key as data-site", () => {
    bootWidget(document, "demo_0199a1f2c4d34b7e8a1b2c3d4e5f6071", true);

    const script = document.querySelector<HTMLScriptElement>('script[src="./ago-chat.js"]');
    expect(script).not.toBeNull();
    expect(script?.getAttribute("data-site")).toBe("demo_0199a1f2c4d34b7e8a1b2c3d4e5f6071");
    expect(script?.async).toBe(true);
  });

  it("keeps 8-06's public-demo notice on, and can be asked not to", () => {
    bootWidget(document, "demo_site", true);
    expect(document.querySelector("script")?.getAttribute("data-public-demo")).toBe("true");

    document.body.replaceChildren();
    bootWidget(document, "demo_site", false);
    expect(document.querySelector("script")?.hasAttribute("data-public-demo")).toBe(false);
  });
});

describe("wireMintButton", () => {
  let button: HTMLButtonElement;
  let output: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    button = document.createElement("button");
    button.textContent = "Get your own tenant";
    output = document.createElement("div");
    document.body.append(button, output);
  });

  const minted = {
    username: "demo-a1b2c3d4",
    password: "swordfish-2026",
    siteName: "Demo tenant",
    sitePublicKey: "demo_0199a1f2c4d34b7e8a1b2c3d4e5f6071",
    visitorUrl: "https://demo-shop1.example/?site=demo_0199a1f2c4d34b7e8a1b2c3d4e5f6071",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  function respond(response: Response): typeof fetch {
    return () => Promise.resolve(response);
  }

  it("renders the credentials and does not offer to mint a second tenant", async () => {
    wireMintButton(button, output, "https://chat.example", respond(new Response(JSON.stringify(minted))));

    button.click();
    await vi.waitFor(() => expect(output.querySelectorAll("input").length).toBe(2));

    // Deliberately stays disabled. Pressing again would mint a *second* tenant and replace credentials
    // the visitor may already have typed into a console - and the first set is unrecoverable.
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Tenant created");
  });

  it("re-enables the button after a refusal, because retrying is the right thing then", async () => {
    wireMintButton(
      button,
      output,
      "https://chat.example",
      respond(new Response(JSON.stringify({ title: "demo.capacity_reached" }), { status: 409 })),
    );

    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));

    expect(output.textContent).toContain("expire on their own");
    expect(button.textContent).toBe("Get your own tenant");
  });

  /** A double-press would otherwise spend two of a visitor's three rate-limit tokens on one
   * intention, and `8-07` refills that bucket at about three an hour. */
  it("ignores a second press while the first is still in flight", async () => {
    let calls = 0;
    const slow: typeof fetch = () => {
      calls++;
      return new Promise<Response>((resolve) => {
        setTimeout(() => resolve(new Response(JSON.stringify(minted))), 5);
      });
    };

    wireMintButton(button, output, "https://chat.example", slow);

    button.click();
    button.click();
    await vi.waitFor(() => expect(output.querySelectorAll("input").length).toBe(2));

    expect(calls).toBe(1);
  });
});
