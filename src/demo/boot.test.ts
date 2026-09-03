import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyOwnTenantPageCopy, bootWidget, demoNoticeFor, wireMintButton } from "./boot.js";

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
    bootWidget(document, "demo_0199a1f2c4d34b7e8a1b2c3d4e5f6071", "public", "https://chat-api.example");

    const script = document.querySelector<HTMLScriptElement>('script[src="./ago-chat.js"]');
    expect(script).not.toBeNull();
    expect(script?.getAttribute("data-site")).toBe("demo_0199a1f2c4d34b7e8a1b2c3d4e5f6071");
    expect(script?.async).toBe(true);
  });

  /**
   * `#337`: the whole reason this page cannot rely on `adr/0092`'s origin inference.
   * `public-demo`/`public-demo-2` each serve their own copy of the bundle from their own origin
   * (`demo-shop1.reserve-me.ru`/`demo-shop2.reserve-me.ru`), so a script tag with only `data-site` and
   * no `data-api` would have `config.ts` infer the *demo shop's* origin as the API to call - both
   * public demo pages would talk to themselves instead of `Ago.Chat.Api`. This asserts the attribute
   * a demo-shop-shaped embed needs to win `config.ts`'s resolution order at step one, and would fail
   * exactly the way a silent regression here would: no `data-api` attribute, or the wrong value.
   */
  it("sets data-api explicitly, so a demo shop's own origin can never be inferred instead", () => {
    bootWidget(document, "demo_site", "public", "https://chat-api.reserve-me.ru");

    const script = document.querySelector<HTMLScriptElement>('script[src="./ago-chat.js"]');
    expect(script?.getAttribute("data-api")).toBe("https://chat-api.reserve-me.ru");
  });

  /**
   * `8-11`'s whole point, at the one line that decides it. `8-06`'s warning claims the published
   * demo-operator console can read the conversation; on a minted tenant it cannot (`adr/0058` gives
   * that visitor their own site, roles and operator), so asking for it there was a contradiction of
   * the panel that had just handed over the credentials.
   */
  it("asks for the public notice on a shared shop and the private one on a minted tenant", () => {
    bootWidget(document, "demo_site", "public", "https://chat-api.example");
    expect(document.querySelector("script")?.getAttribute("data-demo-notice")).toBe("public");

    document.body.replaceChildren();
    bootWidget(document, "demo_0199a1f2c4d34b7e8a1b2c3d4e5f6071", "private", "https://chat-api.example");
    expect(document.querySelector("script")?.getAttribute("data-demo-notice")).toBe("private");
  });

  it("asks for no notice at all when told none", () => {
    bootWidget(document, "demo_site", "none", "https://chat-api.example");
    expect(document.querySelector("script")?.hasAttribute("data-demo-notice")).toBe(false);
  });
});

/**
 * The decision this whole item is. It lived as a ternary inside the module-level `start()`, where no
 * test could reach it - reverting it to the original unconditional `"public"` turned nothing red,
 * which is how this describe block came to exist.
 */
describe("demoNoticeFor", () => {
  it("asks for 8-06's public warning on a page serving its own baked-in key", () => {
    expect(demoNoticeFor("demo_site", "demo_site")).toBe("public");
  });

  it("asks for the private notice when the page was pointed at a minted tenant", () => {
    expect(demoNoticeFor("demo_0199a1f2c4d34b7e8a1b2c3d4e5f6071", "demo_site")).toBe("private");
  });
});

describe("applyOwnTenantPageCopy", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  /**
   * `8-11`: the same contradiction one layer up. The banner is static markup, so a minted `?site=`
   * page went on telling a visitor that anyone could read their conversation on the way down to the
   * widget that had just been fixed. The Done-when says *no text anywhere on the page*.
   */
  function seedSharedPageCopy(): { banner: HTMLElement; privacyNote: HTMLElement } {
    const banner = document.createElement("p");
    banner.id = "ago-demo-public-notice";
    banner.textContent =
      "This is a public demo. The operator login below is published on this page, so anyone can read "
      + "every conversation started here - including yours. Do not type anything real.";

    const privacyNote = document.createElement("p");
    privacyNote.id = "ago-demo-privacy-note";
    privacyNote.textContent =
      "the login above is published, so anything you type into this page's widget is readable by any "
      + "stranger who signs in with it. Treat this chat as a public one.";

    document.body.append(banner, privacyNote);
    return { banner, privacyNote };
  }

  it("replaces the page banner's public warning with what is true on a minted tenant", () => {
    const { banner } = seedSharedPageCopy();

    expect(applyOwnTenantPageCopy(document).banner).toBe(true);

    const replaced = banner.textContent ?? "";
    expect(replaced).toContain("tenant of your own");
    expect(replaced).toContain("nobody but you can read what you type here");
    // The claim this item exists to remove, in the two shapes the original copy used.
    expect(replaced).not.toContain("anyone can read");
    expect(replaced).not.toContain("including yours");
  });

  /**
   * The third place the same claim lived, and the one a source reading missed - it was found by
   * walking the built page in a browser, which is what the item's own Done-when asks for.
   */
  it("replaces the safety card's privacy paragraph too", () => {
    const { privacyNote } = seedSharedPageCopy();

    expect(applyOwnTenantPageCopy(document).privacyNote).toBe(true);

    const replaced = privacyNote.textContent ?? "";
    expect(replaced).toContain("never the tenant you are on");
    expect(replaced).not.toContain("readable by any stranger");
    expect(replaced).not.toContain("Treat this chat as a public one");
  });

  /**
   * The whole point, as one assertion over everything a stranger can read: after the swap, no text
   * on the page says somebody else can read the conversation. This is the Done-when.
   */
  it("leaves no text on the page claiming anybody else can read the conversation", () => {
    seedSharedPageCopy();
    applyOwnTenantPageCopy(document);

    const pageText = (document.body.textContent ?? "").toLowerCase();
    for (const claim of [
      "anyone can read",
      "including yours",
      "readable by any stranger",
      "treat this chat as a public one",
    ]) {
      expect(pageText).not.toContain(claim);
    }
  });

  /**
   * Same defensive shape as the mint button: a page missing its markup still boots its widget,
   * because the widget is the demo and the copy is commentary on it. `demo-shop2` genuinely has no
   * safety card, so a missing privacy note is the ordinary case rather than a fault - which is why
   * each element is reported separately instead of collapsing into one boolean.
   */
  it("reports each block separately, so a page without a safety card is not a failure", () => {
    const banner = document.createElement("p");
    banner.id = "ago-demo-public-notice";
    banner.textContent = "This is a public demo.";
    document.body.appendChild(banner);

    expect(applyOwnTenantPageCopy(document)).toEqual({ banner: true, privacyNote: false });
  });

  it("does nothing and says so when the page has neither block", () => {
    expect(applyOwnTenantPageCopy(document)).toEqual({ banner: false, privacyNote: false });
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
