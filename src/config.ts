import { resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

/**
 * Читает обязательную переменную окружения из `process.env` или возвращает `fallback`.
 */
function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`[config] Отсутствует переменная окружения: ${name}`);
  }
  return value;
}

/**
 * Разворачивает символ `~` в домашнюю директорию и преобразует относительный путь в абсолютный.
 */
function resolvePath(raw: string): string {
  let expanded = raw;

  if (expanded === '~') {
    expanded = homedir();
  } else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = resolve(homedir(), expanded.slice(2));
  }

  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

/**
 * Преобразует абсолютный файловый путь в `file://` URL.
 */
function toFileUrl(absolutePath: string): string {
  return pathToFileURL(absolutePath).href;
}

/**
 * Глобальная конфигурация приложения, загружаемая из переменных окружения (`.env`).
 */
export const config = {
  db: {
    path: resolvePath(required('DB_PATH', './storage.db')),
    get url() {
      return toFileUrl(this.path);
    },
  },

  googleSheets: {
    credentialsPath: required('CREDENTIALS_PATH', './credentials.json'),
    spreadsheetId: required('SPREADSHEET_ID'),
  },

  botToken: required('BOT_TOKEN'),

  /** Базовая задержка между массовыми запросами к Telegram API (мс). */
  delayMs: 100,

  /** Максимальное время жизни активного меню до очистки (12 часов). */
  maxMessageAgeMs: 12 * 60 * 60 * 1000,

  /** Интервал фоновой проверки дедлайнов этапов (1 минута). */
  checkInterval: 60 * 1000,

  /** За сколько часов до промежуточного дедлайна отправлять напоминание (по умолчанию 6 часов). */
  checkpointReminderHours: Number(process.env.CHECKPOINT_REMINDER_HOURS || 36),

  /** Список Telegram ID главных редакторов (администраторов). */
  chiefEditorIds: required('CHIEF_EDITOR_IDS')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')
    .map((id) => parseInt(id, 10))
    .filter((id) => !isNaN(id)),

  /** Белый список разрешённых расширений файлов решений (в нижнем регистре с точкой). */
  allowedExtensions: (process.env.ALLOWED_EXTENSIONS || '.pdf,.docx,.doc,.md,.txt,.tex')
    .split(',')
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.length > 0)
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`)),
} as const;

