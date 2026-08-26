/**
 * Wire shapes mirroring `Ago.Chat.Contracts` (api-design.md: "payload shapes live in
 * Ago.Chat.Contracts and are versioned with the same additive-only rule as integration events").
 * This file has no logic - it exists so the rest of the widget never guesses field names.
 */

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
 * value falls back to. */
export interface VisitorSessionResponse {
  token: string;
  visitorId: string;
  widgetPrimaryColorHex: string | null;
  widgetPosition: string;
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
