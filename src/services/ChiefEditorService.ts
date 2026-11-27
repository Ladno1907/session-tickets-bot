import { Bot } from 'grammy';
import { existsSync } from 'node:fs';
import { db } from '../database/client.js';
import { bot } from '../bot.js';
import { MyContext } from '../types/context.js';
import { ProcessConfig, ProcessStage, TicketStatus } from '../types/entities.js';
import { ParsedSubjectRow } from '../types/sheets.js';
import { config } from '../config.js';

import { checkpointRepository } from '../database/repositories/CheckpointRepo.js';
import { checkpointService, type TimelinePoint, type CheckpointDebtor } from './CheckpointService.js';
import { stageManager } from '../managers/StageManager.js';
import { userRepository } from '../database/repositories/UserRepo.js';
import { editorRepository } from '../database/repositories/EditorRepo.js';
import { ticketRepository } from '../database/repositories/TicketRepo.js';
import { processConfigRepository } from '../database/repositories/ProcessConfigRepo.js';
import { subjectRepository } from '../database/repositories/SubjectRepo.js';
import { editorRequestRepository } from '../database/repositories/EditorRequestRepo.js';
import { ticketSheetRepository } from '../database/sheetRepositories/TicketSheetRepository.js';
import { registrationRepository } from '../database/repositories/RegistrationRepo.js';
import { ticketViewRepository, type TicketWithSubjectView } from '../database/repositories/TicketViewRepo.js';
import { ticketFileStorage } from '../storage/TicketFileStorage.js';
import { feedbackStorage } from '../storage/FeedbackStorage.js';

/**
 * Сервис бизнес-логики Главного Редактора (Администратора сессии).
 * Управляет дедлайнами, переключением этапов, составом предметов, назначением редакторов
 * и двусторонней синхронизацией ведомостей с Google Sheets.
 */
export class ChiefEditorService {
  constructor(
    private readonly userRepo = userRepository,
    private readonly editorRepo = editorRepository,
    private readonly ticketRepo = ticketRepository,
    private readonly processConfigRepo = processConfigRepository,
    private readonly subjectRepo = subjectRepository,
    private readonly editorRequestRepo = editorRequestRepository,
    private readonly ticketSheetRepo = ticketSheetRepository,
    private readonly registrationRepo = registrationRepository,
  ) {}

  // =========================================================================
  // ПРОВЕРКА ПРАВ И СИНХРОНИЗАЦИЯ АДМИНИСТРАТОРОВ
  // =========================================================================

  /**
   * Проверяет, входит ли Telegram ID в список главных редакторов из конфигурации.
   */
  public isAdmin(telegramId: number): boolean {
    return config.chiefEditorIds.includes(telegramId);
  }

  /**
   * Синхронизирует флаг `chiefEditor` в таблице `users` согласно `CHIEF_EDITOR_IDS` из `.env`.
   */
  async syncChiefEditors(configIds: number[]): Promise<void> {
    await db.transaction().execute(async (trx) => {
      const trxUserRepo = this.userRepo.withTransaction(trx);

      await trxUserRepo.updateAll({ chiefEditor: 1 }, { chiefEditor: 0 });

      if (configIds.length > 0) {
        await trxUserRepo.updateByIds(configIds, { chiefEditor: 1 });
      }
    });
  }

  /**
   * Выбрасывает исключение, если пользователь не обладает правами главного редактора.
   */
  private assertAdmin(telegramId: number): void {
    if (!this.isAdmin(telegramId)) {
      throw new Error('Доступ запрещен. Пользователь не является главным редактором.');
    }
  }

  // =========================================================================
  // УПРАВЛЕНИЕ ДЕДЛАЙНАМИ И ЭТАПАМИ ПРОЦЕССА
  // =========================================================================

  /**
   * Возвращает текущие установленные дедлайны этапов из глобальной конфигурации.
   */
  async getDeadlines(
    chiefEditorTelegramId: number
  ): Promise<{ registrationEnd?: string; distributionEnd?: string; ticketingEnd?: string } | null> {
    this.assertAdmin(chiefEditorTelegramId);

    const cfg = await this.processConfigRepo.findGlobalConfig();
    if (!cfg) return null;

    return {
      registrationEnd: cfg.registrationEnd,
      distributionEnd: cfg.distributionEnd,
      ticketingEnd: cfg.ticketingEnd,
    };
  }

