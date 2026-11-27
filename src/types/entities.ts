/** Роли пользователей в системе подготовки билетов. */
export enum UserRole {
  STUDENT = 'student',
  EDITOR = 'editor',
  CHIEF_EDITOR = 'chief_editor',
}

/** Последовательные этапы жизненного цикла подготовки к сессии. */
export enum ProcessStage {
  PREPARATION = 'preparation',
  REGISTRATION = 'registration',
  DISTRIBUTION = 'distribution',
  TICKETING = 'ticketing',
  FINISHED = 'finished',
}

/** Статусы жизненного цикла экзаменационного билета. */
export enum TicketStatus {
  IN_PROGRESS = 'in_progress',
  ON_CHECK = 'on_check',
  APPROVED = 'approved',
  ON_REWORK = 'on_rework',
}

export interface User {
  telegramId: number;
  userName: string;
  registeredAt: string;
  student: 0 | 1;
  editor: 0 | 1;
  chiefEditor: 0 | 1;
  missedDeadlines: number;
}

export interface Subject {
  subjectId: number;
  subjectName: string;
}

export interface UserRegistrationForSubject {
  telegramId: number;
  subjectId: number;
}

export interface UserEditForSubject {
  telegramId: number;
  subjectId: number;
}

export interface EditorRequest {
  telegramId: number;
  subjectId: number;
}

export interface Ticket {
  ticketId: number;
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

export interface ProcessConfig {
  id: 'global';
  currentStage: ProcessStage;
  registrationEnd?: string;
  distributionEnd?: string;
  ticketingEnd?: string;
}

export interface UserMainMenuState {
  telegramId: number;
  messageId: number;
  lastUpdated: string;
}

export interface Checkpoint {
  checkpointId: number;
  deadlineAt: string;
  remindedAt?: string;
  processedAt?: string;
}
