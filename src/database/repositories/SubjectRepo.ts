import type { Transaction, Insertable, Updateable, Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { SubjectsTable, DatabaseSchema } from '../../types/database.js';

type InsertableSubject = Omit<Insertable<SubjectsTable>, 'subjectId'>;
type UpdateableSubject = Omit<Updateable<SubjectsTable>, 'subjectId'>;
type SelectableSubject = Selectable<SubjectsTable>;

/**
 * Репозиторий учебных дисциплин (`subjects`).
 */
export class SubjectRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): SubjectRepository {
    return new SubjectRepository(trx);
  }

  // =========================================================================
  // ЧТЕНИЕ ДАННЫХ (SELECT)
  // =========================================================================

  /**
   * Получить полный список предметов.
   */
  async findAll(): Promise<SelectableSubject[]> {
    return this.db
      .selectFrom('subjects')
      .selectAll()
      .execute();
  }

  /**
   * Найти предмет по его внутреннему ID.
   */
  async findById(subjectId: number): Promise<SelectableSubject | null> {
    return (
      (await this.db
        .selectFrom('subjects')
        .selectAll()
        .where('subjectId', '=', subjectId)
        .executeTakeFirst()) ?? null
    );
  }

  /**
   * Найти предмет по точному названию (совпадающему с именем листа в Google Sheets).
   */
  async findByName(subjectName: string): Promise<SelectableSubject | null> {
    return (
      (await this.db
        .selectFrom('subjects')
        .selectAll()
        .where('subjectName', '=', subjectName)
        .executeTakeFirst()) ?? null
    );
  }

  /**
   * Получить список предметов по массиву их ID.
   */
  async findByIds(subjectIds: number[]): Promise<SelectableSubject[]> {
    if (subjectIds.length === 0) return [];

    return this.db
      .selectFrom('subjects')
      .selectAll()
      .where('subjectId', 'in', subjectIds)
      .execute();
  }

  // =========================================================================
  // ЗАПИСЬ И ОБНОВЛЕНИЕ (INSERT / UPDATE)
  // =========================================================================

  /**
   * Добавить новый предмет.
   */
  async insert(data: InsertableSubject): Promise<void> {
    await this.db
      .insertInto('subjects')
      .values(data)
      .execute();
  }

  /**
   * Обновить данные предмета по его ID.
   */
  async update(subjectId: number, patch: UpdateableSubject): Promise<void> {
    await this.db
      .updateTable('subjects')
      .set(patch)
      .where('subjectId', '=', subjectId)
      .execute();
  }

  // =========================================================================
  // УДАЛЕНИЕ (DELETE)
  // =========================================================================

  /**
   * Удалить предмет по ID (без ручной очистки связанных таблиц).
   */
  async remove(subjectId: number): Promise<void> {
    await this.db
      .deleteFrom('subjects')
      .where('subjectId', '=', subjectId)
      .execute();
  }

  /**
   * Полностью удалить предмет вместе со всеми регистрациями, редакторами, заявками и билетами.
   */
  async removeSubjectCompletely(subjectId: number): Promise<void> {
    await this.db
      .deleteFrom('registrations_for_subjects')
      .where('subjectId', '=', subjectId)
      .execute();

    await this.db
      .deleteFrom('editors_for_subjects')
      .where('subjectId', '=', subjectId)
      .execute();

    await this.db
      .deleteFrom('editor_requests')
      .where('subjectId', '=', subjectId)
      .execute();

    await this.db
      .deleteFrom('tickets')
      .where('subjectId', '=', subjectId)
      .execute();

    await this.db
      .deleteFrom('subjects')
      .where('subjectId', '=', subjectId)
      .execute();
  }
}

export const subjectRepository = new SubjectRepository();

