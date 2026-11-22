import { db } from '../database/client.js';
import { config } from '../config.js';

import { userRepository } from '../database/repositories/UserRepo.js';
import { registrationRepository } from '../database/repositories/RegistrationRepo.js';
import { editorRequestRepository } from '../database/repositories/EditorRequestRepo.js';
import { ticketRepository } from '../database/repositories/TicketRepo.js';
import { ticketViewRepository } from '../database/repositories/TicketViewRepo.js';
import { subjectRepository } from '../database/repositories/SubjectRepo.js';
import { stageManager } from '../managers/StageManager.js';
import { ticketSheetRepository } from '../database/sheetRepositories/TicketSheetRepository.js';

import { ProcessStage, User, TicketStatus } from '../types/entities.js';
import type { TicketWithSubjectView } from '../database/repositories/TicketViewRepo.js';

/**
 * Сервис бизнес-логики Студента (участника подготовки билетов).
 * Управляет первичной регистрацией по ФИО, выбором предметов, подачей заявок в редакторы,
 * просмотром назначенных билетов и отправкой файлов решений.
 */
export class StudentService {
  constructor(
    private readonly userRepo = userRepository,
    private readonly registrationRepo = registrationRepository,
    private readonly editorRequestRepo = editorRequestRepository,
    private readonly ticketRepo = ticketRepository,
    private readonly ticketViewRepo = ticketViewRepository,
    private readonly subjectRepo = subjectRepository,
    private readonly ticketSheetRepo = ticketSheetRepository,
  ) {}

  // =========================================================================
  // ПРОФИЛЬ И ПЕРВИЧНАЯ РЕГИСТРАЦИЯ
  // =========================================================================

  /**
   * Возвращает список всех зарегистрированных пользователей.
   */
  async getAllUsers(): Promise<User[]> {
    return this.userRepo.findAll();
  }

  /**
   * Находит профиль пользователя по его Telegram ID.
   */
  async getUserById(telegramId: number): Promise<User | null> {
    const userRow = await this.userRepo.findById(telegramId);
    if (!userRow) return null;

    return {
      telegramId: userRow.telegramId,
      userName: userRow.userName,
      registeredAt: userRow.registeredAt,
      student: userRow.student,
      editor: userRow.editor,
      chiefEditor: userRow.chiefEditor,
    };
  }

  /**
   * Регистрирует нового пользователя по ФИО на этапе `REGISTRATION`
   * (изначально `student = 0` до выбора предметов).
   */
  async registerUser(telegramId: number, name: string): Promise<void> {
    const currentStage = await stageManager.getCurrentStageFast();
    if (currentStage !== ProcessStage.REGISTRATION) {
      throw new Error(`Регистрация возможна только на этапе '${ProcessStage.REGISTRATION}', текущий этап: '${currentStage}'`);
    }

    const existingUser = await this.userRepo.findById(telegramId);
    if (existingUser) {
      throw new Error('Пользователь уже зарегистрирован.');
    }

    const isChiefEditor = config.chiefEditorIds.includes(telegramId) ? 1 : 0;

    const newUser: User = {
      telegramId,
      userName: name,
      registeredAt: new Date().toISOString(),
      student: 0,
      editor: 0,
      chiefEditor: isChiefEditor,
    };

    await this.userRepo.insert(newUser);
  }

  // =========================================================================
  // ВЫБОР ПРЕДМЕТОВ И ЗАЯВКИ В РЕДАКТОРЫ (ЭТАП REGISTRATION)
  // =========================================================================

  /**
   * Возвращает список всех доступных учебных предметов.
   */
  async getAllSubjects(): Promise<{ subjectId: number; subjectName: string }[]> {
    return this.subjectRepo.findAll();
  }

  /**
   * Возвращает список предметов, выбранных студентом для подготовки билетов.
   */
  async getSelectedSubjectsForPreparation(telegramId: number): Promise<{ id: number; name: string }[]> {
    const currentStage = await stageManager.getCurrentStageFast();
    if (currentStage !== ProcessStage.REGISTRATION) {
      throw new Error(`Получение списка предметов возможно только на этапе '${ProcessStage.REGISTRATION}', текущий этап: '${currentStage}'`);
    }

    const user = await this.userRepo.findById(telegramId);
    if (!user) {
      throw new Error('Пользователь не найден.');
    }

    const registrationRecords = await this.registrationRepo.findByUserId(telegramId);
    const subjectIds = registrationRecords.map((reg) => reg.subjectId);
    if (subjectIds.length === 0) return [];

    const subjects = await this.subjectRepo.findByIds(subjectIds);
    return subjects.map((s) => ({ id: s.subjectId, name: s.subjectName }));
  }

