import type { SupportedLocale } from "../../i18n/resolve.js";

/**
 * `23-62`: the transcript's own fixed words, translated - kept inside this lazily-loaded module
 * rather than added to `i18n/strings.ts`/`WidgetStrings`, the same split `20-07`'s `bookingChipSpec`
 * already draws for the booking chip's copy. `WidgetStrings` is threaded through the *base* bundle's
 * constructor and read on every render; growing it for four words most visitors never trigger (the
 * transcript file's own headings) would cost every visitor a few bytes of a table this module alone
 * needs. A small `Record<SupportedLocale, …>` mirrors `bookingChipSpec`'s own shape rather than
 * inventing a second one.
 */
export interface SaveConversationCopy {
  readonly documentTitle: string;
  readonly htmlLang: string;
  readonly visitorLabel: string;
  readonly operatorLabel: string;
  readonly systemLabel: string;
  readonly attachmentLabel: string;
  readonly attachmentUnavailable: string;
  /** `25-94`: shown instead of `attachmentUnavailable` - never alongside it - for the one lookup
   * failure that is permanent: `fetchAttachmentLocation` returning `"removed"`
   * (`AttachmentLookupFailure`, `archive.ts`), the identical distinction `25-80` drew for the live
   * rendering path's own `attachmentRemoved` string in `i18n/strings.ts`. Kept in this module's own
   * small table rather than added by reaching into `WidgetStrings` - this table already exists
   * precisely so a handful of transcript-only words do not grow the base bundle every visitor pays
   * for (see this file's own top-of-file doc comment). */
  readonly attachmentRemoved: string;
}

const COPY: Record<SupportedLocale, SaveConversationCopy> = {
  en: {
    documentTitle: "Conversation transcript",
    htmlLang: "en",
    visitorLabel: "You",
    operatorLabel: "Operator",
    systemLabel: "Automatic reply",
    attachmentLabel: "Attachment",
    attachmentUnavailable: "Attachment unavailable.",
    attachmentRemoved: "This file was removed.",
  },
  ru: {
    documentTitle: "Копия диалога",
    htmlLang: "ru",
    visitorLabel: "Вы",
    operatorLabel: "Оператор",
    systemLabel: "Автоматический ответ",
    attachmentLabel: "Вложение",
    attachmentUnavailable: "Вложение недоступно.",
    attachmentRemoved: "Этот файл был удалён.",
  },
};

export function saveConversationCopy(locale: SupportedLocale): SaveConversationCopy {
  return COPY[locale];
}
