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
 */
export function bootWidget(doc: Document, siteKey: string, isPublicDemo: boolean): HTMLScriptElement {
  const script = doc.createElement("script");
  script.src = "./ago-chat.js";
  script.async = true;
  script.setAttribute("data-site", siteKey);
  if (isPublicDemo) {
    // `8-06`: the panel's own "anyone can read this" line. Still true on a minted tenant's page, which
    // is shared in exactly one sense that still matters - the page is public, so anybody who is handed
    // the link can talk to that tenant. `8-06` is explicitly out of this item's scope and stays on.
    script.setAttribute("data-public-demo", "true");
  }

  doc.body.appendChild(script);
  return script;
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
  const isOwnTenant = siteKey !== fallbackSiteKey;

  const run = (): void => {
    bootWidget(document, siteKey, true);

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
