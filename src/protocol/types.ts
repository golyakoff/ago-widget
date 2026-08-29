/**
 * Wire shapes mirroring `Ago.Chat.Contracts` (api-design.md: "payload shapes live in
 * Ago.Chat.Contracts and are versioned with the same additive-only rule as integration events").
 * This file has no logic - it exists so the rest of the widget never guesses field names.
 */

/** `20-07`: `adr/0061`'s (kind, payload, actions) shape, on the wire. `label`/`value` are the whole
 * of an action - no icon, no styling hint, no "primary": a hint would be an opinion about the choice
 * that a text channel could not honour (the same reasoning `booking/steps.ts` used to carry, before
 * this item moved it server-side). */
export interface MessageActionDto {
  readonly label: string;
  readonly value: string;
}

export interface MessageDto {
  id: string;
  sequence: number;
  /** `14-04`: `"System"` is a message AGO Chat authored on the shop's behalf - today the offline
   * auto-reply, and nothing else. Additive, exactly as api-design.md's versioning rule promises: a
   * widget build older than `14-04` still receives one and simply falls through to its own
   * unrecognised-kind path, which renders it on the incoming side. */
  authorKind: "Visitor" | "Operator" | "System";
  authorId: string;
  body: string;
  createdAt: string;
  attachmentId?: string | null;
  /** `5-07`: additive, optional - `null`/absent for any message sent before this shipped, since
   * nothing back-filled it. Declared here by `5-17`, which is when this side first read it: the
   * server has put it on every delivery of a visitor's message from the start (the local echo, the
   * broker fan-out copy, and the history a resuming `JoinAsync` replays all go through `VisitorHub`'s
   * one `ToDto`), the widget simply never looked. See `ui/widget.ts`'s `handleIncoming` for what it
   * is used for and `protocol/dedup.ts` for where the id comes from. */
  clientMessageId?: string | null;
  /**
   * `20-07`: `adr/0065`'s closed primitive vocabulary - `"choice_list"`, `"form"`,
   * `"confirmation_card"`, `"date_time_picker"` today, or anything else a module or a future Chat
   * version invents. **A string, not a union** - the widget's own reading of the four it currently
   * understands lives in `ui/primitives/render.ts`, kept separate from this wire type on purpose, the
   * same reasoning `booking/steps.ts`'s retired `BookingStep.kind` gave: a closed set here would mean
   * every new kind any product ever produces needs a member added to whoever holds this type. Absent
   * or unrecognised must render as plain `body` and never throw - `ui/primitives/render.ts`'s own
   * contract.
   */
  contentKind?: string | null;
  /** Opaque to this file and to every renderer except the one for `contentKind`'s own value - the
   * server's `JsonElement?`, read here as `unknown` because this widget must never assume a shape
   * before checking `contentKind` first (`ui/primitives/render.ts` is the one place that does). */
  content?: unknown;
  /** The choices for a choice-shaped `contentKind`, empty for `"form"`. Chat never opens `content`,
   * so this travels as its own first-class field rather than living inside it - `adr/0061`'s "an
   * action is a label and an opaque value, and nothing else". */
  actions?: readonly MessageActionDto[] | null;
}

export interface VisitorJoinResult {
  conversationId: string;
  isNew: boolean;
  history: MessageDto[];
}

export interface HistoryPage {
  messages: MessageDto[];
  nextBeforeSequence: number | null;
}

/** `11-03`: `widgetPrimaryColorHex`/`widgetPosition` are additive fields `11-01` added to this same
 * response (`AuthEndpoints.VisitorSessionResponse`, `ago-chat`) - no second round trip. `widgetPosition`
 * carries the `Position` enum's PascalCase member name on the wire (`"BottomRight"`/`"BottomLeft"`),
 * not yet normalised to this widget's own lowercase `WidgetPosition` union - `ui/appearance.ts`'s
 * `parseWidgetPosition` is what does that, the one place this widget decides what an unrecognised
 * value falls back to.
 *
 * `11-10`: `widgetLocale` joins on the identical terms - a flat, additive sibling field carrying
 * `Ago.Chat.Domain.Locale`'s own PascalCase member name (`"En"`/`"Ru"`), normalised by
 * `i18n/resolve.ts`'s `parseWidgetLocale`, the same split `parseWidgetPosition` already draws.
 *
 * `16-04`: `widgetNoticeText`/`widgetNoticeUrl` join on the identical terms - two more additive,
 * nullable fields, both `null` for every site that has not configured a processing notice. Normalised
 * by `ui/appearance.ts`'s `parseNoticeText`/`parseNoticeUrl`, the same courtesy-re-check split every
 * other field on this response already gets. */
export interface VisitorSessionResponse {
  token: string;
  visitorId: string;
  widgetPrimaryColorHex: string | null;
  widgetPosition: string;
  widgetLocale: string;
  widgetNoticeText: string | null;
  widgetNoticeUrl: string | null;
}

/** RFC 7807 problem details (api-design.md) - the shape every error response from the API takes. */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  traceId?: string;
}

/** `POST /api/v1/conversations/{id}/attachments` (file-storage.md's Upload flow, steps 1-2). */
export interface CreateAttachmentResponse {
  attachmentId: string;
  uploadUrl: string;
  expiresAt: string;
}

/** `GET /api/v1/attachments/{id}` (`5-10`: gained `contentType`/`thumbnailUrl` alongside the
 * presigned `url` a widget/console client already needed to decide how to render an attachment
 * without guessing from the URL's own file extension). */
export interface AttachmentDownloadInfo {
  url: string;
  contentType: string;
  thumbnailUrl: string | null;
  expiresAt: string;
}
