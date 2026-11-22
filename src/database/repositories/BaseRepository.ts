import type { Kysely, Transaction } from 'kysely';
import type { DatabaseSchema } from '../../types/database.js';
import { db as defaultDb } from '../client.js';

/** Экземпляр подключения Kysely или активная транзакция БД. */
export type DbOrTrx = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

/**
 * Базовый абстрактный класс для всех SQLite-репозиториев с поддержкой транзакций.
 */
export abstract class BaseRepository {
  constructor(public db: DbOrTrx = defaultDb) {}

  /**
   * Возвращает новый экземпляр репозитория, привязанный к переданной транзакции `trx`.
   */
  abstract withTransaction(trx: Transaction<DatabaseSchema>): BaseRepository;
}

