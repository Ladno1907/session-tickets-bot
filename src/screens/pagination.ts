import { InlineKeyboard } from 'grammy';
import { MyContext } from '../types/context.js';

/** Результат разбиения списка элементов на страницы. */
export interface PaginatedResult<T> {
  pageItems: T[];
  page: number;
  totalPages: number;
}

/**
 * Разбивает массив элементов на страницы с учётом двух ограничений Telegram:
 * максимального количества элементов (`maxItemsPerPage`) и максимальной суммарной длины текста (`maxCharsPerPage`).
 */
export function paginateItems<T>(
  items: T[],
  ctx: MyContext,
  pageKey: string,
  formatItem: (item: T) => string,
  maxItemsPerPage: number = 12,
  maxCharsPerPage: number = 3200
): PaginatedResult<T> {
  if (items.length === 0) {
    return { pageItems: [], page: 0, totalPages: 1 };
  }

  const pages: T[][] = [];
  let currentPage: T[] = [];
  let currentChars = 0;

  for (const item of items) {
    const itemTextLen = formatItem(item).length;
    if (
      currentPage.length > 0 &&
      (currentPage.length >= maxItemsPerPage || currentChars + itemTextLen > maxCharsPerPage)
    ) {
      pages.push(currentPage);
      currentPage = [];
      currentChars = 0;
    }
    currentPage.push(item);
    currentChars += itemTextLen;
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  const totalPages = pages.length;
  let page = Number(ctx.session.meta?.[pageKey] ?? 0);
  if (isNaN(page)) page = 0;

  // Зацикливание индекса страницы (Loop)
  page = ((page % totalPages) + totalPages) % totalPages;
  ctx.session.meta[pageKey] = page;

  return {
    pageItems: pages[page],
    page,
    totalPages,
  };
}

/**
 * Добавляет в инлайн-клавиатуру зацикленный ряд кнопок навигации (`⬅️ Пред. | 📄 1 / N | След. ➡️`),
 * если страниц больше одной.
 */
export function appendPaginationButtons(
  keyboard: InlineKeyboard,
  page: number,
  totalPages: number,
  prefix: string = 'page'
): void {
  if (totalPages <= 1) return;

  const prevPage = (page - 1 + totalPages) % totalPages;
  const nextPage = (page + 1) % totalPages;

  keyboard
    .text('⬅️ Пред.', `${prefix}:${prevPage}`)
    .text(`📄 ${page + 1} / ${totalPages}`, 'noop')
    .text('След. ➡️', `${prefix}:${nextPage}`)
    .row();
}

