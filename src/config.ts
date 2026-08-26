/**
 * `data-site` on the `<script>` tag identifies the tenant (embeddable-widget skill's Bootstrap
 * section) - the one piece of config every embed must supply. `data-api` is additive: the public
 * bundle's own default points at the real deployment, and a local build (the demo page, this
 * repo's own dev loop) overrides it to the local cluster's `Ago.Chat.Api` instead of baking a
 * second build just for that - config the CI-built artifact and the demo page both consume through
 * the same script tag, matching the site key's own precedent rather than inventing a build-time
 * environment-variable story a single static bundle does not otherwise need.
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
}

/** Replaced at build time by `build.mjs` - see that file for why a `define` beats a runtime fetch. */
declare const __AGO_DEFAULT_API_BASE_URL__: string;

export class MissingSiteKeyError extends Error {
  constructor() {
    super("AGO Chat widget: the <script> tag is missing data-site.");
    this.name = "MissingSiteKeyError";
  }
}

export function readConfig(script: HTMLOrSVGScriptElement): WidgetConfig {
  const siteKey = script.dataset["site"];
  if (!siteKey) {
    throw new MissingSiteKeyError();
  }

  const apiBaseUrl = script.dataset["api"] ?? __AGO_DEFAULT_API_BASE_URL__;
  return { siteKey, apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""), demoNotice: readDemoNotice(script) };
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
