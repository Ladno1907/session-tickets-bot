import type { Transaction } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { DatabaseSchema } from '../../types/database.js';
import type { TicketStatus } from '../../types/entities.js';

export interface TicketWithSubjectView {
  ticketId: number;
  subjectId: number;
  subjectName: string;
  ticketNumber: number;
  question: string;
  studentId?: number;
  studentName?: string | null;
  editorId?: number;
  studentComment?: string;
  editorComment?: string;
  status?: TicketStatus;
  fileVersion?: number;
  fileExtension?: string;
}

/**
 * Read-only репозиторий (Query View) для получения билетов с JOIN-данными предметов и студентов.
 */
export class TicketViewRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): TicketViewRepository {
    return new TicketViewRepository(trx);
  }

  // =========================================================================
  // ЧТЕНИЕ ПРЕДСТАВЛЕНИЙ (SELECT + JOIN)
  // =========================================================================

  /**
   * Получить детальную карточку билета по его ID (с названием предмета и ФИО студента).
   */
  async findByTicketId(ticketId: number): Promise<TicketWithSubjectView | null> {
    const result = await this.db
      .selectFrom('tickets')
      .innerJoin('subjects', 'subjects.subjectId', 'tickets.subjectId')
      .leftJoin('users', 'users.telegramId', 'tickets.studentId')
      .select([
        'tickets.ticketId',
        'tickets.subjectId',
        'subjects.subjectName',
        'tickets.ticketNumber',
        'tickets.question',
        'tickets.studentId',
        'users.userName as studentName',
        'tickets.editorId',
        'tickets.studentComment',
        'tickets.editorComment',
        'tickets.status',
        'tickets.fileVersion',
        'tickets.fileExtension',
      ])
      .where('tickets.ticketId', '=', ticketId)
      .executeTakeFirst();

    return result ?? null;
  }

  /**
   * Получить все билеты, назначенные конкретному студенту по списку его предметов.
   */
  async findByStudentIdAndSubjectIds(studentId: number, subjectIds: number[]): Promise<TicketWithSubjectView[]> {
    if (subjectIds.length === 0) return [];

    return this.db
      .selectFrom('tickets')
      .innerJoin('subjects', 'subjects.subjectId', 'tickets.subjectId')
      .select([
        'tickets.ticketId',
        'tickets.subjectId',
        'subjects.subjectName',
        'tickets.ticketNumber',
        'tickets.question',
        'tickets.studentId',
        'tickets.editorId',
        'tickets.studentComment',
        'tickets.editorComment',
        'tickets.status',
        'tickets.fileVersion',
        'tickets.fileExtension',
      ])
      .where('tickets.studentId', '=', studentId)
      .where('tickets.subjectId', 'in', subjectIds)
      .orderBy('tickets.subjectId', 'asc')
      .orderBy('tickets.ticketNumber', 'asc')
      .execute();
  }

  /**
   * Получить все билеты, закреплённые за конкретным редактором по его предметам (включая ФИО студентов).
   */
  async findByEditorIdAndSubjectIds(editorId: number, subjectIds: number[]): Promise<TicketWithSubjectView[]> {
    if (subjectIds.length === 0) return [];

    return this.db
      .selectFrom('tickets')
      .innerJoin('subjects', 'subjects.subjectId', 'tickets.subjectId')
      .leftJoin('users', 'users.telegramId', 'tickets.studentId')
      .select([
        'tickets.ticketId',
        'tickets.subjectId',
        'subjects.subjectName',
        'tickets.ticketNumber',
        'tickets.question',
        'tickets.studentId',
        'users.userName as studentName',
        'tickets.editorId',
        'tickets.studentComment',
        'tickets.editorComment',
        'tickets.status',
        'tickets.fileVersion',
        'tickets.fileExtension',
      ])
      .where('tickets.editorId', '=', editorId)
      .where('tickets.subjectId', 'in', subjectIds)
      .orderBy('tickets.subjectId', 'asc')
      .orderBy('tickets.ticketNumber', 'asc')
      .execute();
  }
}

export const ticketViewRepository = new TicketViewRepository();

