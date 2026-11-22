import { InlineKeyboard } from 'grammy';
import { MyContext } from '../types/context.js';

export interface PaginatedResult<T> {
  pageItems: T[];
  page: number;
  totalPages: number;
}

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
  if (isNaN(page) || page < 0) page = 0;
  if (page >= totalPages) page = totalPages - 1;

  ctx.session.meta[pageKey] = page;

  return {
    pageItems: pages[page],
    page,
    totalPages,
  };
}

export function appendPaginationButtons(
  keyboard: InlineKeyboard,
  page: number,
  totalPages: number,
  prefix: string = 'page'
): void {
  if (totalPages <= 1) return;

  if (page > 0) {
    keyboard.text('⬅️', `${prefix}:${page - 1}`);
  } else {
    keyboard.text('·', 'noop');
  }

  keyboard.text(`${page + 1} / ${totalPages}`, 'noop');

  if (page < totalPages - 1) {
    keyboard.text('➡️', `${prefix}:${page + 1}`);
  } else {
    keyboard.text('·', 'noop');
  }
  keyboard.row();
}

