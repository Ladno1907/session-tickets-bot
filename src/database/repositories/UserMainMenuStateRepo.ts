// src/database/repositories/UserMainMenuStateRepo.ts
import type { Transaction, Insertable, Updateable, Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { UserMainMenuStateTable, DatabaseSchema } from '../../types/database.js';

type InsertableMainMenuState = Insertable<UserMainMenuStateTable>;
type UpdateableMainMenuState = Updateable<UserMainMenuStateTable>;
type SelectableMainMenuState = Selectable<UserMainMenuStateTable>;

export class UserMainMenuStateRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): UserMainMenuStateRepository {
    return new UserMainMenuStateRepository(trx);
  }

  async findAll(): Promise<SelectableMainMenuState[]> {
    return this.db
      .selectFrom('user_main_menu_states')
      .selectAll()
      .execute();
  }

  async findByUserId(telegramId: number): Promise<SelectableMainMenuState | null> {
    return (
      (await this.db
        .selectFrom('user_main_menu_states')
        .selectAll()
        .where('telegramId', '=', telegramId)
        .executeTakeFirst()) ?? null
    );
  }

  async findOlderThan(cutoffDateStr: string): Promise<SelectableMainMenuState[]> {
    return this.db
      .selectFrom('user_main_menu_states')
      .selectAll()
      .where('lastUpdated', '<', cutoffDateStr)
      .execute();
  }

   async findOrphaned(): Promise<SelectableMainMenuState[]> {
    return this.db
      .selectFrom('user_main_menu_states')
      .selectAll()
      .where((eb) => eb.not(
        eb.exists(
          eb.selectFrom('users')
            .select('users.telegramId')
            .whereRef('users.telegramId', '=', 'user_main_menu_states.telegramId')
        )
      ))
      .execute();
  }

  async insert(data: InsertableMainMenuState): Promise<void> {
    await this.db
      .insertInto('user_main_menu_states')
      .values(data)
      .execute();
  }

  async updateByUserId(telegramId: number, patch: UpdateableMainMenuState): Promise<void> {
    await this.db
      .updateTable('user_main_menu_states')
      .set(patch)
      .where('telegramId', '=', telegramId)
      .execute();
  }

  async removeByUserId(telegramId: number): Promise<void> {
    await this.db
      .deleteFrom('user_main_menu_states')
      .where('telegramId', '=', telegramId)
      .execute();
  }

  async removeOrphaned(): Promise<void> {
    await this.db
      .deleteFrom('user_main_menu_states')
      .where('telegramId', 'not in', qb => qb.selectFrom('users').select('telegramId'))
      .execute();
  }

  async removeOlderThan(cutoffDateStr: string): Promise<void> {
    await this.db
      .deleteFrom('user_main_menu_states')
      .where('lastUpdated', '<', cutoffDateStr)
      .execute();
  }
}

export const userMainMenuStateRepository = new UserMainMenuStateRepository();
