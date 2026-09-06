import type { WidgetConfig } from "./config.js";

/**
 * `23-09`: the visitor's own write path onto `Ago.Chat.Application.UseCases.RecordVisitorContactDetail`
 * - `POST /api/v1/conversations/{id}/contact-details` under a signed visitor token, the identical
 * dual-scheme route `attachments.ts`'s own `createAttachment` already calls, narrowed server-side to
 * `RecordVisitorContactDetailHandler.HandleAsVisitorAsync` (`ContactDetailEndpoints`'s own remarks: the
 * handler branches on the caller's token kind, not this file's own shape). This widget never reads the
 * response body - the control only needs to know the write succeeded, never the server-stamped id or
 * timestamp - so the return type is `void`, unlike `attachments.ts`'s own `createAttachment`, which the
 * caller needs the presigned URL back from.
 *
 * <b>No verification, by design (`docs/design/decisions.md` §4).</b> This call has no counterpart that
 * proves the visitor controls the value they typed - "no verification for a callback," because only
 * the tenant benefits from one, and a fake number costs one wasted call, not a stolen slot the way a
 * booking's own phone-verified flow protects. `RecordFromVisitor`'s own remarks on the server side are
 * what actually enforce `verified: false`; this file has no flag to set even if it wanted to.
 */
export class ContactDetailRejectedError extends Error {}

async function problemMessage(response: Response): Promise<string> {
  try {
    const problem = (await response.json()) as { title?: string };
    return problem.title ?? `Request failed: ${response.status}`;
  } catch {
    return `Request failed: ${response.status}`;
  }
}

/**
 * One row per call - `kind` is `"Phone"` or `"Other"`, the same
 * `Ago.Chat.Domain.VisitorContactDetailKind` member names every other client in this codebase sends
 * verbatim (`ago-console`'s own `contactDetailsApi.ts`). The control this file backs
 * (`ui/contactCapture.ts`) calls this once for the phone number and, only if the visitor typed one,
 * once more for the name - two rows rather than a wider schema, because `VisitorContactDetail` has no
 * "name" kind of its own and `Other`'s own remarks already name "a preferred name" as exactly what it
 * is for.
 */
export async function recordContactDetail(
  config: WidgetConfig,
  token: string,
  conversationId: string,
  kind: string,
  value: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`${config.apiBaseUrl}/api/v1/conversations/${conversationId}/contact-details`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind, value }),
  });

  if (!response.ok) {
    throw new ContactDetailRejectedError(await problemMessage(response));
  }
}
