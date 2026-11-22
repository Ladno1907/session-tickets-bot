import type { Transaction, Insertable, Updateable, Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { SubjectsTable, DatabaseSchema } from '../../types/database.js';

type InsertableSubject = Omit<Insertable<SubjectsTable>, 'subjectId'>;
type UpdateableSubject = Omit<Updateable<SubjectsTable>, 'subjectId'>;
type SelectableSubject = Selectable<SubjectsTable>;

export class SubjectRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): SubjectRepository {
    return new SubjectRepository(trx);
  }

  async findAll(): Promise<SelectableSubject[]> {
    return this.db
      .selectFrom('subjects')
      .selectAll()
      .execute();
  }

  async findByName(subjectName: string): Promise<SelectableSubject | null> {
    return (
      (await this.db
        .selectFrom('subjects')
        .selectAll()
        .where('subjectName', '=', subjectName)
        .executeTakeFirst()) ?? null
    );
  }

  async findByIds(subjectIds: number[]): Promise<SelectableSubject[]> {
    if (subjectIds.length === 0) return [];

    return this.db
      .selectFrom('subjects')
      .selectAll()
      .where('subjectId', 'in', subjectIds)
      .execute();
  }

  async findById(subjectId: number): Promise<SelectableSubject | null> {
    return (
      (await this.db
        .selectFrom('subjects')
        .selectAll()
        .where('subjectId', '=', subjectId)
        .executeTakeFirst()) ?? null
    );
  }

  async insert(data: InsertableSubject): Promise<void> {
    await this.db
      .insertInto('subjects')
      .values(data)
      .execute();
  }

  async update(subjectId: number, patch: UpdateableSubject): Promise<void> {
    await this.db
      .updateTable('subjects')
      .set(patch)
      .where('subjectId', '=', subjectId)
      .execute();
  }

  async remove(subjectId: number): Promise<void> {
    await this.db.deleteFrom('subjects').where('subjectId', '=', subjectId).execute();
  }

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
