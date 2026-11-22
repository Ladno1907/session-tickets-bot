import type { Transaction, Insertable, Updateable, Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { TicketsTable, DatabaseSchema } from '../../types/database.js';
import { TicketStatus } from '../../types/entities.js';
import { sql } from 'kysely';

type InsertableTicket = Omit<Insertable<TicketsTable>, 'ticketId'>;
type UpdateableTicket = Omit<Updateable<TicketsTable>, 'ticketId' | 'subjectId'>;
type SelectableTicket = Selectable<TicketsTable>;

export class TicketRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): TicketRepository {
    return new TicketRepository(trx);
  }

  async countGroupBySubject(): Promise<{ subjectId: number; count: number }[]> {
    const rows = await this.db
      .selectFrom('tickets')
      .select([
        'subjectId',
        (eb) => eb.fn.count<number>('ticketId').as('count')
      ])
      .groupBy('subjectId')
      .execute();

    return rows.map(r => ({
      subjectId: r.subjectId,
      count: Number(r.count ?? 0)
    }));
  }

  async findBySubjectAndNumber(subjectId: number, ticketNumber: number): Promise<SelectableTicket | null> {
    return (
      (await this.db
        .selectFrom('tickets')
        .selectAll()
        .where('subjectId', '=', subjectId)
        .where('ticketNumber', '=', ticketNumber)
        .executeTakeFirst()) ?? null
    );
  }

  async assignTicketToStudent(ticketId: number, studentId: number): Promise<void> {
    await this.db
      .updateTable('tickets')
      .set({
        studentId: studentId,
        status: TicketStatus.IN_PROGRESS,
        updatedAt: new Date().toISOString()
      })
      .where('ticketId', '=', ticketId)
      .execute();
  }

  async assignTicketToEditor(ticketId: number, editorId: number): Promise<void> {
    await this.db
      .updateTable('tickets')
      .set({ editorId: editorId })
      .where('ticketId', '=', ticketId)
      .execute();
  }

  async findBySubjectIdSorted(subjectId: number): Promise<SelectableTicket[]> {
    return await this.db
      .selectFrom('tickets')
      .selectAll()
      .where('subjectId', '=', subjectId)
      .orderBy('ticketNumber', 'asc')
      .execute();
  }

  async findByTicketIdAndEditorId(ticketId: number, editorId: number): Promise<SelectableTicket | null> {
    return (
      (await this.db
        .selectFrom('tickets')
        .selectAll()
        .where('ticketId', '=', ticketId)
        .where('editorId', '=', editorId)
        .executeTakeFirst()) ?? null
    );
  }

  async findById(ticketId: number): Promise<SelectableTicket | null> {
    return (
      (await this.db
        .selectFrom('tickets')
        .selectAll()
        .where('ticketId', '=', ticketId)
        .executeTakeFirst()) ?? null
    );
  }

  async insert(data: InsertableTicket): Promise<void> {
    await this.db
      .insertInto('tickets')
      .values(data)
      .execute();
  }

  async update(ticketId: number, patch: UpdateableTicket): Promise<void> {
    await this.db
      .updateTable('tickets')
      .set(patch)
      .where('ticketId', '=', ticketId)
      .execute();
  }

  async remove(ticketId: number): Promise<void> {
    await this.db.deleteFrom('tickets').where('ticketId', '=', ticketId).execute();
  }

  async removeTicketsExceedingNumber(subjectId: number, maxTicketNumber: number): Promise<void> {
    await this.db
      .deleteFrom('tickets')
      .where('subjectId', '=', subjectId)
      .where('ticketNumber', '>', maxTicketNumber)
      .execute();
  }

  async clearStudentAssignmentsBySubject(subjectId: number): Promise<void> {
    await this.db
      .updateTable('tickets')
      .set({
        studentId: sql`NULL`,
        status: sql`NULL`
      })
      .where('subjectId', '=', subjectId)
      .execute();
  }

  async clearEditorAssignmentsBySubject(subjectId: number): Promise<void> {
    await this.db
      .updateTable('tickets')
      .set({
        editorId: sql`NULL`
      })
      .where('subjectId', '=', subjectId)
      .execute();
  }
}

export const ticketRepository = new TicketRepository();
