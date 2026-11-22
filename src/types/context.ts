import { Context, SessionFlavor } from 'grammy';

/**
 * Структура пользовательской сессии grammY, сохраняемой в SQLite.
 */
export interface BotSessionData {
  /** Идентификатор текущего активного экрана в {@link ScreenFactory}. */
  currentScreenId: string;
  /** Временные данные текущего сценария (выбранный предмет, билет, страница пагинации, `notice`). */
  meta: Record<string, any>;
}

/** Расширенный контекст grammY с поддержкой сессий бота. */
export interface MyContext extends Context, SessionFlavor<BotSessionData> {}

