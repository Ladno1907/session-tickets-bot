/**
 * Экранирует спецсимволы Telegram Markdown (`_`, `*`, `` ` ``, `[`) в пользовательских строках,
 * предотвращая ошибки парсинга сообщений при выводе ФИО, вопросов и комментариев.
 */
export function escapeMarkdown(text?: string | null): string {
  if (!text) return '';
  return text.replace(/([_*`\[])/g, '\\$1');
}

