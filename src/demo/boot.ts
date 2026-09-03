/**
 * `8-09`: the public demo pages' own boot script - **not part of the widget bundle**.
 *
 * Two jobs, and the first is the load-bearing one:
 *
 * 1. Decide which tenant this page's widget talks to (`?site=`, falling back to the page's baked-in
 *    key) and inject the widget's `<script data-site>` tag with that answer. The widget is told; it
 *    never looks (`siteKey.ts`'s own remarks, `adr/0058`).
 * 2. If the page offers a mint button, wire it to `8-07`'s endpoint and render whatever comes back.
 *
 * Ships as its own esbuild entry point (`build.mjs`), so "the widget does not read `?site=`" is a
 * property of the build output rather than a comment somebody has to keep honouring. Nothing in
 * `src/demo/` is imported by `src/index.ts`, and nothing here imports the widget.
 */
import type { DemoNotice } from "../config.js";
import { mintDemoTenant } from "./mint.js";
import { renderOutcome } from "./panel.js";
import { resolveDemoSiteKey } from "./siteKey.js";

declare const __AGO_DEFAULT_API_BASE_URL__: string;

/**
 * Injects the widget with the resolved key.
 *
 * Built dynamically rather than rewriting a static tag's attribute, because the widget reads
 * `data-site` off `document.currentScript` during its own synchronous execution (`src/index.ts`) - so
 * the attribute has to be correct *before* the element is in the document, and an inline script placed
 * earlier cannot reach a tag the parser has not seen yet. A dynamically appended classic script still
 * gets a valid `document.currentScript`, which is what makes this work at all.
 *
 * `#337`: always sets `data-api` explicitly, to `apiBaseUrl` (the caller's own
 * `__AGO_DEFAULT_API_BASE_URL__`, matching `wireMintButton`'s existing pattern of taking it as a
 * parameter rather than reading the module-level `declare const` here, so a test can supply a
 * demo-shop-shaped value and prove it wins). `config.ts`'s resolution order is `data-api` first,
 * then the script's own origin - and this page's script tag has `src="./ago-chat.js"`, resolved by
 * the DOM against *this page's own origin* (`demo-shop1`/`demo-shop2`), which is never the API's.
 * Without this attribute, `adr/0092`'s origin-inference would read this demo page's own address as
 * the API to call and both public demo pages would talk to themselves instead of `Ago.Chat.Api`.
 */
export function bootWidget(
  doc: Document,
  siteKey: string,
  notice: DemoNotice,
  apiBaseUrl: string,
): HTMLScriptElement {
  const script = doc.createElement("script");
  script.src = "./ago-chat.js";
  script.async = true;
  script.setAttribute("data-site", siteKey);
  script.setAttribute("data-api", apiBaseUrl);
  if (notice !== "none") {
    // `8-11`: which sentence, decided from the tenant rather than from the page.
    //
    // This used to be an unconditional `data-public-demo="true"`, and the comment that stood here
    // defended it: a minted tenant's page is still public "in exactly one sense that still matters -
    // the page is public, so anybody who is handed the link can talk to that tenant". That is true
    // and it is not what the sentence said. `8-06`'s line claims the *demo operator console* can
    // read the conversation, and on a minted tenant it cannot: `adr/0058` gives that visitor their
    // own site, their own roles and their own operator, and the published `demo-operator` login
    // belongs to a different tenant entirely. The residual the old comment was reaching for - a link
    // and a password that can be passed on - is what the private sentence states instead.
    script.setAttribute("data-demo-notice", notice);
  }

  doc.body.appendChild(script);
  return script;
}

/**
 * `8-11`: which of the widget's two demo sentences this page should ask for, from the one fact that
 * decides it - whether the resolved tenant is the page's own or one a visitor minted.
 *
 * **Extracted so it can be tested.** It was a ternary inside `start()`, which nothing reaches: that
 * function is module-level, guarded on `document.currentScript`, and runs on import. Reverting the
 * ternary to an unconditional `"public"` - the original bug, exactly - turned no test red, which was
 * found by doing it. `resolveDemoSiteKey` is already extracted for the same reason and this mirrors
 * it: the decision is a pure function, the wiring is what stays untested.
 */
export function demoNoticeFor(siteKey: string, fallbackSiteKey: string): DemoNotice {
  // A page serving its own baked-in key is one of the shared demo shops, and `8-06`'s warning is
  // exactly right there. Anything else arrived through a minted `visitorUrl`.
  return siteKey === fallbackSiteKey ? "public" : "private";
}

/**
 * `8-11`: the page's own top banner, which has the same problem one layer up.
 *
 * `demo-boot.js` swaps the widget's tenant and hides the mint button when `?site=` is present, but
 * the banner is static markup - so on a minted tenant's page it went on saying "the operator login
 * below is published on this page, so anyone can read every conversation started here - including
 * yours". Fixing only the widget would have left a stranger reading the contradiction on the way
 * down to it. The item's Done-when says *no text anywhere on the page*, which is why this exists.
 *
 * A text swap rather than a second `<p>` toggled by a class: two blocks of copy in the markup is two
 * places to keep true, and the one that is currently wrong is the one that would be left behind.
 *
 * **Two blocks, because a browser found the second one.** The banner and the widget were both made
 * conditional first, and walking the built page proved the safety card's own privacy paragraph still
 * told a visitor on their own tenant that any stranger could read what they typed. Reading the source
 * would not have caught it; the item asks for a browser for exactly this reason.
 *
 * Guarded per element like the mint button, and each result reported separately - `demo-shop2` has no
 * safety card at all, so a missing element is the ordinary case rather than a fault, and a single
 * boolean would have made "not there" and "not swapped" the same answer.
 */
