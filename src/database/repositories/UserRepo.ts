import type { Transaction, Insertable, Updateable, Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { UsersTable, DatabaseSchema } from '../../types/database.js';

type InsertableUser = Insertable<UsersTable>;
type UpdateableUser = Updateable<UsersTable>;
type SelectableUser = Selectable<UsersTable>;

export class UserRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): UserRepository {
    return new UserRepository(trx);
  }

  async findAll(): Promise<SelectableUser[]> {
    return this.db.selectFrom('users').selectAll().execute();
  }

  async findByIds(telegramIds: number[]): Promise<SelectableUser[]> {
    if (telegramIds.length === 0) return [];

    return this.db
      .selectFrom('users')
      .selectAll()
      .where('telegramId', 'in', telegramIds)
      .execute();
  }

  async findById(telegramId: number): Promise<SelectableUser | null> {
    return (
      (await this.db
        .selectFrom('users')
        .selectAll()
        .where('telegramId', '=', telegramId)
        .executeTakeFirst()) ?? null
    );
  }

  async countActiveStudents(): Promise<number> {
    const res = await this.db
      .selectFrom('users')
      .select((eb) => eb.fn.count<number>('telegramId').as('count'))
      .where('student', '=', 1)
      .executeTakeFirst();
    return Number(res?.count ?? 0);
  }

  async countActiveEditors(): Promise<number> {
    const res = await this.db
      .selectFrom('users')
      .select((eb) => eb.fn.count<number>('telegramId').as('count'))
      .where('editor', '=', 1)
      .executeTakeFirst();
    return Number(res?.count ?? 0);
  }

  async findDeadUsers(): Promise<SelectableUser[]> {
    return await this.db
      .selectFrom('users')
      .selectAll()
      .where('chiefEditor', '=', 0)
      .where('editor', '=', 0)
      .where((eb) => eb.not(
        eb.exists(
          eb.selectFrom('tickets')
            .select('tickets.ticketId')
            .whereRef('tickets.studentId', '=', 'users.telegramId')
        )
      ))
      .execute();
  }

  async insert(data: InsertableUser): Promise<void> {
    await this.db
      .insertInto('users')
      .values(data)
      .executeTakeFirstOrThrow();
  }

  async update(telegramId: number, patch: UpdateableUser): Promise<void> {
    await this.db
      .updateTable('users')
      .set(patch)
      .where('telegramId', '=', telegramId)
      .execute();
  }

  async remove(telegramId: number): Promise<void> {
    await this.db.deleteFrom('users').where('telegramId', '=', telegramId).execute();
  }

  async updateAll(whereClause: Partial<SelectableUser>, patch: UpdateableUser): Promise<void> {
    let query = this.db.updateTable('users').set(patch);

    for (const [key, value] of Object.entries(whereClause)) {
      query = query.where(key as any, '=', value);
    }

    await query.execute();
  }

  async updateByIds(telegramIds: number[], patch: UpdateableUser): Promise<void> {
    if (telegramIds.length === 0) return;

    await this.db
      .updateTable('users')
      .set(patch)
      .where('telegramId', 'in', telegramIds)
      .execute();
  }
}

export const userRepository = new UserRepository();