  /**
   * Устанавливает или обновляет дедлайны этапов (доступно только на стадии `PREPARATION`).
   */
  async setDeadlines(
    chiefEditorTelegramId: number,
    deadlines: Partial<Pick<ProcessConfig, 'registrationEnd' | 'distributionEnd' | 'ticketingEnd'>>
  ): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);

    const currentStage = await stageManager.getCurrentStageFast();
    if (currentStage !== ProcessStage.PREPARATION) {
      throw new Error(`Изменение дедлайнов невозможно. Текущий этап: '${currentStage}', а должен быть: '${ProcessStage.PREPARATION}'`);
    }

    const currentConfig = await this.processConfigRepo.findGlobalConfig();

    if (!currentConfig) {
      await this.processConfigRepo.insert({ id: 'global', currentStage: ProcessStage.PREPARATION, ...deadlines });
      return;
    }

    const updatedConfig: Partial<ProcessConfig> = {
      registrationEnd: deadlines.registrationEnd ?? currentConfig.registrationEnd,
      distributionEnd: deadlines.distributionEnd ?? currentConfig.distributionEnd,
      ticketingEnd: deadlines.ticketingEnd ?? currentConfig.ticketingEnd,
    };

    await this.processConfigRepo.update(updatedConfig);
  }

  /**
   * Переводит систему из подготовительного этапа (`PREPARATION`) в этап регистрации (`REGISTRATION`),
   * предварительно проверяя наличие всех трёх обязательных дедлайнов.
   */
  async startRegistrationStage(chiefEditorTelegramId: number, botInstance: Bot<MyContext>): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);

    const currentConfig = await this.processConfigRepo.findGlobalConfig();
    if (!currentConfig) {
      throw new Error('Конфигурация процесса не найдена.');
    }

    if (currentConfig.currentStage !== ProcessStage.PREPARATION) {
      throw new Error(`Запуск этапа регистрации возможен только из этапа '${ProcessStage.PREPARATION}', текущий этап: '${currentConfig.currentStage}'`);
    }

    const requiredDeadlines: (keyof Pick<ProcessConfig, 'registrationEnd' | 'distributionEnd' | 'ticketingEnd'>)[] = [
      'registrationEnd',
      'distributionEnd',
      'ticketingEnd',
    ];

    const missingDeadlines = requiredDeadlines.filter((dl) => !currentConfig[dl]);
    if (missingDeadlines.length > 0) {
      throw new Error(`Невозможно запустить этап регистрации. Не установлены следующие дедлайны: ${missingDeadlines.join(', ')}.`);
    }

    await stageManager.executeTransitionEffects(
      ProcessStage.PREPARATION,
      ProcessStage.REGISTRATION,
      botInstance
    );

    await this.processConfigRepo.update({ currentStage: ProcessStage.REGISTRATION });
  }

  /**
   * Досрочно завершает текущий этап (`REGISTRATION`, `DISTRIBUTION` или `TICKETING`),
   * запускает триггеры перехода и фиксирует текущее время как конец завершённого этапа.
   */
  async startNextStage(chiefEditorTelegramId: number): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);

    const currentStage = await stageManager.getCurrentStageFast();
    if (currentStage === ProcessStage.PREPARATION) {
      throw new Error(`Невозможно выполнить переход на следующий этап из '${ProcessStage.PREPARATION}'.`);
    }
    if (currentStage === ProcessStage.FINISHED) {
      throw new Error(`Невозможно выполнить переход на следующий этап из '${ProcessStage.FINISHED}'. Процесс завершен.`);
    }

    const nextStage = stageManager.getNextStage(currentStage);
    if (nextStage === null) {
      throw new Error(`Невозможно перейти к следующему этапу из '${currentStage}'. Процесс завершен или этап неизвестен.`);
    }

    await stageManager.executeTransitionEffects(currentStage, nextStage, bot);

    const nowIsoString = new Date().toISOString();
    const updatePatch: Partial<ProcessConfig> = {
      currentStage: nextStage,
    };

    switch (currentStage) {
      case ProcessStage.REGISTRATION:
        updatePatch.registrationEnd = nowIsoString;
        break;
      case ProcessStage.DISTRIBUTION:
        updatePatch.distributionEnd = nowIsoString;
        break;
      case ProcessStage.TICKETING:
        updatePatch.ticketingEnd = nowIsoString;
        break;
      default:
        throw new Error(`Неизвестный текущий этап для обновления дедлайна: ${currentStage}`);
    }

    await this.processConfigRepo.update(updatePatch);
  }

  // =========================================================================
  // УПРАВЛЕНИЕ ПРЕДМЕТАМИ И БИЛЕТАМИ
  // =========================================================================

  /**
   * Возвращает список всех учебных предметов в системе.
   */
  async getAllSubjects(chiefEditorTelegramId: number): Promise<{ subjectId: number; subjectName: string }[]> {
    this.assertAdmin(chiefEditorTelegramId);
    return this.subjectRepo.findAll();
  }

  /**
   * Загружает или обновляет список предметов и вопросы билетов из указанных листов Google Sheets.
   */
  async loadSubjectsAndTicketsFromSheets(chiefEditorTelegramId: number, subjectNames: string[]): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);

    const downloadedData: Record<string, ParsedSubjectRow[]> = {};
    for (const name of subjectNames) {
      downloadedData[name] = await this.ticketSheetRepo.getSubjectData(name);
    }

    await db.transaction().execute(async (trx) => {
      const txSubjectRepo = this.subjectRepo.withTransaction(trx);
      const txTicketRepo = this.ticketRepo.withTransaction(trx);

      for (const name of subjectNames) {
        const sheetRows = downloadedData[name];

        let subject = await txSubjectRepo.findByName(name);
        if (!subject) {
          await txSubjectRepo.insert({ subjectName: name });
          subject = await txSubjectRepo.findByName(name);
        }

        const subjectId = subject!.subjectId;
        const maxTicketNumberInSheet = sheetRows.length > 0
          ? Math.max(...sheetRows.map((r) => r.ticketNumber))
          : 0;

        await txTicketRepo.removeTicketsExceedingNumber(subjectId, maxTicketNumberInSheet);

        const nowIsoString = new Date().toISOString();

        for (const row of sheetRows) {
          const existingTicket = await txTicketRepo.findBySubjectAndNumber(subjectId, row.ticketNumber);

          if (!existingTicket) {
            await txTicketRepo.insert({
              subjectId,
              ticketNumber: row.ticketNumber,
              question: row.question,
              updatedAt: nowIsoString,
            });
          } else if (existingTicket.question !== row.question) {
            await txTicketRepo.update(existingTicket.ticketId, {
              question: row.question,
              updatedAt: nowIsoString,
            });
          }
        }
      }
    });
  }

  /**
   * Полностью удаляет предмет из БД вместе с билетами, регистрациями, редакторами и заявками.
   */
  async deleteSubjectByIdWithAllData(chiefEditorTelegramId: number, subjectId: number): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);
    
    const subject = await this.subjectRepo.findById(subjectId);
    if (!subject) {
      throw new Error(`Предмет с ID ${subjectId} не найден в базе данных.`);
    }

    await db.transaction().execute(async (trx) => {
      const txSubjectRepo = this.subjectRepo.withTransaction(trx);
      await txSubjectRepo.removeSubjectCompletely(subjectId);
    });
  }

  // =========================================================================
  // УПРАВЛЕНИЕ РЕДАКТОРАМИ И ЗАЯВКАМИ
  // =========================================================================

  /**
   * Возвращает список утверждённых редакторов по конкретному предмету.
   */
  async getEditorsForSubject(
    chiefEditorTelegramId: number,
    subjectId: number
  ): Promise<{ telegramId: number; name: string }[]> {
    this.assertAdmin(chiefEditorTelegramId);
    
    const currentStage = await stageManager.getCurrentStageFast();
    if (currentStage === ProcessStage.PREPARATION) {
      throw new Error(`Действие недоступно на этапе '${ProcessStage.PREPARATION}'.`);
    }

    const subject = await this.subjectRepo.findById(subjectId);
    if (!subject) {
      throw new Error(`Предмет с ID ${subjectId} не найден.`);
    }

    const editorRecords = await this.editorRepo.findBySubjectId(subjectId);
    const editorIds = editorRecords.map((record) => record.telegramId);
    
    if (editorIds.length === 0) return [];

    const users = await this.userRepo.findByIds(editorIds);
    return users.map((user) => ({ telegramId: user.telegramId, name: user.userName }));
  }

  /**
   * Возвращает список студентов, подавших заявку на редакторство по конкретному предмету.
   */
  async getEditorRequestsForSubject(
    chiefEditorTelegramId: number,
    subjectId: number
  ): Promise<{ telegramId: number; name: string }[]> {
    this.assertAdmin(chiefEditorTelegramId);
    
    const currentStage = await stageManager.getCurrentStageFast();
    if (currentStage === ProcessStage.PREPARATION) {
      throw new Error(`Действие недоступно на этапе '${ProcessStage.PREPARATION}'.`);
    }

    const subject = await this.subjectRepo.findById(subjectId);
    if (!subject) {
      throw new Error(`Предмет с ID ${subjectId} не найден.`);
    }

    const requestRecords = await this.editorRequestRepo.findBySubjectId(subjectId);
    const requesterIds = requestRecords.map((record) => record.telegramId);
    
    if (requesterIds.length === 0) return [];

    const users = await this.userRepo.findByIds(requesterIds);
    return users.map((user) => ({ telegramId: user.telegramId, name: user.userName }));
  }

  /**
   * Возвращает всех утверждённых редакторов, сгруппированных по предметам.
   */
  async getAllEditorsGroupedBySubject(
    chiefEditorTelegramId: number
  ): Promise<{ subjectName: string; editors: string[] }[]> {
    this.assertAdmin(chiefEditorTelegramId);
    
    const currentStage = await stageManager.getCurrentStageFast();
    if (currentStage === ProcessStage.PREPARATION) {
      throw new Error(`Действие недоступно на этапе '${ProcessStage.PREPARATION}'.`);
    }

    const subjects = await this.subjectRepo.findAll();
    const result: { subjectName: string; editors: string[] }[] = [];

    for (const sub of subjects) {
      const editors = await this.getEditorsForSubject(chiefEditorTelegramId, sub.subjectId);
      result.push({
        subjectName: sub.subjectName,
        editors: editors.map((e) => e.name),
      });
    }

    return result;
  }

  /**
   * Назначает (assign) или отстраняет (unassign) пользователя от роли редактора предмета,
   * обновляет глобальный флаг `users.editor` и отправляет личное уведомление в Telegram.
   */
  async manageEditor(
    chiefEditorTelegramId: number,
    editorTelegramId: number,
    subjectId: number,
    action: 'assign' | 'unassign'
  ): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);
    
    const currentStage = await stageManager.getCurrentStageFast();
    if (currentStage === ProcessStage.PREPARATION) {
      throw new Error(`Действие недоступно на этапе '${ProcessStage.PREPARATION}'.`);
    }

    const editorUser = await this.userRepo.findById(editorTelegramId);
    if (!editorUser) {
      throw new Error('Пользователь (редактор) не найден.');
    }

    const subject = await this.subjectRepo.findById(subjectId);
    if (!subject) {
      throw new Error(`Предмет с ID ${subjectId} не найден.`);
    }

    if (action === 'assign') {
      try {
        await this.editorRepo.insert({ telegramId: editorTelegramId, subjectId });
      } catch (error: any) {
        if (!error.message.includes('UNIQUE constraint failed')) {
          throw error;
        }
      }
    } else if (action === 'unassign') {
      await this.editorRepo.remove(editorTelegramId, subjectId);
    } else {
      throw new Error("Недопустимое действие. Используйте 'assign' или 'unassign'.");
    }

    const remainingEdits = await this.editorRepo.findByUserId(editorTelegramId);
    const newEditorFlag = remainingEdits.length > 0 ? 1 : 0;
    await this.userRepo.update(editorTelegramId, { editor: newEditorFlag });

    try {
      if (action === 'assign') {
        await bot.api.sendMessage(
          editorTelegramId,
          `👑 *Вы утверждены редактором!*\n\nАдминистратор назначил вас проверять билеты по предмету: *${subject.subjectName}*.\n` +
          `Когда начнется этап подготовки ответов, используйте команду /editor для доступа к панели проверки.`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await bot.api.sendMessage(
          editorTelegramId,
          `➖ *Изменение статуса редактора*\n\nВы были отстранены от проверки билетов по предмету: *${subject.subjectName}*.\n` +
          `Если у вас больше не осталось активных предметов для проверки, команда /editor станет недоступной.`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (pushError) {
      console.warn(`Не удалось доставить фоновое уведомление пользователю ${editorTelegramId}:`, pushError);
    }
  }

  // =========================================================================
  // СТАТИСТИКА И СПИСКИ УЧАСТНИКОВ
  // =========================================================================

  /**
   * Возвращает сводку по загруженным предметам и количеству билетов в каждом из них.
   */
  async getPreparationStats(
    chiefEditorTelegramId: number
  ): Promise<{ subjectId: number; name: string; ticketsCount: number }[]> {
    this.assertAdmin(chiefEditorTelegramId);
    
    return db.transaction().execute(async (trx) => {
      const txSubjectRepo = this.subjectRepo.withTransaction(trx);
      const txTicketRepo = this.ticketRepo.withTransaction(trx);

      const allSubjects = await txSubjectRepo.findAll();
      const ticketCounts = await txTicketRepo.countGroupBySubject();
      const countsMap = new Map(ticketCounts.map((item) => [item.subjectId, item.count]));

      return allSubjects.map((subject) => ({
        subjectId: subject.subjectId,
        name: subject.subjectName,
        ticketsCount: countsMap.get(subject.subjectId) || 0,
      }));
    });
  }

  /**
   * Возвращает общее число активных студентов и утверждённых редакторов.
   */
  async getRegistrationStats(
    chiefEditorTelegramId: number
  ): Promise<{ totalStudents: number; totalEditors: number }> {
    this.assertAdmin(chiefEditorTelegramId);
    
    const totalStudents = await this.userRepo.countActiveStudents();
    const totalEditors = await this.userRepo.countActiveEditors();
    
    return { totalStudents, totalEditors };
  }

  /**
   * Возвращает количество записавшихся студентов в разрезе каждого предмета.
   */
  async getSubjectsDetailedStats(
    chiefEditorTelegramId: number
  ): Promise<{ subjectId: number; name: string; studentsCount: number }[]> {
    this.assertAdmin(chiefEditorTelegramId);
    
    const currentConfig = await this.processConfigRepo.findGlobalConfig();
    if (currentConfig?.currentStage === ProcessStage.PREPARATION) {
      throw new Error(`Получить статистику по количеству студентов невозможно на этапе '${ProcessStage.PREPARATION}'`);
    }

    const allSubjects = await this.subjectRepo.findAll();
    const counts = await this.registrationRepo.countStudentsGroupBySubject();
    const countsMap = new Map(counts.map((c) => [c.subjectId, c.count]));

    return allSubjects.map((s) => ({
      subjectId: s.subjectId,
      name: s.subjectName,
      studentsCount: countsMap.get(s.subjectId) || 0,
    }));
  }

  /**
   * Возвращает полный список всех зарегистрированных в боте пользователей.
   */
  async getAllRegisteredUsers(
    chiefEditorTelegramId: number
  ): Promise<{ telegramId: number; name: string }[]> {
    this.assertAdmin(chiefEditorTelegramId);
    
    const currentConfig = await this.processConfigRepo.findGlobalConfig();
    if (currentConfig?.currentStage === ProcessStage.PREPARATION) {
      throw new Error(`Получить список пользователей невозможно на этапе '${ProcessStage.PREPARATION}'`);
    }

    const rows = await this.userRepo.findAll();
    return rows.map((r) => ({ telegramId: r.telegramId, name: r.userName }));
  }

  /**
   * Возвращает список пользователей, записавшихся на конкретный предмет.
   */
  async getUsersOnSubject(
    chiefEditorTelegramId: number,
    subjectId: number
  ): Promise<{ telegramId: number; userName: string }[]> {
    this.assertAdmin(chiefEditorTelegramId);
    
    const currentConfig = await this.processConfigRepo.findGlobalConfig();
    if (currentConfig?.currentStage === ProcessStage.PREPARATION) {
      throw new Error(`Получить список пользователей невозможно на этапе '${ProcessStage.PREPARATION}'`);
    }

    const subject = await this.subjectRepo.findById(subjectId);
    if (!subject) {
      throw new Error(`Предмет с ID ${subjectId} не существует.`);
    }

    return this.registrationRepo.findUsersBySubjectId(subjectId);
  }
  
  // =========================================================================
  // СИНХРОНИЗАЦИЯ ВЕДОМОСТЕЙ С GOOGLE SHEETS
  // =========================================================================

  /**
   * Выгружает локальные данные SQLite (номера, вопросы, студентов и редакторов)
   * в соответствующий лист Google Sheets.
   */
  async exportLocalDataToSheet(chiefEditorTelegramId: number, subjectId: number): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);

    const subject = await this.subjectRepo.findById(subjectId);
    if (!subject) throw new Error('Предмет не найден.');

    const tickets = await this.ticketRepo.findBySubjectIdSorted(subjectId);

    const ticketsList = tickets.map((t) => ({
      ticketNumber: t.ticketNumber,
      question: t.question,
    }));

    const studentAssignments: { ticketNumber: number; studentFio: string }[] = [];
    const editorAssignments: { ticketNumber: number; editorFio: string }[] = [];

    for (const t of tickets) {
      if (t.studentId) {
        const u = await this.userRepo.findById(t.studentId);
        if (u) studentAssignments.push({ ticketNumber: t.ticketNumber, studentFio: u.userName });
      }
      if (t.editorId) {
        const u = await this.userRepo.findById(t.editorId);
        if (u) editorAssignments.push({ ticketNumber: t.ticketNumber, editorFio: u.userName });
      }
    }

    await this.ticketSheetRepo.saveTicketsList(subject.subjectName, ticketsList);
    await this.ticketSheetRepo.saveAssignedStudents(subject.subjectName, studentAssignments);
    await this.ticketSheetRepo.saveAssignedEditors(subject.subjectName, editorAssignments);
  }

  /**
   * Синхронизирует только номера и тексты вопросов предмета из Google Sheets в SQLite,
   * не затирая привязки студентов и редакторов.
   */
  async syncQuestionsOnlyFromSheet(chiefEditorTelegramId: number, subjectId: number): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);

    const subject = await this.subjectRepo.findById(subjectId);
    if (!subject) throw new Error('Предмет не найден.');

    const sheetRows = await this.ticketSheetRepo.getSubjectData(subject.subjectName);

    await db.transaction().execute(async (trx) => {
      const txTicketRepo = this.ticketRepo.withTransaction(trx);

      const maxTicketNumber = sheetRows.length > 0
        ? Math.max(...sheetRows.map((r) => r.ticketNumber))
        : 0;
      await txTicketRepo.removeTicketsExceedingNumber(subjectId, maxTicketNumber);

      for (const row of sheetRows) {
        const existingTicket = await txTicketRepo.findBySubjectAndNumber(subjectId, row.ticketNumber);
        if (existingTicket) {
          await txTicketRepo.update(existingTicket.ticketId, {
            question: row.question,
            updatedAt: new Date().toISOString(),
          });
        } else {
          await txTicketRepo.insert({
            subjectId,
            ticketNumber: row.ticketNumber,
            question: row.question,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    });
  }

  /**
   * Импортирует вопросы, студентов и редакторов «как есть» из Google Sheets в SQLite.
   * Никогда не сбрасывает статус уже сданных или проверяемых билетов (`APPROVED`, `ON_CHECK`, `ON_REWORK`).
   */
  async importDataAsIsFromSheet(chiefEditorTelegramId: number, subjectId: number): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);

    const subject = await this.subjectRepo.findById(subjectId);
    if (!subject) throw new Error('Предмет не найден.');

    const sheetRows = await this.ticketSheetRepo.getSubjectData(subject.subjectName);
    const allUsers = await this.userRepo.findAll();
    const nameToIdMap = new Map<string, number>(
      allUsers.map((u) => [u.userName.toLowerCase().trim(), u.telegramId])
    );

    await db.transaction().execute(async (trx) => {
      const txTicketRepo = this.ticketRepo.withTransaction(trx);
      const txRegRepo = this.registrationRepo.withTransaction(trx);
      const txEditorRepo = this.editorRepo.withTransaction(trx);
      const txUserRepo = this.userRepo.withTransaction(trx);

      const existingTickets = await txTicketRepo.findBySubjectIdSorted(subjectId);
      const oldTicketsMap = new Map(existingTickets.map((t) => [t.ticketNumber, t]));

      const oldRegs = await txRegRepo.findBySubjectId(subjectId);
      for (const reg of oldRegs) {
        await txRegRepo.remove(reg.telegramId, subjectId);
      }

      const oldEditors = await txEditorRepo.findBySubjectId(subjectId);
      for (const ed of oldEditors) {
        await txEditorRepo.remove(ed.telegramId, subjectId);
      }

      const maxTicketNumber = sheetRows.length > 0
        ? Math.max(...sheetRows.map((r) => r.ticketNumber))
        : 0;
      await txTicketRepo.removeTicketsExceedingNumber(subjectId, maxTicketNumber);

      const activeStudentIds = new Set<number>();
      const activeEditorIds = new Set<number>();
      const processedNumbers = new Set<number>();

      for (const row of sheetRows) {
        processedNumbers.add(row.ticketNumber);

        const studentId = row.studentFio ? nameToIdMap.get(row.studentFio.toLowerCase().trim()) : undefined;
        const editorId = row.editorFio ? nameToIdMap.get(row.editorFio.toLowerCase().trim()) : undefined;

        const oldTicket = oldTicketsMap.get(row.ticketNumber);

        let nextStatus: TicketStatus | undefined = oldTicket?.status;
        if (!nextStatus && studentId) {
          nextStatus = TicketStatus.IN_PROGRESS;
        }

        const patch = {
          question: row.question,
          studentId: studentId ?? undefined,
          editorId: editorId ?? undefined,
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        };

        if (oldTicket) {
          await txTicketRepo.update(oldTicket.ticketId, patch);
        } else {
          await txTicketRepo.insert({ subjectId, ticketNumber: row.ticketNumber, ...patch });
        }

        if (studentId) activeStudentIds.add(studentId);
        if (editorId) activeEditorIds.add(editorId);
      }

      for (const oldTicket of existingTickets) {
        if (!processedNumbers.has(oldTicket.ticketNumber)) {
          await txTicketRepo.update(oldTicket.ticketId, {
            studentId: undefined,
            editorId: undefined,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      for (const sId of activeStudentIds) {
        await txRegRepo.insert({ telegramId: sId, subjectId });
      }
      for (const eId of activeEditorIds) {
        await txEditorRepo.insert({ telegramId: eId, subjectId });
      }

      const affectedUserIds = new Set<number>([
        ...oldRegs.map((r) => r.telegramId),
        ...oldEditors.map((e) => e.telegramId),
        ...activeStudentIds,
        ...activeEditorIds,
      ]);

      for (const uId of affectedUserIds) {
        const userRegs = await txRegRepo.findByUserId(uId);
        const userEdits = await txEditorRepo.findByUserId(uId);
        await txUserRepo.update(uId, {
          student: userRegs.length > 0 ? 1 : 0,
          editor: userEdits.length > 0 ? 1 : 0,
        });
      }
    });
  }

  /**
   * Обновляет вопросы из Google Sheets и перераспределяет студентов «змейкой»
   * по текущим регистрациям в БД.
   */
  async importWithStudentRedistribution(chiefEditorTelegramId: number, subjectId: number): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);
    await this.syncQuestionsOnlyFromSheet(chiefEditorTelegramId, subjectId);

    const { distributionService } = await import('./DistributionService.js');
    await distributionService.distributeTicketsToStudents(subjectId);
  }

  /**
   * Обновляет вопросы из Google Sheets и пропорционально перераспределяет редакторов
   * по текущему составу редакторов предмета в БД.
   */
  async importWithEditorRedistribution(chiefEditorTelegramId: number, subjectId: number): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);
    await this.syncQuestionsOnlyFromSheet(chiefEditorTelegramId, subjectId);

    const { distributionService } = await import('./DistributionService.js');
    await distributionService.distributeTicketsToEditors(subjectId);
  }

  /**
   * Обновляет вопросы из Google Sheets и полностью перераспределяет
   * как студентов («змейкой»), так и редакторов.
   */
  async importWithFullRedistribution(chiefEditorTelegramId: number, subjectId: number): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);
    await this.syncQuestionsOnlyFromSheet(chiefEditorTelegramId, subjectId);

    const { distributionService } = await import('./DistributionService.js');
    await distributionService.distributeTicketsToStudents(subjectId);
    await distributionService.distributeTicketsToEditors(subjectId);
  }

  // =========================================================================
  // МОНИТОРИНГ СДАЧИ, ВЫГРУЗКА ФАЙЛОВ И РАССЫЛКИ (TICKETING / FINISHED)
  // =========================================================================

  /**
   * Возвращает детальную сводку прогресса сдачи билетов по каждому предмету:
   * общее число билетов и разбивку по статусам (`approved`, `onCheck`, `onRework`, `inProgress`).
   */
  async getTicketingProgressStats(chiefEditorTelegramId: number): Promise<{
    subjectId: number;
    subjectName: string;
    total: number;
    approved: number;
    onCheck: number;
    onRework: number;
    inProgress: number;
  }[]> {
    this.assertAdmin(chiefEditorTelegramId);

    const subjects = await this.subjectRepo.findAll();
    const result = [];

    for (const sub of subjects) {
      const tickets = await this.ticketRepo.findBySubjectIdSorted(sub.subjectId);
      let approved = 0;
      let onCheck = 0;
      let onRework = 0;
      let inProgress = 0;

      for (const t of tickets) {
        switch (t.status) {
          case TicketStatus.APPROVED:
            approved++;
            break;
          case TicketStatus.ON_CHECK:
            onCheck++;
            break;
          case TicketStatus.ON_REWORK:
            onRework++;
            break;
          default:
            inProgress++;
            break;
        }
      }

      result.push({
        subjectId: sub.subjectId,
        subjectName: sub.subjectName,
        total: tickets.length,
        approved,
        onCheck,
        onRework,
        inProgress,
      });
    }

    return result;
  }

  /**
   * Возвращает список путей к существующим на диске файлам решений по выбранному предмету.
   * @param onlyApproved Если `true` — только одобренные (`APPROVED`), иначе все загруженные (`APPROVED` + `ON_CHECK` + `ON_REWORK`).
   */
  async getTicketFilesForSubject(
    chiefEditorTelegramId: number,
    subjectId: number,
    onlyApproved: boolean = true
  ): Promise<{ subjectName: string; files: { ticketNumber: number; filePath: string }[] }> {
    this.assertAdmin(chiefEditorTelegramId);

    const subject = await this.subjectRepo.findById(subjectId);
    if (!subject) {
      throw new Error('Предмет не найден.');
    }

    const tickets = await this.ticketRepo.findBySubjectIdSorted(subjectId);
    const files: { ticketNumber: number; filePath: string }[] = [];

    for (const t of tickets) {
      if (!t.fileVersion || !t.fileExtension) continue;
      if (onlyApproved && t.status !== TicketStatus.APPROVED) continue;

      const filePath = ticketFileStorage.getFilePath(
        subject.subjectName,
        t.ticketNumber,
        t.fileVersion,
        t.fileExtension
      );

      if (existsSync(filePath)) {
        files.push({ ticketNumber: t.ticketNumber, filePath });
      }
    }

    return { subjectName: subject.subjectName, files };
  }

  /**
   * Возвращает массив Telegram ID получателей для массовой рассылки администратора.
   */
  async getBroadcastRecipientIds(
    chiefEditorTelegramId: number,
    audience: 'all' | 'students' | 'editors'
  ): Promise<number[]> {
    this.assertAdmin(chiefEditorTelegramId);

    const allUsers = await this.userRepo.findAll();

    switch (audience) {
      case 'students':
        return allUsers.filter((u) => u.student === 1).map((u) => u.telegramId);
      case 'editors':
        return allUsers.filter((u) => u.editor === 1).map((u) => u.telegramId);
      case 'all':
      default:
        return allUsers.map((u) => u.telegramId);
    }
  }

  /**
   * Возвращает уникальные Telegram ID студентов или редакторов, привязанных к выбранным предметам.
   */
  async getBroadcastRecipientsBySubjects(
    chiefEditorTelegramId: number,
    role: 'students' | 'editors',
    subjectIds: number[]
  ): Promise<number[]> {
    this.assertAdmin(chiefEditorTelegramId);
    if (subjectIds.length === 0) return [];

    const idSet = new Set<number>();

    for (const subId of subjectIds) {
      if (role === 'students') {
        const users = await this.registrationRepo.findUsersBySubjectId(subId);
        users.forEach((u) => idSet.add(u.telegramId));
      } else {
        const editors = await this.editorRepo.findBySubjectId(subId);
        editors.forEach((e) => idSet.add(e.telegramId));
      }
    }

    return Array.from(idSet);
  }

  /**
   * Ищет пользователей по списку запросов (номера из списка 1..N или части ФИО через запятую).
   */
  async resolveBroadcastUsersByQuery(
    chiefEditorTelegramId: number,
    rawInput: string
  ): Promise<{ matched: { telegramId: number; name: string }[]; missed: string[] }> {
    this.assertAdmin(chiefEditorTelegramId);

    const allUsers = await this.userRepo.findAll();
    const tokens = rawInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const matchedMap = new Map<number, { telegramId: number; name: string }>();
    const missed: string[] = [];

    for (const token of tokens) {
      if (/^\d+$/.test(token)) {
        const idx = parseInt(token, 10) - 1;
        if (idx >= 0 && idx < allUsers.length) {
          const u = allUsers[idx];
          matchedMap.set(u.telegramId, { telegramId: u.telegramId, name: u.userName });
        } else {
          missed.push(`№${token}`);
        }
        continue;
      }

      const lower = token.toLowerCase();
      const foundUsers = allUsers.filter((u) => u.userName.toLowerCase().includes(lower));
      if (foundUsers.length > 0) {
        for (const u of foundUsers) {
          matchedMap.set(u.telegramId, { telegramId: u.telegramId, name: u.userName });
        }
      } else {
        missed.push(token);
      }
    }

    return {
      matched: Array.from(matchedMap.values()),
      missed,
    };
  }

  /**
   * Вручную регистрирует нового пользователя в БД по Telegram ID и ФИО
   * без привязки к предметам и без перераспределения билетов.
   */
  async addManualUser(
    chiefEditorTelegramId: number,
    targetTelegramId: number,
    fullName: string
  ): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);

    const existing = await this.userRepo.findById(targetTelegramId);
    if (existing) {
      throw new Error(`Пользователь с ID ${targetTelegramId} уже есть в базе (${existing.userName}).`);
    }

    await this.userRepo.insert({
      telegramId: targetTelegramId,
      userName: fullName.trim(),
      registeredAt: new Date().toISOString(),
      student: 0,
      editor: 0,
      chiefEditor: this.isAdmin(targetTelegramId) ? 1 : 0,
      missedDeadlines: 0,
    });
  }

  /**
   * Возвращает путь к файлу журнала обратной связи (`./data/feedback.md`), если он существует.
   */
  getFeedbackFilePath(chiefEditorTelegramId: number): string {
    this.assertAdmin(chiefEditorTelegramId);

    const filePath = feedbackStorage.getFilePath();
    if (!existsSync(filePath)) {
      throw new Error('Журнал обратной связи пока пуст (обращений ещё не было).');
    }

    return filePath;
  }

  /**
   * Формирует полный ZIP-бэкап базы данных и директории `data/`.
   */
  async createFullBackup(chiefEditorTelegramId: number): Promise<string> {
    this.assertAdmin(chiefEditorTelegramId);
    return ticketFileStorage.createFullBackupArchive();
  }

  // =========================================================================
  // УПРАВЛЕНИЕ ПРОМЕЖУТОЧНЫМИ ДЕДЛАЙНАМИ И МЕТКАМИ ПРОСРОЧЕК
  // =========================================================================

  /**
   * Возвращает всю шкалу дедлайнов, текущие настройки тумблеров и список должников ближайшего этапа.
   */
  async getCheckpointsOverview(chiefEditorTelegramId: number): Promise<{
    timeline: TimelinePoint[];
    settings: { autoRemind: boolean; autoPenalize: boolean };
    nextPoint: TimelinePoint | null;
    currentDebtors: CheckpointDebtor[];
  }> {
    this.assertAdmin(chiefEditorTelegramId);

    const timeline = await checkpointService.getTimeline();
    const settings = await checkpointService.getSettings();
    const { point: nextPoint, debtors: currentDebtors } = await checkpointService.getNextActiveCheckpointStatus();

    return { timeline, settings, nextPoint, currentDebtors };
  }

  /**
   * Добавляет новый промежуточный дедлайн (ISO-строка, обычно 23:00 МСК / 20:00 UTC).
   */
  async addCheckpoint(chiefEditorTelegramId: number, isoDeadline: string): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);
    await checkpointRepository.insert({ deadlineAt: isoDeadline });
  }

  /**
   * Удаляет промежуточный дедлайн по его ID.
   */
  async removeCheckpoint(chiefEditorTelegramId: number, checkpointId: number): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);
    await checkpointRepository.remove(checkpointId);
  }

  /**
   * Переключает автоматические напоминания (`autoRemind`) или авто-фиксацию просрочек (`autoPenalize`).
   */
  async toggleCheckpointSetting(
    chiefEditorTelegramId: number,
    key: 'autoRemind' | 'autoPenalize'
  ): Promise<{ autoRemind: boolean; autoPenalize: boolean }> {
    this.assertAdmin(chiefEditorTelegramId);
    return checkpointService.toggleSetting(key);
  }

  /**
   * Изменяет счётчик пропущенных дедлайнов (`missed_deadlines`) у студента на `delta` (+1 или -1, не ниже 0).
   */
  async adjustUserMissedDeadlines(
    chiefEditorTelegramId: number,
    targetTelegramId: number,
    delta: number
  ): Promise<number> {
    this.assertAdmin(chiefEditorTelegramId);

    const user = await this.userRepo.findById(targetTelegramId);
    if (!user) throw new Error('Пользователь не найден.');

    const nextValue = Math.max(0, (user.missedDeadlines ?? 0) + delta);
    await this.userRepo.update(targetTelegramId, { missedDeadlines: nextValue });
    return nextValue;
  }

  /**
   * Возвращает список всех активных студентов с их текущим количеством пропущенных дедлайнов
   * (отсортировано по убыванию пропусков).
   */
  async getStudentsMissesList(chiefEditorTelegramId: number): Promise<{
    telegramId: number;
    userName: string;
    missedDeadlines: number;
  }[]> {
    this.assertAdmin(chiefEditorTelegramId);

    const users = await this.userRepo.findAll();
    return users
      .filter((u) => u.student === 1)
      .map((u) => ({
        telegramId: u.telegramId,
        userName: u.userName,
        missedDeadlines: u.missedDeadlines ?? 0,
      }))
      .sort((a, b) => b.missedDeadlines - a.missedDeadlines || a.userName.localeCompare(b.userName));
  }

  /**
   * Ручное отчисление (дисквалификация) студента администратором:
   * - Все билеты студента (включая уже сданные и принятые) временно передаются
   *   соответствующему редактору (`studentId = ticket.editorId`, если это не сам отчисляемый,
   *   иначе другому редактору предмета или оставляются свободными для ручного назначения).
   * - Редактору добавляется регистрация на предмет и флаг `student = 1`, чтобы он видел эти билеты в `/user`.
   * - У отчисленного студента удаляются регистрации на предметы и сбрасывается флаг `student = 0`
   *   (права редактора `/editor` при наличии сохраняются).
   * - Затронутые листы Google Sheets автоматически обновляются.
   */
  async expelStudent(
    chiefEditorTelegramId: number,
    targetTelegramId: number
  ): Promise<{ userName: string; transferredCount: number }> {
    this.assertAdmin(chiefEditorTelegramId);

    const targetUser = await this.userRepo.findById(targetTelegramId);
    if (!targetUser) {
      throw new Error('Пользователь не найден.');
    }

    const result = await db.transaction().execute(async (trx) => {
      const txTicketRepo = this.ticketRepo.withTransaction(trx);
      const txRegRepo = this.registrationRepo.withTransaction(trx);
      const txEditorRepo = this.editorRepo.withTransaction(trx);
      const txUserRepo = this.userRepo.withTransaction(trx);
      const txSubjectRepo = this.subjectRepo.withTransaction(trx);

      const allSubjects = await txSubjectRepo.findAll();
      let transferredCount = 0;
      const editorsToActivate = new Set<string>(); // "editorId:subjectId"
      const affectedSubjectIds = new Set<number>();

      for (const sub of allSubjects) {
        const tickets = await txTicketRepo.findBySubjectIdSorted(sub.subjectId);
        const subjectEditors = await txEditorRepo.findBySubjectId(sub.subjectId);
        const fallbackEditor = subjectEditors.find((e) => e.telegramId !== targetTelegramId);

        for (const t of tickets) {
          if (t.studentId !== targetTelegramId) continue;

          affectedSubjectIds.add(sub.subjectId);

          const receiverEditorId =
            t.editorId && t.editorId !== targetTelegramId
              ? t.editorId
              : fallbackEditor?.telegramId;

          if (receiverEditorId) {
            await txTicketRepo.update(t.ticketId, {
              studentId: receiverEditorId,
              status: t.status ?? TicketStatus.IN_PROGRESS,
              updatedAt: new Date().toISOString(),
            });
            editorsToActivate.add(`${receiverEditorId}:${sub.subjectId}`);
          } else {
            await txTicketRepo.update(t.ticketId, {
              studentId: undefined,
              updatedAt: new Date().toISOString(),
            });
          }
          transferredCount++;
        }
      }

      const oldRegs = await txRegRepo.findByUserId(targetTelegramId);
      for (const r of oldRegs) {
        await txRegRepo.remove(targetTelegramId, r.subjectId);
      }
      await txUserRepo.update(targetTelegramId, { student: 0 });

      for (const pair of editorsToActivate) {
        const [edIdStr, subIdStr] = pair.split(':');
        const edId = parseInt(edIdStr, 10);
        const subId = parseInt(subIdStr, 10);

        const existingReg = await txRegRepo.findByUserAndSubject(edId, subId);
        if (!existingReg) {
          await txRegRepo.insert({ telegramId: edId, subjectId: subId });
        }
        await txUserRepo.update(edId, { student: 1 });
      }

      const uniqueEditorIds = Array.from(
        new Set(Array.from(editorsToActivate).map((p) => parseInt(p.split(':').at(0)!, 10)))
      );

      return {
        userName: targetUser.userName,
        transferredCount,
        editorIds: uniqueEditorIds,
        affectedSubjectIds: Array.from(affectedSubjectIds),
      };
    });

    for (const subId of result.affectedSubjectIds) {
      await this.syncSubjectAssignmentsToSheet(subId);
    }

    await bot.api
      .sendMessage(
        targetTelegramId,
        `⛔ *Вы отчислены (дисквалифицированы) из подготовки билетов* решением администратора.\n\n` +
        `Все ваши билеты (${result.transferredCount} шт.) переданы редакторам. Доступ к разделу /user закрыт.`,
        { parse_mode: 'Markdown' }
      )
      .catch(() => {});

    for (const edId of result.editorIds) {
      if (edId === targetTelegramId) continue;
      await bot.api
        .sendMessage(
          edId,
          `📥 *Временное назначение билетов:*\n\n` +
          `Участник *${result.userName}* был дисквалифицирован. Его билеты по вашему предмету временно переведены на вас (доступны в меню /user) до переназначения администратором.`,
          { parse_mode: 'Markdown' }
        )
        .catch(() => {});
    }

    return {
      userName: result.userName,
      transferredCount: result.transferredCount,
    };
  }

  // =========================================================================
  // РУЧНОЕ УПРАВЛЕНИЕ БИЛЕТАМИ И НАЗНАЧЕНИЯМИ (TICKETING / FINISHED)
  // =========================================================================

  /**
   * Возвращает список всех билетов выбранного предмета с ФИО назначенных студентов
   * для просмотра и ручного управления администратором.
   */
  async getSubjectTicketsForAdmin(
    chiefEditorTelegramId: number,
    subjectId: number
  ): Promise<{
    ticketId: number;
    ticketNumber: number;
    question: string;
    studentName: string | null;
    status?: TicketStatus;
  }[]> {
    this.assertAdmin(chiefEditorTelegramId);

    const tickets = await this.ticketRepo.findBySubjectIdSorted(subjectId);
    const allUsers = await this.userRepo.findAll();
    const usersMap = new Map(allUsers.map((u) => [u.telegramId, u.userName]));

    return tickets.map((t) => ({
      ticketId: t.ticketId,
      ticketNumber: t.ticketNumber,
      question: t.question,
      studentName: t.studentId ? (usersMap.get(t.studentId) || `ID ${t.studentId}`) : null,
      status: t.status,
    }));
  }

  /**
   * Возвращает полную карточку конкретного билета для администратора
   * (включая ФИО студента и ФИО редактора).
   */
  async getTicketDetailsForAdmin(
    chiefEditorTelegramId: number,
    ticketId: number
  ): Promise<(TicketWithSubjectView & { editorName?: string | null }) | null> {
    this.assertAdmin(chiefEditorTelegramId);

    const ticket = await ticketViewRepository.findByTicketId(ticketId);
    if (!ticket) return null;

    let editorName: string | null = null;
    if (ticket.editorId) {
      const editorUser = await this.userRepo.findById(ticket.editorId);
      editorName = editorUser ? editorUser.userName : `ID ${ticket.editorId}`;
    }

    return { ...ticket, editorName };
  }

  /**
   * Переназначает студента на конкретный билет (по `newStudentId`, либо снимает привязку при `null`).
   * Автоматически обеспечивает регистрацию нового студента на этот предмет и флаг `student = 1`.
   */
  async reassignTicketStudent(
    chiefEditorTelegramId: number,
    ticketId: number,
    newStudentId: number | null
  ): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);

    const ticket = await this.ticketRepo.findById(ticketId);
    if (!ticket) throw new Error('Билет не найден.');

    await db.transaction().execute(async (trx) => {
      const txTicketRepo = this.ticketRepo.withTransaction(trx);
      const txRegRepo = this.registrationRepo.withTransaction(trx);
      const txUserRepo = this.userRepo.withTransaction(trx);

      if (newStudentId === null) {
        await txTicketRepo.update(ticketId, {
          studentId: undefined,
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      const targetUser = await txUserRepo.findById(newStudentId);
      if (!targetUser) throw new Error('Выбранный пользователь не найден в БД.');

      await txTicketRepo.update(ticketId, {
        studentId: newStudentId,
        status: ticket.status ?? TicketStatus.IN_PROGRESS,
        updatedAt: new Date().toISOString(),
      });

      const existingReg = await txRegRepo.findByUserAndSubject(newStudentId, ticket.subjectId);
      if (!existingReg) {
        await txRegRepo.insert({ telegramId: newStudentId, subjectId: ticket.subjectId });
      }
      await txUserRepo.update(newStudentId, { student: 1 });
    });

    await this.syncSubjectAssignmentsToSheet(ticket.subjectId);
  }

  /**
   * Переназначает проверяющего редактора на конкретный билет (по `newEditorId`, либо снимает при `null`).
   * Автоматически добавляет привязку к предмету в `editors_for_subjects` и флаг `editor = 1`.
   */
  async reassignTicketEditor(
    chiefEditorTelegramId: number,
    ticketId: number,
    newEditorId: number | null
  ): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);

    const ticket = await this.ticketRepo.findById(ticketId);
    if (!ticket) throw new Error('Билет не найден.');

    await db.transaction().execute(async (trx) => {
      const txTicketRepo = this.ticketRepo.withTransaction(trx);
      const txEditorRepo = this.editorRepo.withTransaction(trx);
      const txUserRepo = this.userRepo.withTransaction(trx);

      if (newEditorId === null) {
        await txTicketRepo.update(ticketId, {
          editorId: undefined,
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      const targetUser = await txUserRepo.findById(newEditorId);
      if (!targetUser) throw new Error('Выбранный пользователь не найден в БД.');

      await txTicketRepo.update(ticketId, {
        editorId: newEditorId,
        updatedAt: new Date().toISOString(),
      });

      const existingEd = await txEditorRepo.findByUserAndSubject(newEditorId, ticket.subjectId);
      if (!existingEd) {
        await txEditorRepo.insert({ telegramId: newEditorId, subjectId: ticket.subjectId });
      }
      await txUserRepo.update(newEditorId, { editor: 1 });
    });

    await this.syncSubjectAssignmentsToSheet(ticket.subjectId);
  }

  /**
   * Принудительно устанавливает статус билета администратором (`APPROVED` или `IN_PROGRESS`)
   * и синхронизирует цвет ячейки в Google Sheets.
   */
  async forceSetTicketStatus(
    chiefEditorTelegramId: number,
    ticketId: number,
    status: TicketStatus.APPROVED | TicketStatus.IN_PROGRESS
  ): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);

    const ticketView = await ticketViewRepository.findByTicketId(ticketId);
    if (!ticketView) throw new Error('Билет не найден.');

    await this.ticketRepo.update(ticketId, {
      status,
      updatedAt: new Date().toISOString(),
    });

    await this.ticketSheetRepo
      .updateTicketCellColor(ticketView.subjectName, ticketView.ticketNumber, status)
      .catch((err) => console.error('Ошибка покраски ячейки в Sheets:', err));
  }

  /**
   * Синхронизирует колонки C (студенты) и D (редакторы с объединением ячеек)
   * выбранного предмета из SQLite в Google Sheets, не затрагивая цвета ячеек.
   */
  private async syncSubjectAssignmentsToSheet(subjectId: number): Promise<void> {
    const subject = await this.subjectRepo.findById(subjectId);
    if (!subject) return;

    const tickets = await this.ticketRepo.findBySubjectIdSorted(subjectId);
    const allUsers = await this.userRepo.findAll();
    const usersMap = new Map(allUsers.map((u) => [u.telegramId, u.userName]));

    const studentAssignments: { ticketNumber: number; studentFio: string }[] = [];
    const editorAssignments: { ticketNumber: number; editorFio: string }[] = [];

    for (const t of tickets) {
      if (t.studentId && usersMap.has(t.studentId)) {
        studentAssignments.push({ ticketNumber: t.ticketNumber, studentFio: usersMap.get(t.studentId)! });
      }
      if (t.editorId && usersMap.has(t.editorId)) {
        editorAssignments.push({ ticketNumber: t.ticketNumber, editorFio: usersMap.get(t.editorId)! });
      }
    }

    await this.ticketSheetRepo
      .saveAssignedStudents(subject.subjectName, studentAssignments)
      .catch((err) => console.error('Ошибка синхронизации студентов в Sheets:', err));

    await this.ticketSheetRepo
      .saveAssignedEditors(subject.subjectName, editorAssignments)
      .catch((err) => console.error('Ошибка синхронизации редакторов в Sheets:', err));
  }
}

export const chiefEditorService = new ChiefEditorService();
