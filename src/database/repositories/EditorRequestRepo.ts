import type { Transaction, Insertable, Updateable, Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { EditorRequestsTable, DatabaseSchema } from '../../types/database.js';

type InsertableEditorRequest = Insertable<EditorRequestsTable>;
type UpdateableEditorRequest = Updateable<EditorRequestsTable>;
type SelectableEditorRequest = Selectable<EditorRequestsTable>;

export class EditorRequestRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): EditorRequestRepository {
    return new EditorRequestRepository(trx);
  }

  async removeAllByUserIdAndSubjectIds(telegramId: number, subjectIds: number[]): Promise<void> {
    if (subjectIds.length === 0) return;

    await this.db
      .deleteFrom('editor_requests')
      .where('telegramId', '=', telegramId)
      .where('subjectId', 'in', subjectIds)
      .execute();
  }

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

  async findByUserId(telegramId: number): Promise<SelectableEditorRequest[]> {
    return this.db
      .selectFrom('editor_requests')
      .selectAll()
      .where('telegramId', '=', telegramId)
      .execute();
  }

  async findBySubjectId(subjectId: number): Promise<SelectableEditorRequest[]> {
    return this.db
      .selectFrom('editor_requests')
      .selectAll()
      .where('subjectId', '=', subjectId)
      .execute();
  }

  async findAll(): Promise<SelectableEditorRequest[]> {
    return this.db
      .selectFrom('editor_requests')
      .selectAll()
      .execute();
  }

  async insert(data: InsertableEditorRequest): Promise<void> {
    await this.db
      .insertInto('editor_requests')
      .values(data)
      .execute();
  }

  async remove(telegramId: number, subjectId: number): Promise<void> {
    await this.db
      .deleteFrom('editor_requests')
      .where('telegramId', '=', telegramId)
      .where('subjectId', '=', subjectId)
      .execute();
  }
}

export const editorRequestRepository = new EditorRequestRepository();