/**
 * `18-12`: what the widget reads from the browser, once, at the moment a conversation actually starts
 * - `document.referrer`'s own host, and whichever of `utm_source`/`utm_medium`/`utm_campaign` the
 * landing page's own URL carried. Read here, not on the server: the browser is the only place either
 * value ever exists (`connection.ts`'s own `start()` is the "conversation actually starts" moment -
 * see that method's remarks for why this is not widget mount/page load).
 *
 * **The empty case is the common one, not the exception.** A direct visit, a privacy-blocking browser
 * setting, or a referrer-stripping browser all leave `document.referrer` as `""` - `captureTrafficSource`
 * reports that the same way it reports "no UTM tag on this URL": every field simply absent from the
 * result, never a placeholder string. The server-side `TrafficSource` value object treats an absent
 * field and a whitespace-only one identically (its own remarks), so nothing here needs to distinguish
 * them either.
 *
 * **Never throws.** A malformed `document.referrer` (some browser extensions rewrite it to something
 * that is not a valid URL) or a landing page URL `URL` cannot parse degrades to "nothing captured",
 * the same posture `config.ts`'s `parseWidgetColor`/`parseWidgetPosition` already take for a malformed
 * site config value - a conversation must still be able to start when this fails.
 */
export interface CapturedTrafficSource {
  referrerHost?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

const UTM_PARAM_NAMES = {
  utmSource: "utm_source",
  utmMedium: "utm_medium",
  utmCampaign: "utm_campaign",
} as const;

/**
 * Reads `document.referrer` and `location.href` directly - the two browser-global reads this item's
 * own Scope names, made exactly once per widget lifetime by `connection.ts`'s `start()`.
 *
 * Builds the result by assigning only the keys that actually have a value, never explicitly assigning
 * `undefined` to one - this project's `tsconfig.json` sets `exactOptionalPropertyTypes`, which treats
 * "key absent" and "key present with value `undefined`" as genuinely different types, and only the
 * first is what an optional field here is meant to express.
 */
export function captureTrafficSource(): CapturedTrafficSource {
  const result: CapturedTrafficSource = {};

  const referrerHost = parseReferrerHost(document.referrer);
  if (referrerHost !== undefined) {
    result.referrerHost = referrerHost;
  }

  const params = parseUtmParams(location.href);
  for (const [key, value] of Object.entries(params) as [keyof typeof UTM_PARAM_NAMES, string][]) {
    result[key] = value;
  }

  return result;
}

function parseReferrerHost(referrer: string): string | undefined {
  if (referrer === "") {
    return undefined;
  }

  try {
    const host = new URL(referrer).hostname;
    return host === "" ? undefined : host;
  } catch {
    return undefined;
  }
}

function parseUtmParams(href: string): Partial<Record<keyof typeof UTM_PARAM_NAMES, string>> {
  try {
    const params = new URL(href).searchParams;
    const result: Partial<Record<keyof typeof UTM_PARAM_NAMES, string>> = {};
    for (const [key, paramName] of Object.entries(UTM_PARAM_NAMES) as [keyof typeof UTM_PARAM_NAMES, string][]) {
      const value = params.get(paramName);
      if (value !== null && value !== "") {
        result[key] = value;
      }
    }

    return result;
  } catch {
    return {};
  }
}
