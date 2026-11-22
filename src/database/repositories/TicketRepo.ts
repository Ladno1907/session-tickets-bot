import { sql, type Transaction, type Insertable, type Updateable, type Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { TicketsTable, DatabaseSchema } from '../../types/database.js';
import { TicketStatus } from '../../types/entities.js';

type InsertableTicket = Omit<Insertable<TicketsTable>, 'ticketId'>;
type UpdateableTicket = Omit<Updateable<TicketsTable>, 'ticketId' | 'subjectId'>;
type SelectableTicket = Selectable<TicketsTable>;

/**
 * Репозиторий экзаменационных билетов (`tickets`).
 */
export class TicketRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): TicketRepository {
    return new TicketRepository(trx);
  }

  // =========================================================================
  // ЧТЕНИЕ И СТАТИСТИКА (SELECT)
  // =========================================================================

  /**
   * Найти билет по его уникальному ID.
   */
  async findById(ticketId: number): Promise<SelectableTicket | null> {
    return (
      (await this.db
        .selectFrom('tickets')
        .selectAll()
        .where('ticketId', '=', ticketId)
        .executeTakeFirst()) ?? null
    );
  }

  /**
   * Найти билет по ID предмета и порядковому номеру билета.
   */
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

  /**
   * Найти билет по ID билета и ID проверяющего редактора (проверка прав доступа редактора).
   */
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

  /**
   * Получить все билеты предмета, отсортированные по возрастанию номера.
   */
  async findBySubjectIdSorted(subjectId: number): Promise<SelectableTicket[]> {
    return this.db
      .selectFrom('tickets')
      .selectAll()
      .where('subjectId', '=', subjectId)
      .orderBy('ticketNumber', 'asc')
      .execute();
  }

  /**
   * Подсчитать количество билетов по каждому предмету.
   */
  async countGroupBySubject(): Promise<{ subjectId: number; count: number }[]> {
    const rows = await this.db
      .selectFrom('tickets')
      .select(['subjectId', (eb) => eb.fn.count<number>('ticketId').as('count')])
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
   * Создать новый билет.
   */
  async insert(data: InsertableTicket): Promise<void> {
    await this.db
      .insertInto('tickets')
      .values(data)
      .execute();
  }

  /**
   * Обновить поля билета по его ID.
   */
  async update(ticketId: number, patch: UpdateableTicket): Promise<void> {
    await this.db
      .updateTable('tickets')
      .set(patch)
      .where('ticketId', '=', ticketId)
      .execute();
  }

  /**
   * Назначить билет студенту и перевести статус в `IN_PROGRESS`.
   */
  async assignTicketToStudent(ticketId: number, studentId: number): Promise<void> {
    await this.db
      .updateTable('tickets')
      .set({
        studentId,
        status: TicketStatus.IN_PROGRESS,
        updatedAt: new Date().toISOString(),
      })
      .where('ticketId', '=', ticketId)
      .execute();
  }

  /**
   * Закрепить билет за проверяющим редактором.
   */
  async assignTicketToEditor(ticketId: number, editorId: number): Promise<void> {
    await this.db
      .updateTable('tickets')
      .set({ editorId })
      .where('ticketId', '=', ticketId)
      .execute();
  }

  /**
   * Сбросить привязку всех студентов и статусы билетов по предмету перед перераспределением.
   */
  async clearStudentAssignmentsBySubject(subjectId: number): Promise<void> {
    await this.db
      .updateTable('tickets')
      .set({
        studentId: sql`NULL`,
        status: sql`NULL`,
      })
      .where('subjectId', '=', subjectId)
      .execute();
  }

  /**
   * Сбросить привязку всех редакторов по предмету перед перераспределением.
   */
  async clearEditorAssignmentsBySubject(subjectId: number): Promise<void> {
    await this.db
      .updateTable('tickets')
      .set({
        editorId: sql`NULL`,
      })
      .where('subjectId', '=', subjectId)
      .execute();
  }

  // =========================================================================
  // УДАЛЕНИЕ (DELETE)
  // =========================================================================

  /**
   * Удалить билет по его ID.
   */
  async remove(ticketId: number): Promise<void> {
    await this.db
      .deleteFrom('tickets')
      .where('ticketId', '=', ticketId)
      .execute();
  }

  /**
   * Удалить лишние билеты предмета, чей номер превышает максимальный номер в Google Таблице.
   */
  async removeTicketsExceedingNumber(subjectId: number, maxTicketNumber: number): Promise<void> {
    await this.db
      .deleteFrom('tickets')
      .where('subjectId', '=', subjectId)
      .where('ticketNumber', '>', maxTicketNumber)
      .execute();
  }
}

export const ticketRepository = new TicketRepository();

