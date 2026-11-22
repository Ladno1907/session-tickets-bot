import { Kysely, SqliteDialect, CamelCasePlugin } from 'kysely';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { DatabaseSchema } from '../types/database.js';

const sqlite = new Database(config.db.path);

const dialect = new SqliteDialect({
  database: sqlite,
});

export const db = new Kysely<DatabaseSchema>({
  dialect,
  plugins: [new CamelCasePlugin()]
});