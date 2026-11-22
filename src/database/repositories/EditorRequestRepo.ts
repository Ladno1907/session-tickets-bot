import type { Transaction, Insertable, Updateable, Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { EditorRequestsTable, DatabaseSchema } from '../../types/database.js';

type InsertableEditorRequest = Insertable<EditorRequestsTable>;
type UpdateableEditorRequest = Updateable<EditorRequestsTable>;
type SelectableEditorRequest = Selectable<EditorRequestsTable>;

/**
 * Репозиторий для работы с заявками пользователей на редакторство (`editor_requests`).
 */
export class EditorRequestRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): EditorRequestRepository {
    return new EditorRequestRepository(trx);
  }

  // =========================================================================
  // ЧТЕНИЕ ДАННЫХ (SELECT)
  // =========================================================================

  /**
   * Получить все заявки на редакторство в системе.
   */
  async findAll(): Promise<SelectableEditorRequest[]> {
    return this.db
      .selectFrom('editor_requests')
      .selectAll()
      .execute();
  }

  /**
   * Найти заявку конкретного пользователя на конкретный предмет.
   */
  async findByUserAndSubject(telegramId: number, subjectId: number): Promise<SelectableEditorRequest | null> {
    return (
      (await this.db
        .selectFrom('editor_requests')
        .selectAll()
        .where('telegramId', '=', telegramId)
        .where('subjectId', '=', subjectId)
        .executeTakeFirst()) ?? null
    );
  }

  /**
   * Получить все заявки, поданные конкретным пользователем.
   */
  async findByUserId(telegramId: number): Promise<SelectableEditorRequest[]> {
    return this.db
      .selectFrom('editor_requests')
      .selectAll()
      .where('telegramId', '=', telegramId)
      .execute();
  }

  /**
   * Получить все заявки, поданные на конкретный предмет.
   */
  async findBySubjectId(subjectId: number): Promise<SelectableEditorRequest[]> {
    return this.db
      .selectFrom('editor_requests')
      .selectAll()
      .where('subjectId', '=', subjectId)
      .execute();
  }

  // =========================================================================
  // ЗАПИСЬ (INSERT)
  // =========================================================================

  /**
   * Создать новую заявку на редакторство.
   */
  async insert(data: InsertableEditorRequest): Promise<void> {
    await this.db
      .insertInto('editor_requests')
      .values(data)
      .execute();
  }

  // =========================================================================
  // УДАЛЕНИЕ (DELETE)
  // =========================================================================

  /**
   * Удалить заявку пользователя по конкретному предмету.
   */
  async remove(telegramId: number, subjectId: number): Promise<void> {
    await this.db
      .deleteFrom('editor_requests')
      .where('telegramId', '=', telegramId)
      .where('subjectId', '=', subjectId)
      .execute();
  }

  /**
   * Пакетно удалить заявки пользователя по списку предметов.
   */
  async removeAllByUserIdAndSubjectIds(telegramId: number, subjectIds: number[]): Promise<void> {
    if (subjectIds.length === 0) return;

    await this.db
      .deleteFrom('editor_requests')
      .where('telegramId', '=', telegramId)
      .where('subjectId', 'in', subjectIds)
      .execute();
  }
}

export const editorRequestRepository = new EditorRequestRepository();

