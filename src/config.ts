import { resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`[config] Отсутствует переменная окружения: ${name}`);
  }
  return value;
}

function resolvePath(raw: string): string {
  let expanded = raw;

  if (expanded === '~') {
    expanded = homedir();
  } else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = resolve(homedir(), expanded.slice(2));
  }

  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

function toFileUrl(absolutePath: string): string {
  return pathToFileURL(absolutePath).href;
}

export const config = {
  db: {
    path: resolvePath(required('DB_PATH', './storage.db')),
    get url() {
      return toFileUrl(this.path);
    },
  },

  googleSheets: {
    credentialsPath: required('CREDENTIALS_PATH', "./credentials.json"),
    spreadsheetId: required('SPREADSHEET_ID'),
  },

  botToken: required('BOT_TOKEN'),

  delayMs: 100,
  maxMessageAgeMs: 12 * 60 * 60 * 1000,
  checkInterval: 60 * 1000,

  chiefEditorIds: required('CHIEF_EDITOR_IDS')
    .split(',')
    .map(id => id.trim())
    .filter(id => id !== '')
    .map(id => parseInt(id, 10))
    .filter(id => !isNaN(id)),

} as const;
