/**
 * Wire shapes mirroring `Ago.Chat.Contracts` (api-design.md: "payload shapes live in
 * Ago.Chat.Contracts and are versioned with the same additive-only rule as integration events").
 * This file has no logic - it exists so the rest of the widget never guesses field names.
 */

export interface MessageDto {
  id: string;
  sequence: number;
  authorKind: "Visitor" | "Operator";
  authorId: string;
  body: string;
  createdAt: string;
  attachmentId?: string | null;
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

export interface VisitorSessionResponse {
  token: string;
  visitorId: string;
}

/** RFC 7807 problem details (api-design.md) - the shape every error response from the API takes. */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  traceId?: string;
}
