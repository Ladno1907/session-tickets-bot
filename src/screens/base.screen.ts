import { InlineKeyboard } from 'grammy';
import { MyContext } from '../types/context.js';

/**
 * Результат отрисовки экрана, передаваемый в {@link MessageManager} для отображения в чате.
 */
export interface RenderResult {
  /** Текст сообщения (или подпись к документу, если указан `documentPath`). */
  text: string;
  /** Инлайн-клавиатура под сообщением. */
  reply_markup?: InlineKeyboard;
  /** Режим отображения: обновление главного меню или отдельное сообщение. */
  displayType: 'main_menu' | 'ticket';
  /** Принудительно удалить старое меню и отправить новое сообщение вниз чата. */
  forceNew?: boolean;
  /** Не удалять входящее сообщение пользователя после обработки. */
  keepUserMessage?: boolean;
  /** Абсолютный путь к локальному файлу для отправки документом с `caption`. */
  documentPath?: string;
}

/**
 * Базовый интерфейс всех интерактивных экранов бота (паттерн State / Screen).
 */
export interface BaseScreen {
  /** Уникальный строковый идентификатор экрана (должен совпадать с ключом в {@link ScreenFactory}). */
  readonly id: string;

  /** Формирует текст и клавиатуру экрана для отображения пользователю. */
  render(ctx: MyContext, notice?: string): Promise<RenderResult> | RenderResult;

  /** Обрабатывает входящее сообщение или нажатие инлайн-кнопки и возвращает следующий экран (или `null`). */
  handle(ctx: MyContext): Promise<BaseScreen | null>;
}

