import { Kysely, SqliteDialect, CamelCasePlugin } from 'kysely';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { DatabaseSchema } from '../types/database.js';

const sqlite = new Database(config.db.path);

const dialect = new SqliteDialect({
  database: sqlite,
});

/**
 * Глобальный экземпляр query-builder Kysely с автоматическим маппингом `snake_case <-> camelCase`.
 */
export const db = new Kysely<DatabaseSchema>({
  dialect,
  plugins: [new CamelCasePlugin()],
});

