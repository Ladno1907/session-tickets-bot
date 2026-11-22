import type { Transaction, Insertable, Updateable, Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { RegistrationsForSubjectTable, DatabaseSchema } from '../../types/database.js';

type InsertableRegistration = Insertable<RegistrationsForSubjectTable>;
type UpdateableRegistration = Updateable<RegistrationsForSubjectTable>;
type SelectableRegistration = Selectable<RegistrationsForSubjectTable>;

/**
 * Репозиторий записей студентов на учебные предметы (`registrations_for_subjects`).
 */
export class RegistrationRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): RegistrationRepository {
    return new RegistrationRepository(trx);
  }

  // =========================================================================
  // ЧТЕНИЕ И СТАТИСТИКА (SELECT)
  // =========================================================================

  /**
   * Найти запись о регистрации студента на конкретный предмет.
   */
  async findByUserAndSubject(telegramId: number, subjectId: number): Promise<SelectableRegistration | null> {
    return (
      (await this.db
        .selectFrom('registrations_for_subjects')
        .selectAll()
        .where('telegramId', '=', telegramId)
        .where('subjectId', '=', subjectId)
        .executeTakeFirst()) ?? null
    );
  }

  /**
   * Получить все предметы, на которые записан студент.
   */
  async findByUserId(telegramId: number): Promise<SelectableRegistration[]> {
    return this.db
      .selectFrom('registrations_for_subjects')
      .selectAll()
      .where('telegramId', '=', telegramId)
      .execute();
  }

  /**
   * Получить все записи регистраций по конкретному предмету.
   */
  async findBySubjectId(subjectId: number): Promise<SelectableRegistration[]> {
    return this.db
      .selectFrom('registrations_for_subjects')
      .selectAll()
      .where('subjectId', '=', subjectId)
      .execute();
  }

  /**
   * Получить список пользователей (ID и ФИО), записанных на конкретный предмет.
   */
  async findUsersBySubjectId(subjectId: number): Promise<{ telegramId: number; userName: string }[]> {
    return this.db
      .selectFrom('registrations_for_subjects')
      .innerJoin('users', 'users.telegramId', 'registrations_for_subjects.telegramId')
      .select(['users.telegramId', 'users.userName'])
      .where('registrations_for_subjects.subjectId', '=', subjectId)
      .execute();
  }

  /**
   * Получить активных студентов предмета (`student = 1`), отсортированных по дате регистрации (для алгоритма «змейки»).
   */
  async findActiveStudentsBySubjectId(subjectId: number): Promise<{ telegramId: number }[]> {
    return this.db
      .selectFrom('registrations_for_subjects')
      .innerJoin('users', 'users.telegramId', 'registrations_for_subjects.telegramId')
      .select(['users.telegramId'])
      .where('registrations_for_subjects.subjectId', '=', subjectId)
      .where('users.student', '=', 1)
      .orderBy('users.registeredAt', 'asc')
      .execute();
  }

  /**
   * Подсчитать количество записавшихся студентов в разрезе каждого предмета.
   */
  async countStudentsGroupBySubject(): Promise<{ subjectId: number; count: number }[]> {
    const rows = await this.db
      .selectFrom('registrations_for_subjects')
      .select(['subjectId', (eb) => eb.fn.count<number>('telegramId').as('count')])
      .groupBy('subjectId')
      .execute();

    return rows.map((r) => ({
      subjectId: r.subjectId,
      count: Number(r.count ?? 0),
    }));
  }

  // =========================================================================
  // ЗАПИСЬ И ОБНОВЛЕНИЕ (INSERT / UPDATE)
  // =========================================================================

  /**
   * Записать студента на предмет.
   */
  async insert(data: InsertableRegistration): Promise<void> {
    await this.db
      .insertInto('registrations_for_subjects')
      .values(data)
      .execute();
  }

  /**
   * Обновить запись регистрации студента на предмет.
   */
  async update(telegramId: number, subjectId: number, patch: UpdateableRegistration): Promise<void> {
    await this.db
      .updateTable('registrations_for_subjects')
      .set(patch)
      .where('telegramId', '=', telegramId)
      .where('subjectId', '=', subjectId)
      .execute();
  }

  // =========================================================================
  // УДАЛЕНИЕ (DELETE)
  // =========================================================================

  /**
   * Удалить запись студента с конкретного предмета.
   */
  async remove(telegramId: number, subjectId: number): Promise<void> {
    await this.db
      .deleteFrom('registrations_for_subjects')
      .where('telegramId', '=', telegramId)
      .where('subjectId', '=', subjectId)
      .execute();
  }

  /**
   * Пакетно удалить записи студента по списку предметов.
   */
  async removeAllByUserIdAndSubjectIds(telegramId: number, subjectIds: number[]): Promise<void> {
    if (subjectIds.length === 0) return;

    await this.db
      .deleteFrom('registrations_for_subjects')
      .where('telegramId', '=', telegramId)
      .where('subjectId', 'in', subjectIds)
      .execute();
  }
}

export const registrationRepository = new RegistrationRepository();

