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
  },
  ru: {
    documentTitle: "Копия диалога",
    htmlLang: "ru",
    visitorLabel: "Вы",
    operatorLabel: "Оператор",
    systemLabel: "Автоматический ответ",
    attachmentLabel: "Вложение",
    attachmentUnavailable: "Вложение недоступно.",
  },
};

export function saveConversationCopy(locale: SupportedLocale): SaveConversationCopy {
  return COPY[locale];
}