export function applyOwnTenantPageCopy(doc: Document): { banner: boolean; privacyNote: boolean } {
  return {
    banner: swap(
      doc,
      "ago-demo-public-notice",
      "You are on a tenant of your own. The operator login published below belongs to the shared demo "
      + "shops, not to this tenant - nobody but you can read what you type here. This tenant and "
      + "everything in it delete themselves after about a day.",
    ),
    // The safety card's second paragraph. Only demo-shop1's page carries the card, so this is
    // routinely false on demo-shop2 and that is not a failure - see this function's own remarks.
    privacyNote: swap(
      doc,
      "ago-demo-privacy-note",
      "Safe for the deployment, and private for you on this page: the login above is published, but "
      + "it only reaches the shared demo shops - never the tenant you are on. Only the operator "
      + "account you were handed can read this conversation, and it is deleted with the tenant after "
      + "about a day.",
    ),
  };
}

function swap(doc: Document, id: string, text: string): boolean {
  const element = doc.getElementById(id);
  if (element === null) {
    return false;
  }

  element.textContent = text;
  return true;
}

/** Wires a button to the endpoint, disabling it while a request is in flight so a double-press cannot
 * spend two of a visitor's three rate-limit tokens on one intention. */
export function wireMintButton(
  button: HTMLButtonElement,
  output: HTMLElement,
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): void {
  const originalLabel = button.textContent;

  button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = "Creating your tenant…";

    void mintDemoTenant(apiBaseUrl, fetchImpl)
      .then((outcome) => {
        renderOutcome(output, outcome);
        if (outcome.kind === "minted") {
          // Deliberately left disabled after success. Pressing it again would mint a *second* tenant
          // and replace the credentials on screen with ones for a different one - and the first set,
          // which the visitor may already have typed somewhere, would be unrecoverable.
          button.textContent = "Tenant created";
          return;
        }

        button.disabled = false;
        button.textContent = originalLabel;
      })
      .catch(() => {
        renderOutcome(output, { kind: "failed", detail: "Something went wrong. Try again." });
        button.disabled = false;
        button.textContent = originalLabel;
      });
  });
}

function start(): void {
  const self = document.currentScript as HTMLScriptElement | null;
  const fallbackSiteKey = self?.getAttribute("data-fallback-site") ?? "";
  if (fallbackSiteKey === "") {
    // A demo page that forgot the attribute would otherwise boot a widget against an empty key and
    // fail several layers away, in the API's own site lookup.
    throw new Error("demo-boot.js needs data-fallback-site on its own <script> tag.");
  }

  const siteKey = resolveDemoSiteKey(window.location.search, fallbackSiteKey);
  const notice = demoNoticeFor(siteKey, fallbackSiteKey);
  const isOwnTenant = notice === "private";

  const run = (): void => {
    // `8-11`: the notice follows the tenant now, not the page.
    // `#337`: the API origin is always passed explicitly - see `bootWidget`'s own comment for why
    // this page cannot rely on origin inference the way a real tenant's embed now can.
    bootWidget(document, siteKey, notice, __AGO_DEFAULT_API_BASE_URL__);

    if (isOwnTenant) {
      applyOwnTenantPageCopy(document);
    }

    const button = document.getElementById("ago-demo-mint-button");
    const output = document.getElementById("ago-demo-mint-output");
    if (button instanceof HTMLButtonElement && output !== null) {
      if (isOwnTenant) {
        // Arriving through a minted `visitorUrl`. Offering "get your own tenant" here would be
        // confusing - they have one, and this page is already it.
        button.hidden = true;
        output.replaceChildren(ownTenantNotice(siteKey));
      } else {
        wireMintButton(button, output, __AGO_DEFAULT_API_BASE_URL__);
      }
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}

function ownTenantNotice(siteKey: string): HTMLElement {
  const notice = document.createElement("div");
  notice.className = "ago-demo-panel ago-demo-panel--notice";

  const title = document.createElement("h3");
  title.className = "ago-demo-panel__title";
  title.textContent = "You are on your own tenant";
  notice.appendChild(title);

  const body = document.createElement("p");
  body.className = "ago-demo-panel__lifetime";
  body.textContent = `This page is talking to ${siteKey}. Anything you send through the widget arrives in your own operator console, and nobody else's.`;
  notice.appendChild(body);

  return notice;
}

// Guarded so a demo page that is missing its markup still loads the widget rather than showing a
// blank page - the widget is the demo; the button is the affordance.
if (typeof document !== "undefined" && document.currentScript !== null) {
  start();
}
