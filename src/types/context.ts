import { Api, Context, SessionFlavor } from 'grammy';
import { FileApiFlavor, FileFlavor } from '@grammyjs/files';

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
export type MyContext = FileFlavor<Context & SessionFlavor<BotSessionData>>;
export type MyApi = FileApiFlavor<Api>;
