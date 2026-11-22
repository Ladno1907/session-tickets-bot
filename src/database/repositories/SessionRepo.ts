import type { Transaction, Insertable, Updateable, Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { SessionsTable, DatabaseSchema } from '../../types/database.js';

type InsertableSession = Insertable<SessionsTable>;
type UpdateableSession = Updateable<SessionsTable>;
type SelectableSession = Selectable<SessionsTable>;

/**
 * Репозиторий хранения пользовательских сессий grammY в SQLite (`sessions`).
 */
export class SessionRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): SessionRepository {
    return new SessionRepository(trx);
  }

  // =========================================================================
  // ЧТЕНИЕ ДАННЫХ (SELECT)
  // =========================================================================

  /**
   * Найти сериализованную сессию пользователя по его Telegram ID.
   */
  async findById(telegramId: number): Promise<SelectableSession | null> {
    return (
      (await this.db
        .selectFrom('sessions')
        .selectAll()
        .where('telegramId', '=', telegramId)
        .executeTakeFirst()) ?? null
    );
  }

  // =========================================================================
  // ЗАПИСЬ И ОБНОВЛЕНИЕ (UPSERT)
  // =========================================================================

  /**
   * Создать или перезаписать данные сессии пользователя (upsert).
   */
  async upsert(telegramId: number, sessionData: string): Promise<void> {
    const nowIso = new Date().toISOString();

    await this.db
      .insertInto('sessions')
      .values({
        telegramId,
        sessionData,
        updatedAt: nowIso,
      })
      .onConflict((oc) =>
        oc.column('telegramId').doUpdateSet({
          sessionData,
          updatedAt: nowIso,
        })
      )
      .execute();
  }

  // =========================================================================
  // УДАЛЕНИЕ (DELETE)
  // =========================================================================

  /**
   * Удалить сессию пользователя по его Telegram ID.
   */
  async deleteById(telegramId: number): Promise<void> {
    await this.db
      .deleteFrom('sessions')
      .where('telegramId', '=', telegramId)
      .execute();
  }

  /**
   * Удалить все сессии, не обновлявшиеся до указанной даты (ISO-строка).
   */
  async deleteOlderThan(cutoffDateStr: string): Promise<void> {
    await this.db
      .deleteFrom('sessions')
      .where('updatedAt', '<', cutoffDateStr)
      .execute();
  }
}

export const sessionRepository = new SessionRepository();

