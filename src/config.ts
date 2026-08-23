/**
 * `data-site` on the `<script>` tag identifies the tenant (embeddable-widget skill's Bootstrap
 * section) - the one piece of config every embed must supply. `data-api` is additive: the public
 * bundle's own default points at the real deployment, and a local build (the demo page, this
 * repo's own dev loop) overrides it to the local cluster's `Ago.Chat.Api` instead of baking a
 * second build just for that - config the CI-built artifact and the demo page both consume through
 * the same script tag, matching the site key's own precedent rather than inventing a build-time
 * environment-variable story a single static bundle does not otherwise need.
 */
export interface WidgetConfig {
  siteKey: string;
  apiBaseUrl: string;
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
  return { siteKey, apiBaseUrl: apiBaseUrl.replace(/\/+$/, "") };
}
