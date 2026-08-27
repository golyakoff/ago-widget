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
  book: "Запись",
  bookAnAppointment: "Записаться на приём",
  backToConversation: "Вернуться к переписке",
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

  unsupportedFileTypeSuffix: "не поддерживается. Попробуйте изображение или PDF.",
  unknownFileType: "неизвестный тип",
  fileTooLarge: (maxMb) => `Файл слишком большой (максимум ${maxMb} МБ).`,

  yourAnswer: "Ваш ответ",
  continueLabel: "Продолжить",
  loadingAvailableTimes: "Загрузка доступного времени…",

  nothingToBookYet: "Здесь пока нечего бронировать.",
  whichCalendar: "Какой календарь вы хотите выбрать?",
  notAnOption: "Это не один из предложенных вариантов.",
  withWorker: "с",
  whatIsYourPhoneNumber: "Какой у вас номер телефона?",
  phoneNumberRequired: "По номеру телефона с вами свяжется магазин, поэтому его нельзя оставить пустым.",
  namePrompt: "А как вас зовут? Оставьте поле пустым, если не хотите указывать.",
  bookingFinished: "Эта запись завершена.",
  whatWouldYouLikeToBook: "Что вы хотите забронировать?",
  minutesUnit: (durationMinutes) => `(${durationMinutes} мин)`,
  nobodyAvailable: "Сейчас никто не доступен для этого.",
  anyone: "Любой",
  whoWouldYouLikeToSee: "Кого вы хотите выбрать?",
  noFreeTimes: "Сейчас нет свободного времени для этого.",
  whenWouldYouLikeToCome: "Когда вам удобно прийти?",
  youAreBookedPrefix: "Вы записаны: ",
  hereIsWhatIsStillFree: "Вот что ещё свободно.",

  bookingUnavailable: "Бронирование сейчас недоступно.",
  slotTaken: "Извините, это время только что заняли.",
  tooManyBookingAttempts: "Слишком много попыток бронирования. Подождите немного и попробуйте снова.",
};
