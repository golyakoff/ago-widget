/**
 * `data-site` on the `<script>` tag identifies the tenant (embeddable-widget skill's Bootstrap
 * section) - the one piece of config every embed must supply. `data-api` is additive: the public
 * bundle's own default points at the real deployment, and a local build (the demo page, this
 * repo's own dev loop) overrides it to the local cluster's `Ago.Chat.Api` instead of baking a
 * second build just for that - config the CI-built artifact and the demo page both consume through
 * the same script tag, matching the site key's own precedent rather than inventing a build-time
 * environment-variable story a single static bundle does not otherwise need.
 *
 * `8-06`: `data-public-demo` is the third, and is a flag rather than a free-text notice string on
 * purpose. The sentence it turns on is *this widget's* sentence about *our* public demo pages, not a
 * per-tenant one - a tenant-configurable processing notice is `16-04`'s job, server-driven, and
 * shipping a `data-notice="..."` attribute here would quietly pre-commit that design to a
 * host-page-authored string. A boolean leaves `16-04` free and keeps this item what it is: our own
 * copy on our own two pages.
 */
export interface WidgetConfig {
  siteKey: string;
  apiBaseUrl: string;
  /** Renders the "anyone can read this" line inside the panel. Off unless the embed asks for it. */
  isPublicDemo: boolean;
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
  // Exact `"true"`, not presence-of-attribute: `data-public-demo="false"` is what someone turning
  // the notice back off will actually write, and HTML's own boolean-attribute convention (presence
  // wins, value ignored) would keep it on and be read as a bug rather than as a convention.
  const isPublicDemo = script.dataset["publicDemo"] === "true";
  return { siteKey, apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""), isPublicDemo };
}
