import type { Transaction, Insertable, Updateable, Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { UserMainMenuStateTable, DatabaseSchema } from '../../types/database.js';

type InsertableMainMenuState = Insertable<UserMainMenuStateTable>;
type UpdateableMainMenuState = Updateable<UserMainMenuStateTable>;
type SelectableMainMenuState = Selectable<UserMainMenuStateTable>;

/**
 * Репозиторий отслеживания ID активного интерактивного сообщения меню в чатах (`user_main_menu_states`).
 */
export class UserMainMenuStateRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): UserMainMenuStateRepository {
    return new UserMainMenuStateRepository(trx);
  }

  // =========================================================================
  // ЧТЕНИЕ ДАННЫХ (SELECT)
  // =========================================================================

  /**
   * Получить все записи активных меню пользователей.
   */
  async findAll(): Promise<SelectableMainMenuState[]> {
    return this.db
      .selectFrom('user_main_menu_states')
      .selectAll()
      .execute();
  }

  /**
   * Найти состояние главного меню конкретного пользователя.
   */
  async findByUserId(telegramId: number): Promise<SelectableMainMenuState | null> {
    return (
      (await this.db
        .selectFrom('user_main_menu_states')
        .selectAll()
        .where('telegramId', '=', telegramId)
        .executeTakeFirst()) ?? null
    );
  }

  /**
   * Найти записи меню, не обновлявшиеся до указанной даты (ISO-строка).
   */
  async findOlderThan(cutoffDateStr: string): Promise<SelectableMainMenuState[]> {
    return this.db
      .selectFrom('user_main_menu_states')
      .selectAll()
      .where('lastUpdated', '<', cutoffDateStr)
      .execute();
  }

  /**
   * Найти «осиротевшие» записи меню, для которых пользователь уже удалён из таблицы `users`.
   */
  async findOrphaned(): Promise<SelectableMainMenuState[]> {
    return this.db
      .selectFrom('user_main_menu_states')
      .selectAll()
      .where((eb) =>
        eb.not(
          eb.exists(
            eb.selectFrom('users')
              .select('users.telegramId')
              .whereRef('users.telegramId', '=', 'user_main_menu_states.telegramId')
          )
        )
      )
      .execute();
  }

  // =========================================================================
  // ЗАПИСЬ И ОБНОВЛЕНИЕ (INSERT / UPDATE)
  // =========================================================================

  /**
   * Сохранить ID нового сообщения меню для пользователя.
   */
  async insert(data: InsertableMainMenuState): Promise<void> {
    await this.db
      .insertInto('user_main_menu_states')
      .values(data)
      .execute();
  }

  /**
   * Обновить запись состояния меню пользователя (например, время `lastUpdated`).
   */
  async updateByUserId(telegramId: number, patch: UpdateableMainMenuState): Promise<void> {
    await this.db
      .updateTable('user_main_menu_states')
      .set(patch)
      .where('telegramId', '=', telegramId)
      .execute();
  }

  // =========================================================================
  // УДАЛЕНИЕ (DELETE)
  // =========================================================================

  /**
   * Удалить запись состояния меню пользователя по Telegram ID.
   */
  async removeByUserId(telegramId: number): Promise<void> {
    await this.db
      .deleteFrom('user_main_menu_states')
      .where('telegramId', '=', telegramId)
      .execute();
  }

  /**
   * Удалить все «осиротевшие» записи меню без привязки к существующим пользователям.
   */
  async removeOrphaned(): Promise<void> {
    await this.db
      .deleteFrom('user_main_menu_states')
      .where('telegramId', 'not in', (qb) => qb.selectFrom('users').select('telegramId'))
      .execute();
  }

  /**
   * Удалить все записи меню старше указанной даты (ISO-строка).
   */
  async removeOlderThan(cutoffDateStr: string): Promise<void> {
    await this.db
      .deleteFrom('user_main_menu_states')
      .where('lastUpdated', '<', cutoffDateStr)
      .execute();
  }
}

export const userMainMenuStateRepository = new UserMainMenuStateRepository();

