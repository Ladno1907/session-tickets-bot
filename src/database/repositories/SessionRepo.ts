// src/database/repositories/SessionRepo.ts

import type { Transaction, Insertable, Updateable, Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { SessionsTable, DatabaseSchema } from '../../types/database.js';

type InsertableSession = Insertable<SessionsTable>;
type UpdateableSession = Updateable<SessionsTable>;
type SelectableSession = Selectable<SessionsTable>;

export class SessionRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): SessionRepository {
    return new SessionRepository(trx);
  }

  async findById(telegramId: number): Promise<SelectableSession | null> {
    return (
      (await this.db
        .selectFrom('sessions')
        .selectAll()
        .where('telegramId', '=', telegramId)
        .executeTakeFirst()) ?? null
    );
  }

  async upsert(telegramId: number, sessionData: string): Promise<void> {
    await this.db
      .insertInto('sessions')
      .values({
        telegramId: telegramId,
        sessionData: sessionData,
        updatedAt: new Date().toISOString(),
      })
      .onConflict((oc) => oc.column('telegramId').doUpdateSet({
        sessionData: sessionData,
        updatedAt: new Date().toISOString(),
      }))
      .execute();
  }

  async deleteById(telegramId: number): Promise<void> {
    await this.db
      .deleteFrom('sessions')
      .where('telegramId', '=', telegramId)
      .execute();
  }

  async deleteOlderThan(cutoffDateStr: string): Promise<void> {
     await this.db
      .deleteFrom('sessions')
      .where('updatedAt', '<', cutoffDateStr)
      .execute();
  }
}

export const sessionRepository = new SessionRepository();