export function escapeMarkdown(text?: string | null): string {
  if (!text) return '';
  return text.replace(/([_*`\[])/g, '\\$1');
}

