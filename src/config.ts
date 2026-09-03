/**
 * `data-site` on the `<script>` tag identifies the tenant (embeddable-widget skill's Bootstrap
 * section) - the one piece of config every embed must supply.
 *
 * `#337`: `apiBaseUrl` resolves in three steps, `data-api` (explicit) -> the script's own origin
 * (inferred) -> `__AGO_DEFAULT_API_BASE_URL__` (baked at build time). `adr/0092` is what makes the
 * middle step sound: the canonical bundle is now served from the API's own origin
 * (`https://chat-api.reserve-me.ru/widget/`), so for a real hosted tenant the origin the script was
 * *loaded from* already is the right answer, and a future hostname rename stops needing a new
 * build baked into every browser that already cached the old one (the three-step migration
 * `adr/0091` paid once). The baked constant still exists for the one case inference cannot cover -
 * a local `npx serve` loop with no real origin to speak of - and `data-api` still exists to force an
 * origin explicitly, which is load-bearing for `public-demo/`/`public-demo-2/`: those two pages
 * serve their own copy of the bundle from their own origin (`demo-shop1`/`demo-shop2`), so inferring
 * from `script.src` there would resolve to the demo shop, not the API. `src/demo/boot.ts`'s
 * `bootWidget` sets `data-api` on the injected tag for exactly that reason - the demo pages must
 * win the resolution at step one, never fall through to step two.
 *
 * `8-06`: `data-demo-notice` is the third, and is a flag rather than a free-text notice string on
 * purpose. The sentence it turns on is *this widget's* sentence about *our* demo pages, not a
 * per-tenant one - a tenant-configurable processing notice is `16-04`'s job, server-driven, and
 * shipping a `data-notice="..."` attribute here would quietly pre-commit that design to a
 * host-page-authored string. An enum leaves `16-04` free and keeps this what it is: our own copy on
 * our own pages.
 *
 * `8-11`: it was a boolean (`data-public-demo`) until a minted tenant made two states insufficient.
 * The shared demo pages are public and the warning is exactly right there; a tenant minted by
 * `8-07`'s button is *not* public, and the same sentence on it was a flat contradiction of the panel
 * that had just handed the visitor their credentials. Three states rather than two booleans, because
 * two booleans admit a fourth combination that means nothing.
 *
 * `data-public-demo="true"` is still honoured as an alias for `"public"`. The bundle is a public
 * script tag on a public URL, so somebody may have copied our demo page's markup, and
 * `api-design.md`'s reasoning about a widget that "cannot be forced to upgrade" applies to a script
 * tag's attributes as much as to a route. Three lines to keep a promise nobody has to notice.
 */
/**
 * Which of the widget's own demo sentences to render inside the panel, if any.
 *
 * - `"public"` - `8-06`'s warning. Everything typed here is readable by anyone with the published
 *   operator login. True on the shared demo shops.
 * - `"private"` - `8-11`'s counterpart, for a tenant minted by `8-07`'s button: only the credentials
 *   this visitor was just given can read it, and the whole tenant expires.
 * - `"none"` - a real embed. Every shop that is not us gets this, and gets it by saying nothing.
 */
export type DemoNotice = "public" | "private" | "none";

export interface WidgetConfig {
  siteKey: string;
  apiBaseUrl: string;
  /** Which demo sentence, if any, the panel renders. Never `"public"` or `"private"` unless the
   * embed asks for it - a real customer's widget says nothing about demos. */
  demoNotice: DemoNotice;
  /**
   * `20-07`: down from `20-06`'s two required attributes (a calendar tenant key, a calendar API
   * origin) to one boolean. Booking now rides the chat connection this widget already holds - the
   * module's invocation chip and every step that follows arrive as ordinary chat messages
   * (`ui/primitives/render.ts`), not a second HTTP client - so the only fact this bundle still needs
   * from the embed is "does this site's booking module exist", not where to reach it. Absent is the
   * default: a shop with chat and no booking renders no chip and never fetches the lazy module bundle
   * at all (`ui/moduleLoader.ts`'s `loadModule` is never called).
   */
  bookingModuleEnabled: boolean;
  /**
   * `20-07`: the absolute URL this widget's own bundle was loaded from, read off the `<script>`
   * tag's `.src` IDL property (always absolute, unlike `getAttribute("src")`) rather than
   * `window.location` - the host page's own address is a different origin from wherever this bundle
   * is actually served. The one thing `ui/moduleLoader.ts` needs to find a lazily-loaded module
   * bundle's sibling file next to this one.
   */
  scriptUrl: string;
}

