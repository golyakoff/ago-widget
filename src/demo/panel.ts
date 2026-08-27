/**
 * `8-09`: what a stranger sees after pressing the button.
 *
 * Separated from `boot.ts` so it can be driven directly in jsdom: every branch here is a state a real
 * visitor reaches, and the two that are easiest to ship broken - the rate limit and the cap - are
 * exactly the two nobody exercises by hand.
 */
import type { MintOutcome, MintedDemoTenant } from "./mint.js";

/**
 * The one thing this UI exists to get right.
 *
 * The password is shown once, in one response, and is stored nowhere this or any other page can read
 * it back from: `8-07` puts it in Keycloak's hash and in this HTTP response and nowhere else. A viewer
 * has to type it into a console in a *second browser context* (the README already tells them to, and
 * the console's session is per-context). So the panel has to (a) make it copyable without a text
 * selection, and (b) say plainly that a reload loses it - because a person who reloads and finds a
 * fresh button will reasonably assume they can just press it again, and on a busy day the cap or the
 * rate limit will tell them otherwise.
 */
const LOSS_WARNING =
  "Copy these now. The password is shown once and is not stored anywhere — reloading this page loses it for good.";

export function renderOutcome(container: HTMLElement, outcome: MintOutcome, now: Date = new Date()): void {
  container.replaceChildren();

  switch (outcome.kind) {
    case "minted":
      container.appendChild(renderCredentials(outcome.tenant, now));
      return;
    case "rateLimited":
      container.appendChild(
        renderNotice(
          "Not so fast",
          outcome.retryAfterSeconds === null
            ? "This address has asked for a few demo tenants already. Try again in a moment."
            : `This address has asked for a few demo tenants already. Try again in about ${formatSeconds(outcome.retryAfterSeconds)}.`,
        ),
      );
      return;
    case "atCapacity":
      container.appendChild(
        renderNotice(
          "The demo is full",
          "Every demo tenant is currently taken. They expire on their own, so this clears itself — try again shortly.",
        ),
      );
      return;
    case "disabled":
      container.appendChild(
        renderNotice(
          "Not available here",
          "This deployment has demo tenants switched off. The two shared demo shops below still work.",
        ),
      );
      return;
    case "failed":
      container.appendChild(renderNotice("That did not work", outcome.detail));
  }
}

function renderCredentials(tenant: MintedDemoTenant, now: Date): HTMLElement {
  const panel = el("div", "ago-demo-panel");
  panel.appendChild(el("h3", "ago-demo-panel__title", "Your own tenant is ready"));

  const lifetime = el("p", "ago-demo-panel__lifetime");
  lifetime.textContent = `Nobody else can see its conversations. It deletes itself ${describeExpiry(tenant.expiresAt, now)}, along with everything in it.`;
  panel.appendChild(lifetime);

  const warning = el("p", "ago-demo-panel__warning");
  warning.textContent = LOSS_WARNING;
  panel.appendChild(warning);

  panel.appendChild(field("Username", tenant.username));
  panel.appendChild(field("Password", tenant.password));

  const steps = el("ol", "ago-demo-panel__steps");
  steps.appendChild(
    step(
      "Open the operator console in a private window",
      "console.reserve-me.ru",
      "https://console.reserve-me.ru",
    ),
  );
  steps.appendChild(
    step("Then open your own shop page and send a message", tenant.visitorUrl, tenant.visitorUrl),
  );
  panel.appendChild(steps);

  return panel;
}

/** A read-only input rather than a `<code>` block: a person needs to copy this into another window,
 * and a click-to-copy button that silently fails (clipboard permissions vary, and this page may be
 * opened over plain HTTP locally) would be worse than a field they can select. The button is offered
 * on top of that, never instead of it. */
function field(label: string, value: string): HTMLElement {
  const wrapper = el("div", "ago-demo-field");

  const labelEl = el("label", "ago-demo-field__label", label);
  const id = `ago-demo-${label.toLowerCase()}`;
  labelEl.setAttribute("for", id);
  wrapper.appendChild(labelEl);

  const input = document.createElement("input");
  input.className = "ago-demo-field__value";
  input.id = id;
  input.readOnly = true;
  input.value = value;
  input.setAttribute("spellcheck", "false");
  // `id`/label read as "Username"/"Password" to Chrome's autofill heuristics even though this is a
  // read-only display, not a login form - without this, Chrome silently overwrites the value set
  // below with a *saved* credential for the same registrable domain (reserve-me.ru spans
  // auth./console./demo-shop*.), so a viewer who typed a login on the Keycloak page moments earlier
  // sees that old value here instead of the one this response actually minted.
  input.setAttribute("autocomplete", "off");
  wrapper.appendChild(input);

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "ago-demo-field__copy";
  copy.textContent = "Copy";
  copy.addEventListener("click", () => {
    void copyToClipboard(input, copy);
  });
  wrapper.appendChild(copy);

  return wrapper;
}

async function copyToClipboard(input: HTMLInputElement, button: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(input.value);
    button.textContent = "Copied";
  } catch {
    // Clipboard access is denied on an insecure origin and in some embedded browsers. Selecting the
    // text is the fallback that always works, and saying so beats a button that appears to do nothing.
    input.select();
    button.textContent = "Press Ctrl+C";
  }
}

function step(text: string, linkText: string, href: string): HTMLElement {
  const item = el("li", "ago-demo-step", `${text}: `);
  const link = document.createElement("a");
  link.href = href;
  link.textContent = linkText;
  link.target = "_blank";
  link.rel = "noopener";
  item.appendChild(link);
  return item;
}

function renderNotice(title: string, body: string): HTMLElement {
  const notice = el("div", "ago-demo-panel ago-demo-panel--notice");
  notice.appendChild(el("h3", "ago-demo-panel__title", title));
  notice.appendChild(el("p", "ago-demo-panel__lifetime", body));
  return notice;
}

/**
 * "in about 24 hours", not a timestamp. `8-07` mints a lifetime, not a deadline a person should have
 * to convert out of UTC - and the exact instant is in the API response for anyone who wants it.
 */
function describeExpiry(expiresAt: string, now: Date): string {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) {
    return "after about a day";
  }

  const hours = Math.round((expiry - now.getTime()) / (60 * 60 * 1000));
  if (hours < 1) {
    return "within the hour";
  }

  return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} seconds`;
  }

  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "a minute" : `${minutes} minutes`;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}
