import { Bot } from 'grammy';
import { db } from '../database/client.js';
import { bot } from '../bot.js';
import { MyContext } from '../types/context.js';
import { ProcessConfig, ProcessStage } from '../types/entities.js';
import { ParsedSubjectRow } from '../types/sheets.js';
import { config } from '../config.js';

import { stageManager } from '../managers/StageManager.js';
import { userRepository } from '../database/repositories/UserRepo.js';
import { editorRepository } from '../database/repositories/EditorRepo.js';
import { ticketRepository } from '../database/repositories/TicketRepo.js';
import { processConfigRepository } from '../database/repositories/ProcessConfigRepo.js';
import { subjectRepository } from '../database/repositories/SubjectRepo.js';
import { editorRequestRepository } from '../database/repositories/EditorRequestRepo.js';
import { ticketSheetRepository } from '../database/sheetRepositories/TicketSheetRepository.js';
import { registrationRepository } from '../database/repositories/RegistrationRepo.js';

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
   * Выгружает текущее распределение студентов и редакторов из SQLite в лист Google Sheets.
   */
  async exportLocalDataToSheet(chiefEditorTelegramId: number, subjectId: number): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);
    
    const subject = await this.subjectRepo.findById(subjectId);
    if (!subject) throw new Error('Предмет не найден.');

    const tickets = await this.ticketRepo.findBySubjectIdSorted(subjectId);
    if (tickets.length === 0) return;

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

    await this.ticketSheetRepo.saveAssignedStudents(subject.subjectName, studentAssignments);
    await this.ticketSheetRepo.saveAssignedEditors(subject.subjectName, editorAssignments);
  }

  /**
   * Импортирует вопросы, назначенных студентов и редакторов «как есть» из листа Google Sheets в SQLite.
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

      const maxTicketNumber = sheetRows.length > 0
        ? Math.max(...sheetRows.map((r) => r.ticketNumber))
        : 0;

      await txTicketRepo.removeTicketsExceedingNumber(subjectId, maxTicketNumber);

      for (const row of sheetRows) {
        const studentId = row.studentFio ? nameToIdMap.get(row.studentFio.toLowerCase().trim()) : undefined;
        const editorId = row.editorFio ? nameToIdMap.get(row.editorFio.toLowerCase().trim()) : undefined;

        const existingTicket = await txTicketRepo.findBySubjectAndNumber(subjectId, row.ticketNumber);

        const patch = {
          question: row.question,
          studentId: studentId ?? undefined,
          editorId: editorId ?? undefined,
          updatedAt: new Date().toISOString(),
        };

        if (existingTicket) {
          await txTicketRepo.update(existingTicket.ticketId, patch);
        } else {
          await txTicketRepo.insert({ subjectId, ticketNumber: row.ticketNumber, ...patch });
        }

        if (studentId) {
          try { await txRegRepo.insert({ telegramId: studentId, subjectId }); } catch {}
          await txUserRepo.update(studentId, { student: 1 });
        }

        if (editorId) {
          try { await txEditorRepo.insert({ telegramId: editorId, subjectId }); } catch {}
          await txUserRepo.update(editorId, { editor: 1 });
        }
      }
    });
  }

  /**
   * Импортирует данные из Google Sheets и запускает перераспределение студентов «змейкой».
   */
  async importWithStudentRedistribution(chiefEditorTelegramId: number, subjectId: number): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);
    
    await this.importDataAsIsFromSheet(chiefEditorTelegramId, subjectId);
    
    const { distributionService } = await import('./DistributionService.js');
    await distributionService.distributeTicketsToStudents();
  }

  /**
   * Импортирует данные из Google Sheets и запускает пропорциональное перераспределение редакторов.
   */
  async importWithEditorRedistribution(chiefEditorTelegramId: number, subjectId: number): Promise<void> {
    this.assertAdmin(chiefEditorTelegramId);
    
    await this.importDataAsIsFromSheet(chiefEditorTelegramId, subjectId);
    
    const { distributionService } = await import('./DistributionService.js');
    await distributionService.distributeTicketsToEditors();
  }
}

export const chiefEditorService = new ChiefEditorService();