  /**
   * Возвращает список предметов, на которые пользователь подал заявку в редакторы.
   */
  async getRequestedEditorSubjects(telegramId: number): Promise<{ id: number; name: string }[]> {
    const currentStage = await stageManager.getCurrentStageFast();
    if (currentStage !== ProcessStage.REGISTRATION) {
      throw new Error(`Получение списка заявок возможно только на этапе '${ProcessStage.REGISTRATION}', текущий этап: '${currentStage}'`);
    }

    const user = await this.userRepo.findById(telegramId);
    if (!user) {
      throw new Error('Пользователь не найден.');
    }

    const requestRecords = await this.editorRequestRepo.findByUserId(telegramId);
    const subjectIds = requestRecords.map((req) => req.subjectId);
    if (subjectIds.length === 0) return [];

    const subjects = await this.subjectRepo.findByIds(subjectIds);
    return subjects.map((s) => ({ id: s.subjectId, name: s.subjectName }));
  }

  /**
   * Синхронизирует выбранные студентом предметы подготовки
   * и обновляет флаг `users.student` (`1` если > 0, иначе `0`).
   */
  async selectSubjectsForPreparation(telegramId: number, subjectIds: number[]): Promise<void> {
    const currentStage = await stageManager.getCurrentStageFast();
    if (currentStage !== ProcessStage.REGISTRATION) {
      throw new Error(`Выбор предметов возможен только на этапе '${ProcessStage.REGISTRATION}', текущий этап: '${currentStage}'`);
    }

    const user = await this.userRepo.findById(telegramId);
    if (!user) {
      throw new Error('Пользователь не найден.');
    }

    const currentRegistrations = await this.registrationRepo.findByUserId(telegramId);
    const currentSubjectIds = new Set(currentRegistrations.map((reg) => reg.subjectId));

    const idsToDelete = currentSubjectIds.size > 0
      ? Array.from(currentSubjectIds).filter((id) => !subjectIds.includes(id))
      : [];
    const idsToInsert = subjectIds.filter((id) => !currentSubjectIds.has(id));

    const finalSubjectsCount = currentSubjectIds.size - idsToDelete.length + idsToInsert.length;
    const isStudentStatus: 0 | 1 = finalSubjectsCount > 0 ? 1 : 0;

    await db.transaction().execute(async (trx) => {
      const trxRegistrationRepo = this.registrationRepo.withTransaction(trx);
      const trxUserRepo = this.userRepo.withTransaction(trx);
      const trxSubjectRepo = this.subjectRepo.withTransaction(trx);

      if (idsToDelete.length > 0) {
        await trxRegistrationRepo.removeAllByUserIdAndSubjectIds(telegramId, idsToDelete);
      }

      for (const subjectId of idsToInsert) {
        const subject = await trxSubjectRepo.findById(subjectId);
        if (!subject) {
          throw new Error(`Предмет с ID ${subjectId} не найден.`);
        }
        await trxRegistrationRepo.insert({ telegramId, subjectId });
      }

      await trxUserRepo.update(telegramId, { student: isStudentStatus });
    });
  }

