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
   * unrecognised-kind path, which renders it on the incoming side.
   *
   * `23-64`: `"AutoGreeting"` joins on the identical additive terms - the auto-open greeting,
   * materialised as the conversation's real first message the moment the visitor writes
   * (`adr/0148`). Rendered like `"Operator"`, not like `"System"` - see `ui/widget.ts`'s
   * `renderBubble`/`modules/saveConversation/archive.ts`'s own remarks for why: this is the
   * author's own decision that the greeting reads as if from the shop's side, the exact opposite of
   * `"System"`'s (future, `23-56`) tenant-editable machine name. */
  authorKind: "Visitor" | "Operator" | "System" | "AutoGreeting";
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
  /** `23-78`: `Ago.Chat.Contracts.VisitorJoinResult.HasAttachmentUploadGrant` - whether this
   * conversation currently carries a visitor-side attachment-upload grant. This is the widget's one
   * and only channel for the fact; `ui/widget.ts` uses it only to decide whether to show the attach
   * icon at all - the server's own `CreateAttachmentHandler.HandleAsVisitorAsync` is the real control
   * regardless of what this field says (hiding the icon is a consequence, never the control). Missing
   * on an older server (before this field existed) reads as `undefined`, which this widget treats the
   * same as `false` - the closed-by-default direction is the safe one for a field this widget cannot
   * itself verify. Still not a live push the instant an operator toggles it - `connection.ts`'s
   * `onAttachmentUploadGrantChange` re-reads this same field on every automatic reconnect (a network
   * blip, a laptop waking up), which narrows the staleness window to that but does not close it: a
   * visitor who stays connected the whole time sees the icon catch up only on the next reconnect or a
   * full page reload, the same residual gap this widget already accepts for a block/unblock. */
  hasAttachmentUploadGrant?: boolean;
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
 * other field on this response already gets.
 *
 * `23-105`: `enabledModules` joins on the identical "additive field on the existing handshake shape"
 * terms - raw module keys the platform has granted this site (e.g. `["calendar"]`), never a single
 * product's boolean. Before this item nothing on this response said what a site was entitled to; a
 * shop's own page asserted booking through `data-booking="true"` instead, which is exactly the fact
 * `adr/0151` says a tenant may not assert - only the platform grants an entitlement. This is the one
 * field on the wire allowed to say "calendar": `config.ts`'s own remarks explain why translating it
 * into this widget's pre-existing, statically-wired booking chip is this repository's job and not
 * `Ago.Chat.*`'s.
 *
 * `23-63`: `widgetAttractAttention` joins on the identical terms - one more additive field, `false`
 * (or absent, for a session cached before this setting existed) for every site that has not turned
 * «Привлекать внимание» on. Normalised by `ui/appearance.ts`'s `parseAttractAttention`, the same
 * courtesy-re-check every other field here already gets. Optional rather than required: a response
 * this widget's own `WidgetStorage` cached before the field existed replays it as `undefined`, not a
 * decode failure - `parseAttractAttention` treats that identically to `false`. */
export interface VisitorSessionResponse {
  token: string;
  visitorId: string;
  widgetPrimaryColorHex: string | null;
  widgetPosition: string;
  widgetLocale: string;
  widgetNoticeText: string | null;
  widgetNoticeUrl: string | null;
  enabledModules: string[];
  widgetAttractAttention?: boolean;
  /**
   * `23-64`/`adr/0148`: three more additive fields, on the identical "optional, absent for a
   * pre-existing session, `parse*` normalises" terms `widgetAttractAttention` already established.
   * `widgetAutoOpenDelaySeconds` crosses the wire as the plain `int` `Ago.Chat.Domain.AutoOpenDelay`
   * already is (`AutoOpenConfig`'s own remarks - no PascalCase-string convention to parse, unlike
   * `widgetPosition`/`widgetLocale`). `widgetAutoOpenGreetingText` is `null`/absent for every site
   * that has not configured one - never a default sentence this widget would supply on the tenant's
   * behalf.
   */
  widgetAutoOpenEnabled?: boolean;
  widgetAutoOpenDelaySeconds?: number;
  widgetAutoOpenGreetingText?: string | null;
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
