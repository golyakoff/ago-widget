import type { WidgetConfig } from "./config.js";

/**
 * `24-05`: the widget's own read/write pair onto `Ago.Chat.Api.Consent.ConsentEndpoints` -
 * `GET`/`POST /api/v1/conversations/{id}/consent`, under the same signed visitor token every other
 * authenticated write in this widget already carries (`contactDetails.ts`'s own precedent). Kept in
 * its own file, not folded into `contactDetails.ts`: a consent acceptance is a different resource from
 * a contact detail, with its own two-purpose vocabulary ("Contact"/"Marketing"), even though both are
 * read by the same control (`ui/contactCapture.ts`).
 *
 * <b>The gate this item's own crux is about attaches to *handing over a contact detail*, never to the
 * conversation.</b> This file's own `getConsentRequirement` is what lets the widget ask, before it even
 * shows the phone form, whether the site requires a recorded consent at all - a site that never turned
 * `RequireContactConsent` on gets back `{ contactRequired: false, ... }`, and the widget renders the
 * form exactly as `23-09` already does, with no checkbox at all.
 */
export class ConsentRejectedError extends Error {}

async function problemMessage(response: Response): Promise<string> {
  try {
    const problem = (await response.json()) as { title?: string };
    return problem.title ?? `Request failed: ${response.status}`;
  } catch {
    return `Request failed: ${response.status}`;
  }
}

export interface ConsentDocumentSummary {
  title: string;
  body: string;
}

/**
 * The widget's own trimmed read of `Ago.Chat.Api.Consent.ConsentEndpoints.ConsentRequirementResponse`
 * - `documentKey`/`version`/`publishedAt` are dropped, since nothing client-side ever needs to name a
 * version; only what a person reads and whether this particular visitor already accepted it.
 */
export interface ConsentRequirement {
  contactRequired: boolean;
  contact: ConsentDocumentSummary | null;
  contactAlreadyAccepted: boolean;
  marketing: ConsentDocumentSummary | null;
  marketingAlreadyAccepted: boolean;
}

interface ConsentDocumentResponseBody {
  documentKey: string;
  version: string | null;
  title: string | null;
  body: string | null;
  publishedAt: string | null;
}

interface ConsentRequirementResponseBody {
  contactRequired: boolean;
  contact: ConsentDocumentResponseBody | null;
  contactAlreadyAccepted: boolean;
  marketing: ConsentDocumentResponseBody | null;
  marketingAlreadyAccepted: boolean;
}

function toSummary(body: ConsentDocumentResponseBody | null | undefined): ConsentDocumentSummary | null {
  // `title`/`body` are null when the site requires this purpose but the tenant has not published
  // anything under its own key yet (`GetConsentRequirementHandler`'s own "required, not yet available"
  // reading) - the widget treats that identically to "nothing to show", never as a value to render.
  // `undefined` (a response body missing the field entirely, never sent by the real API but still
  // worth not trusting blindly - `parseWidgetColor`'s own "courtesy re-check" posture) gets the same
  // treatment rather than a thrown TypeError.
  if (body == null || body.title == null || body.body == null) {
    return null;
  }

  return { title: body.title, body: body.body };
}

export async function getConsentRequirement(
  config: WidgetConfig,
  token: string,
  conversationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConsentRequirement> {
  const response = await fetchImpl(`${config.apiBaseUrl}/api/v1/conversations/${conversationId}/consent`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new ConsentRejectedError(await problemMessage(response));
  }

  const parsed = (await response.json()) as ConsentRequirementResponseBody;
  return {
    contactRequired: parsed.contactRequired,
    contact: toSummary(parsed.contact),
    contactAlreadyAccepted: parsed.contactAlreadyAccepted,
    marketing: toSummary(parsed.marketing),
    marketingAlreadyAccepted: parsed.marketingAlreadyAccepted,
  };
}

/**
 * `purpose` is `"Contact"` or `"Marketing"` - the same two `Ago.Chat.Domain.VisitorConsentPurpose`
 * member names every other client of this endpoint sends verbatim (`RecordVisitorConsent`'s own
 * remarks). This widget never records a decline - refusing is simply never calling this at all
 * (`submitContactCapture`'s own remarks in `ui/widget.ts`), the identical "insert-only, nothing to
 * record for 'no'" shape `AcceptanceRecord` itself is built on.
 */
export async function recordConsent(
  config: WidgetConfig,
  token: string,
  conversationId: string,
  purpose: "Contact" | "Marketing",
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`${config.apiBaseUrl}/api/v1/conversations/${conversationId}/consent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ purpose }),
  });

  if (!response.ok) {
    throw new ConsentRejectedError(await problemMessage(response));
  }
}