/** Replaced at build time by `build.mjs` - see that file for why a `define` beats a runtime fetch. */
declare const __AGO_DEFAULT_API_BASE_URL__: string;

export class MissingSiteKeyError extends Error {
  constructor() {
    super("AGO Chat widget: the <script> tag is missing data-site.");
    this.name = "MissingSiteKeyError";
  }
}

/**
 * `20-07`: takes the real `HTMLScriptElement`, not the narrower `HTMLOrSVGScriptElement` `20-06`
 * left this typed as - `.src` (an absolute URL, resolved by the DOM itself) is not on that mixin,
 * and `scriptUrl` below is the one config field that needs it. `index.ts` has already narrowed to
 * this type by the time it calls here (`instanceof HTMLScriptElement`), so nothing upstream changes.
 */
export function readConfig(script: HTMLScriptElement): WidgetConfig {
  const siteKey = script.dataset["site"];
  if (!siteKey) {
    throw new MissingSiteKeyError();
  }

  const apiBaseUrl = script.dataset["api"] ?? inferApiBaseUrl(script.src) ?? __AGO_DEFAULT_API_BASE_URL__;
  return {
    siteKey,
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
    demoNotice: readDemoNotice(script),
    bookingModuleEnabled: script.dataset["booking"] === "true",
    scriptUrl: script.src,
  };
}

/**
 * `#337`: the middle step of `readConfig`'s resolution order - `script.src`'s own origin, stripped
 * of the `/widget/ago-chat.js` path `scriptUrl` (above) deliberately keeps. `undefined` rather than
 * a guess or a throw whenever the origin is not one a request could actually reach, so the caller's
 * `??` falls through to the baked constant exactly as if this step were not run at all:
 *
 * - **No `src` at all** (an inline `<script>`, or one whose attribute was never set) - the DOM
 *   itself gives `""` for `.src` in that case, not a URL to parse.
 * - **An opaque origin** - `about:blank`, `data:`, and similar give a `URL#origin` of the literal
 *   string `"null"` per the URL Standard. Returning that string would make `apiBaseUrl` the four
 *   characters `"null"`, which is worse than falling through: it looks like a configured value.
 * - **Anything `new URL` cannot parse** - defensive; `script.src` is already DOM-resolved and
 *   absolute, so this should not happen outside a test double.
 */
function inferApiBaseUrl(scriptSrc: string): string | undefined {
  if (!scriptSrc) {
    return undefined;
  }

  try {
    const origin = new URL(scriptSrc).origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

/**
 * Unknown values fall through to `"none"` rather than throwing or defaulting to `"public"`.
 *
 * A typo in an attribute must not decide what a stranger is told about their own privacy: defaulting
 * to `"public"` would put a false warning on a private tenant, and defaulting to `"private"` would
 * remove a true one from a public page. Saying nothing is the only option that cannot be wrong in a
 * way that misleads somebody, and a demo page that loses its notice is a bug a test catches -
 * `8-11`'s own do.
 */
function readDemoNotice(script: HTMLOrSVGScriptElement): DemoNotice {
  const notice = script.dataset["demoNotice"];
  if (notice === "public" || notice === "private") {
    return notice;
  }

  // `8-06`'s original attribute. Exact `"true"`, not presence-of-attribute:
  // `data-public-demo="false"` is what someone turning the notice back off will actually write, and
  // HTML's own boolean-attribute convention (presence wins, value ignored) would keep it on and be
  // read as a bug rather than as a convention.
  return script.dataset["publicDemo"] === "true" ? "public" : "none";
}