  /**
   * Синхронизирует список предметов, по которым пользователь хочет стать редактором.
   */
  async expressDesireToBeEditor(telegramId: number, subjectIds: number[]): Promise<void> {
    const currentStage = await stageManager.getCurrentStageFast();
    if (currentStage !== ProcessStage.REGISTRATION) {
      throw new Error(`Желание стать редактором возможно только на этапе '${ProcessStage.REGISTRATION}', текущий этап: '${currentStage}'`);
    }

    const user = await this.userRepo.findById(telegramId);
    if (!user) {
      throw new Error('Пользователь не найден.');
    }

    const currentRequests = await this.editorRequestRepo.findByUserId(telegramId);
    const currentSubjectIds = new Set(currentRequests.map((req) => req.subjectId));

    const idsToDelete = currentSubjectIds.size > 0
      ? Array.from(currentSubjectIds).filter((id) => !subjectIds.includes(id))
      : [];
    const idsToInsert = subjectIds.filter((id) => !currentSubjectIds.has(id));

    await db.transaction().execute(async (trx) => {
      const trxEditorRequestRepo = this.editorRequestRepo.withTransaction(trx);
      const trxSubjectRepo = this.subjectRepo.withTransaction(trx);

      if (idsToDelete.length > 0) {
        await trxEditorRequestRepo.removeAllByUserIdAndSubjectIds(telegramId, idsToDelete);
      }

      for (const subjectId of idsToInsert) {
        const subject = await trxSubjectRepo.findById(subjectId);
        if (!subject) {
          throw new Error(`Предмет с ID ${subjectId} не найден.`);
        }
        await trxEditorRequestRepo.insert({ telegramId, subjectId });
      }
    });
  }

  // =========================================================================
  // СДАЧА И ПРОСМОТР БИЛЕТОВ (ЭТАПЫ TICKETING И FINISHED)
  // =========================================================================

  /**
   * Возвращает все билеты, назначенные студенту по его зарегистрированным предметам.
   */
  async getTicketsForStudent(telegramId: number): Promise<TicketWithSubjectView[]> {
    const currentStage = await stageManager.getCurrentStageFast();
    if (currentStage !== ProcessStage.TICKETING && currentStage !== ProcessStage.FINISHED) {
      throw new Error(`Просмотр билетов возможен только на этапах '${ProcessStage.TICKETING}' или '${ProcessStage.FINISHED}', текущий этап: '${currentStage}'`);
    }

    const user = await this.userRepo.findById(telegramId);
    if (!user) {
      throw new Error('Пользователь не найден.');
    }

    if (user.student !== 1) {
      throw new Error('Пользователь не является студентом.');
    }

    const registrations = await this.registrationRepo.findByUserId(telegramId);
    const registeredSubjectIds = registrations.map((reg) => reg.subjectId);
    if (registeredSubjectIds.length === 0) return [];

    return this.ticketViewRepo.findByStudentIdAndSubjectIds(telegramId, registeredSubjectIds);
  }

  /**
   * Фиксирует отправку файла решения студентом по `ticketId`: увеличивает версию файла,
   * переводит статус билета в `ON_CHECK` и окрашивает ячейку в Google Sheets в серый цвет.
   */
  async submitTicketById(
    studentTelegramId: number,
    ticketId: number,
    fileExtension: string,
    comment?: string
  ): Promise<{ version: number; subjectName: string; ticketNumber: number }> {
    const currentStage = await stageManager.getCurrentStageFast();
    if (currentStage !== ProcessStage.TICKETING && currentStage !== ProcessStage.FINISHED) {
      throw new Error('Отправка билета возможна только на этапе подготовки.');
    }

    const ticket = await this.ticketRepo.findById(ticketId);
    if (!ticket || ticket.studentId !== studentTelegramId) {
      throw new Error('Билет не найден или не назначен вам.');
    }

    const subject = await this.subjectRepo.findById(ticket.subjectId);
    const newFileVersion = (ticket.fileVersion ?? 0) + 1;

    await this.ticketRepo.update(ticketId, {
      status: TicketStatus.ON_CHECK,
      updatedAt: new Date().toISOString(),
      ...(comment !== undefined && { studentComment: comment }),
      fileVersion: newFileVersion,
      fileExtension,
    });

    if (subject) {
      await this.ticketSheetRepo
        .updateTicketCellColor(subject.subjectName, ticket.ticketNumber, TicketStatus.ON_CHECK)
        .catch((err) => console.error('Ошибка покраски ячейки в Sheets:', err));
    }

    return {
      version: newFileVersion,
      subjectName: subject?.subjectName || '',
      ticketNumber: ticket.ticketNumber,
    };
  }

  /**
   * Откатывает статус билета обратно в `IN_PROGRESS` при сбое скачивания
   * документа с серверов Telegram.
   */
  async revertTicketStatus(ticketId: number): Promise<void> {
    await this.ticketRepo.update(ticketId, {
      status: TicketStatus.IN_PROGRESS,
      updatedAt: new Date().toISOString(),
    });
  }
}

export const studentService = new StudentService();
