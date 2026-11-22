import type { Transaction, Insertable, Updateable, Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { EditorsForSubjectTable, DatabaseSchema } from '../../types/database.js';

type InsertableEditor = Insertable<EditorsForSubjectTable>;
type UpdateableEditor = Updateable<EditorsForSubjectTable>;
type SelectableEditor = Selectable<EditorsForSubjectTable>;

/**
 * Репозиторий для управления привязками редакторов к предметам (`editors_for_subjects`).
 */
export class EditorRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): EditorRepository {
    return new EditorRepository(trx);
  }

  // =========================================================================
  // ЧТЕНИЕ ДАННЫХ (SELECT)
  // =========================================================================

  /**
   * Найти запись о редакторстве пользователя по конкретному предмету.
   */
  async findByUserAndSubject(telegramId: number, subjectId: number): Promise<SelectableEditor | null> {
    return (
      (await this.db
        .selectFrom('editors_for_subjects')
        .selectAll()
        .where('telegramId', '=', telegramId)
        .where('subjectId', '=', subjectId)
        .executeTakeFirst()) ?? null
    );
  }

  /**
   * Получить все предметы, закреплённые за конкретным редактором.
   */
  async findByUserId(telegramId: number): Promise<SelectableEditor[]> {
    return this.db
      .selectFrom('editors_for_subjects')
      .selectAll()
      .where('telegramId', '=', telegramId)
      .execute();
  }

  /**
   * Получить всех редакторов, закреплённых за конкретным предметом.
   */
  async findBySubjectId(subjectId: number): Promise<SelectableEditor[]> {
    return this.db
      .selectFrom('editors_for_subjects')
      .selectAll()
      .where('subjectId', '=', subjectId)
      .execute();
  }

  /**
   * Получить список активных редакторов предмета с их именами (для распределения билетов).
   */
  async findActiveEditorsWithNamesBySubjectId(subjectId: number): Promise<{ telegramId: number; userName: string }[]> {
    return this.db
      .selectFrom('editors_for_subjects')
      .innerJoin('users', 'users.telegramId', 'editors_for_subjects.telegramId')
      .select(['users.telegramId', 'users.userName'])
      .where('editors_for_subjects.subjectId', '=', subjectId)
      .where('users.editor', '=', 1)
      .orderBy('users.telegramId', 'asc')
      .execute();
  }

  // =========================================================================
  // ЗАПИСЬ И ОБНОВЛЕНИЕ (INSERT / UPDATE)
  // =========================================================================

  /**
   * Назначить пользователя редактором по предмету.
   */
  async insert(data: InsertableEditor): Promise<void> {
    await this.db
      .insertInto('editors_for_subjects')
      .values(data)
      .execute();
  }

  /**
   * Обновить запись о редакторстве по пользователю и предмету.
   */
  async update(telegramId: number, subjectId: number, patch: UpdateableEditor): Promise<void> {
    await this.db
      .updateTable('editors_for_subjects')
      .set(patch)
      .where('telegramId', '=', telegramId)
      .where('subjectId', '=', subjectId)
      .execute();
  }

  // =========================================================================
  // УДАЛЕНИЕ (DELETE)
  // =========================================================================

  /**
   * Снять пользователя с роли редактора по конкретному предмету.
   */
  async remove(telegramId: number, subjectId: number): Promise<void> {
    await this.db
      .deleteFrom('editors_for_subjects')
      .where('telegramId', '=', telegramId)
      .where('subjectId', '=', subjectId)
      .execute();
  }
}

export const editorRepository = new EditorRepository();

