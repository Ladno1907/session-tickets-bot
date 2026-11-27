import type { Generated } from 'kysely';
import type { TicketStatus, ProcessStage } from './entities.js';

/**
 * Схема таблиц базы данных SQLite для query-builder Kysely.
 */
export interface DatabaseSchema {
  users: UsersTable;
  subjects: SubjectsTable;
  registrations_for_subjects: RegistrationsForSubjectTable;
  editors_for_subjects: EditorsForSubjectTable;
  editor_requests: EditorRequestsTable;
  tickets: TicketsTable;
  process_config: ProcessConfigTable;
  user_main_menu_states: UserMainMenuStateTable;
  sessions: SessionsTable;
  checkpoints: CheckpointsTable;
}

export interface SessionsTable {
  telegramId: number;
  sessionData: string | null;
  updatedAt: string;
}

export interface UsersTable {
  telegramId: number;
  userName: string;
  registeredAt: string;
  student: 0 | 1;
  editor: 0 | 1;
  chiefEditor: 0 | 1;
  missedDeadlines: Generated<number>;
}

export interface SubjectsTable {
  subjectId: Generated<number>;
  subjectName: string;
}

export interface RegistrationsForSubjectTable {
  telegramId: number;
  subjectId: number;
}

export interface EditorsForSubjectTable {
  telegramId: number;
  subjectId: number;
}

export interface EditorRequestsTable {
  telegramId: number;
  subjectId: number;
}

export interface TicketsTable {
  ticketId: Generated<number>;
  subjectId: number;
  ticketNumber: number;
  question: string;
  studentId?: number;
  editorId?: number;
  studentComment?: string;
  editorComment?: string;
  updatedAt: string;
  status?: TicketStatus;
  fileVersion?: number;
  fileExtension?: string;
}

export interface ProcessConfigTable {
  id: 'global';
  currentStage: ProcessStage;
  registrationEnd?: string;
  distributionEnd?: string;
  ticketingEnd?: string;
}

export interface UserMainMenuStateTable {
  telegramId: number;
  messageId: number;
  lastUpdated: string;
}

export interface CheckpointsTable {
  checkpointId: Generated<number>;
  deadlineAt: string;
  remindedAt?: string | null;
  processedAt?: string | null;
}
