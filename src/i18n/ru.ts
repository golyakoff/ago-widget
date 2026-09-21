import type { WidgetStrings } from "./strings.js";

/**
 * `11-10`: `Ago.Chat.Domain.Locale.Ru` - the second and, for now, last locale in this closed set
 * (`Locale`'s own remarks on why a third is a name and a string file away rather than built
 * speculatively). Every value here is a translation of `en.ts`'s frame text; interpolated data
 * (calendar/service/worker names, numbers) is never translated, only the words around it.
 */
export const ru: WidgetStrings = {
  openChat: "Открыть чат",
  // `25-141`: Russian's own count-agreement rule (1 -> singular, 2-4 -> "few" genitive singular, 5+
  // and every teen -> genitive plural) - `count` is never itself translated (`Out of scope`, this
  // table's own doc comment), only the noun ending it forces.
  openChatWithUnreadCount: (count) => {
    const mod10 = count % 10;
    const mod100 = count % 100;
    const noun =
      mod10 === 1 && mod100 !== 11 ? "непрочитанное сообщение"
      : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? "непрочитанных сообщения"
      : "непрочитанных сообщений";
    return `Открыть чат (${count} ${noun})`;
  },
  closeChat: "Закрыть чат",
  chatLabel: "Чат",
  chatWithUs: "Чем мы могли бы вам помочь?",
  connecting: "Подключение…",
  reconnecting: "Переподключение…",
  disconnectedReconnecting: "Соединение потеряно. Пытаемся переподключиться…",
  messageAriaLabel: "Сообщение",
  typeAMessage: "Введите сообщение…",
  send: "Отправить",
  attachAFile: "Прикрепить файл",
  insertEmoji: "Вставить эмодзи",
  emojiPickerLabel: "Выбор эмодзи",
  saveConversation: "Сохранить диалог",
  saveConversationFailedNote: "Не удалось сохранить диалог. Попробуйте ещё раз.",
  previousChatExpired:
    "Срок действия предыдущего чата истёк, поэтому это новый диалог. Всё, что вы отправляли раньше, здесь больше не отображается.",
  chatUnavailable: "Чат сейчас недоступен. Попробуйте позже.",
  sessionExpired: "Срок действия сессии чата истёк. Перезагрузите страницу, чтобы начать новую.",
  sendOutcomeUnknownNote: "Не уверены, что сообщение отправлено — соединение прервалось во время запроса.",
  notConnectedRetryNote: "Не отправлено — идёт переподключение. Повторная отправка не выполняется автоматически.",
  sendFailedNote: "Не удалось отправить.",
  conversationEndedNote: "Не отправлено — диалог завершён.",
  uploading: "Загрузка…",
  uploadFailedNote: "Не удалось отправить вложение.",
  downloadAttachment: "📎 Скачать вложение",
  attachmentUnavailable: "Вложение недоступно.",
  attachmentRemoved: "Этот файл был удалён.",
  attachmentAlt: "Вложение",
  publicDemoNotice:
    "Это публичная демонстрация. Всё, что вы здесь напишете, может прочитать любой, кто откроет демо-консоль оператора. Не указывайте реальные данные.",
  privateDemoNotice:
    "Это ваш собственный демо-тенант. Прочитать этот диалог может только тот, у кого есть выданный вам логин оператора, а сам тенант удалится примерно через сутки.",
  processingNoticeLinkText: "Подробнее",
  channelSwitcherGroupLabel: "Другие способы связаться с нами",
  channelSwitcherWriteInChat: "Написать в чат",
  channelSwitcherRoutingQuestion: "Как вам удобнее с нами связаться?",
  channelSwitcherOnlineChat: "Онлайн чат",
  channelSwitcherCancel: "Отмена",

  unsupportedFileTypeSuffix: "не поддерживается. Попробуйте изображение или PDF.",
  unknownFileType: "неизвестный тип",
  fileTooLarge: (maxMb) => `Файл слишком большой (максимум ${maxMb} МБ).`,

  yourAnswer: "Ваш ответ",
  continueLabel: "Продолжить",

  contactCaptureNamePlaceholder: "Ваше имя",
  contactCapturePhonePlaceholder: "Номер телефона",
  contactCaptureEmailPlaceholder: "Электронная почта",
  contactCaptureIntroLink: "Представиться…",
  contactCaptureSubmitButton: "Отправить",
  contactCaptureSubmittingButton: "Отправка…",
  contactCaptureConfirmation: "Спасибо, {name}, ваши контакты добавлены.",
  contactCaptureFailedNote: "Не удалось отправить. Попробуйте ещё раз.",
  contactCaptureEmailInvalidNote: "Похоже, это не настоящий адрес электронной почты.",

  // `8-13`: translations of `en.ts`'s own `demoOwnTenantBannerNotice`/`demoOwnTenantPrivacyNote` -
  // see that file's doc comment for why `demo/boot.ts` resolves these by itself.
  demoOwnTenantBannerNotice:
    "Это ваш собственный тенант. Опубликованный ниже логин оператора относится к общему демо-магазину, "
    + "а не к этому тенанту — прочитать то, что вы здесь пишете, не может никто, кроме вас. Этот "
    + "тенант и всё, что в нём есть, удалятся сами примерно через сутки.",
  demoOwnTenantPrivacyNote:
    "Безопасно для инфраструктуры и приватно для вас на этой странице: логин выше опубликован, но он "
    + "даёт доступ только к общему демо-магазину — никогда к тенанту, на котором вы находитесь. "
    + "Прочитать этот диалог может только выданная вам учётная запись оператора, и она удаляется "
    + "вместе с тенантом примерно через сутки.",
};
