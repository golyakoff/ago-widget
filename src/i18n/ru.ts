import type { WidgetStrings } from "./strings.js";

/**
 * `11-10`: `Ago.Chat.Domain.Locale.Ru` - the second and, for now, last locale in this closed set
 * (`Locale`'s own remarks on why a third is a name and a string file away rather than built
 * speculatively). Every value here is a translation of `en.ts`'s frame text; interpolated data
 * (calendar/service/worker names, numbers) is never translated, only the words around it.
 */
export const ru: WidgetStrings = {
  openChat: "Открыть чат",
  closeChat: "Закрыть чат",
  chatLabel: "Чат",
  chatWithUs: "Чат с нами",
  connecting: "Подключение…",
  reconnecting: "Переподключение…",
  disconnectedReconnecting: "Соединение потеряно. Пытаемся переподключиться…",
  messageAriaLabel: "Сообщение",
  typeAMessage: "Введите сообщение…",
  send: "Отправить",
  attachAFile: "Прикрепить файл",
  previousChatExpired:
    "Срок действия предыдущего чата истёк, поэтому это новый диалог. Всё, что вы отправляли раньше, здесь больше не отображается.",
  chatUnavailable: "Чат сейчас недоступен. Попробуйте позже.",
  sessionExpired: "Срок действия сессии чата истёк. Перезагрузите страницу, чтобы начать новую.",
  sendOutcomeUnknownNote: "Не уверены, что сообщение отправлено — соединение прервалось во время запроса.",
  notConnectedRetryNote: "Не отправлено — идёт переподключение. Повторная отправка не выполняется автоматически.",
  sendFailedNote: "Не удалось отправить.",
  uploading: "Загрузка…",
  uploadFailedNote: "Не удалось отправить вложение.",
  downloadAttachment: "📎 Скачать вложение",
  attachmentUnavailable: "Вложение недоступно.",
  attachmentAlt: "Вложение",
  publicDemoNotice:
    "Это публичная демонстрация. Всё, что вы здесь напишете, может прочитать любой, кто откроет демо-консоль оператора. Не указывайте реальные данные.",
  privateDemoNotice:
    "Это ваш собственный демо-тенант. Прочитать этот диалог может только тот, у кого есть выданный вам логин оператора, а сам тенант удалится примерно через сутки.",
  autoReplyLabel: "Автоматический ответ",
  processingNoticeLinkText: "Подробнее",

  unsupportedFileTypeSuffix: "не поддерживается. Попробуйте изображение или PDF.",
  unknownFileType: "неизвестный тип",
  fileTooLarge: (maxMb) => `Файл слишком большой (максимум ${maxMb} МБ).`,

  yourAnswer: "Ваш ответ",
  continueLabel: "Продолжить",
};
