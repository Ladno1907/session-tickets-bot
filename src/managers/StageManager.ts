import { Bot } from 'grammy';
import { config } from '../config.js';
import { MyContext } from '../types/context.js';
import { messageManager } from './MessageManager.js';
import { ProcessConfigRepository } from '../database/repositories/ProcessConfigRepo.js';
import { ProcessConfig, ProcessStage } from '../types/entities.js';
import { distributionService } from '../services/DistributionService.js';

/**
 * Менеджер жизненного цикла и этапов подготовки сессии (`PREPARATION -> REGISTRATION -> DISTRIBUTION -> TICKETING -> FINISHED`).
 * Отвечает за проверку дедлайнов, защиту от параллельных переходов и запуск каскадных триггеров при смене стадий.
 */
export class StageManager {
  private isTransitioning = false;

  constructor(
    private processConfigRepository: ProcessConfigRepository = new ProcessConfigRepository(),
  ) {}

  // =========================================================================
  // ОПРЕДЕЛЕНИЕ И ПЕРЕКЛЮЧЕНИЕ ЭТАПОВ
  // =========================================================================

  /**
   * Быстро вычисляет актуальный этап процесса на основе дедлайнов и сохранённого статуса в БД.
   */
  public async getCurrentStageFast(): Promise<ProcessStage> {
    const configData = await this.processConfigRepository.findGlobalConfig();
    if (!configData) {
      console.warn('StageManager: Конфигурация процесса не найдена, возвращаем PREPARATION.');
      return ProcessStage.PREPARATION;
    }

    return this.determineCurrentStage(configData);
  }

  /**
   * Проверяет наступление дедлайнов и последовательно переводит систему на целевой этап,
   * выполняя триггеры каждого промежуточного перехода под блокировкой `isTransitioning`.
   */
  public async checkAndTransition(bot: Bot<MyContext>): Promise<void> {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    try {
      let configData = await this.processConfigRepository.findGlobalConfig();
      if (!configData) {
        configData = await this.processConfigRepository.insertDefaultIfNotExists();
      }

      const targetStage = this.determineCurrentStage(configData);
      let currentStage = configData.currentStage;

      while (currentStage !== targetStage) {
        const nextStage = this.getNextStage(currentStage);
        if (!nextStage) break;

        console.log(`StageManager: Переход "${currentStage}" -> "${nextStage}".`);
        await this.executeTransitionEffects(currentStage, nextStage, bot);
        await this.processConfigRepository.update({ currentStage: nextStage });
        currentStage = nextStage;
      }
    } finally {
      this.isTransitioning = false;
    }
  }

  /**
   * Запускает фоновый периодический таймер проверки дедлайнов с интервалом `config.checkInterval`.
   */
  public startPeriodicCheck(bot: Bot<MyContext>): void {
    const check = async () => {
      try {
        await this.checkAndTransition(bot);
      } catch (e) {
        console.error('StageManager: Ошибка выполнения периодической проверки:', e);
      }
      setTimeout(check, config.checkInterval);
    };
    setTimeout(check, config.checkInterval);
  }

  /**
   * Возвращает следующий по порядку этап жизненного цикла или `null`, если процесс завершён.
   */
  public getNextStage(currentStage: ProcessStage): ProcessStage | null {
    switch (currentStage) {
      case ProcessStage.PREPARATION: return ProcessStage.REGISTRATION;
      case ProcessStage.REGISTRATION: return ProcessStage.DISTRIBUTION;
      case ProcessStage.DISTRIBUTION: return ProcessStage.TICKETING;
      case ProcessStage.TICKETING: return ProcessStage.FINISHED;
      case ProcessStage.FINISHED: return null;
      default:
        console.warn(`Неизвестный текущий этап: ${currentStage}, не могу определить следующий.`);
        return null;
    }
  }

  // =========================================================================
  // КАСКАДНЫЕ ТРИГГЕРЫ ПРИ СМЕНЕ ЭТАПОВ
  // =========================================================================

  /**
   * Выполняет бизнес-логику и рассылки при переходе с `oldStage` на `newStage`.
   */
  public async executeTransitionEffects(
    oldStage: ProcessStage,
    newStage: ProcessStage,
    bot: Bot<MyContext>
  ): Promise<void> {
    console.log(`StageManager: Выполнение триггеров перехода ${oldStage} -> ${newStage}`);

    if (oldStage === ProcessStage.PREPARATION && newStage === ProcessStage.REGISTRATION) {
      await messageManager.refreshMenuForUsers(
        bot,
        newStage,
        config.chiefEditorIds,
        '🚀 Этап регистрации запущен! Панели администраторов автоматически обновлены.'
      );
    }

    if (oldStage === ProcessStage.REGISTRATION && newStage === ProcessStage.DISTRIBUTION) {
      console.log('StageManager: [TRIGGER] Старт автоматического расчета ведомостей...');

      await messageManager.removeAllUserMenus(bot);
      await distributionService.distributeTicketsToStudents();
      await distributionService.distributeTicketsToEditors();

      await messageManager.refreshMenuForUsers(
        bot,
        newStage,
        config.chiefEditorIds,
        '📊 Этап регистрации завершен. Система автоматически распределила билеты «змейкой» среди студентов и закрепила их за редакторами!'
      );
    }

    if (oldStage === ProcessStage.DISTRIBUTION && newStage === ProcessStage.TICKETING) {
      console.log('StageManager: [TRIGGER] Запуск каскадной очистки незаписанных участников...');

      await distributionService.cleanupDeadUsersAndSessions();

      await messageManager.refreshAllMainMenus(
        bot,
        newStage,
        '🚀 *Этап подготовки и сдачи билетов официально начался!*\n\n' +
        'Вам выданы ваши билеты. Зайдите в меню /user для просмотра вопросов и сдачи файлов решений.'
      );
    }

    if (oldStage === ProcessStage.TICKETING && newStage === ProcessStage.FINISHED) {
      console.log('StageManager: [TRIGGER] Окончание этапа сдачи билетов.');

      await messageManager.refreshAllMainMenus(
        bot,
        newStage,
        '🏁 *Прием файлов ответов закрыт!* Все билеты зафиксированы на проверку, сессия официально завершена.'
      );
    }
  }

  // =========================================================================
  // ВСПОМОГАТЕЛЬНЫЕ ПРИВАТНЫЕ МЕТОДЫ
  // =========================================================================

  /**
   * Вычисляет целевой этап по текущему времени и установленным дедлайнам.
   */
  private determineCurrentStage(configData: ProcessConfig): ProcessStage {
    const now = new Date();
    const regEnd = this.parseDeadlineMsk23(configData.registrationEnd);
    const distEnd = this.parseDeadlineMsk23(configData.distributionEnd);
    const tickEnd = this.parseDeadlineMsk23(configData.ticketingEnd);

    if (tickEnd && now >= tickEnd) return ProcessStage.FINISHED;
    if (distEnd && now >= distEnd) return ProcessStage.TICKETING;
    if (regEnd && now >= regEnd) return ProcessStage.DISTRIBUTION;

    return configData.currentStage;
  }

  /**
   * Парсит ISO-дату дедлайна; если указана полночь UTC (`00:00`), интерпретирует её как `23:00` МСК (`20:00` UTC).
   */
  private parseDeadlineMsk23(isoStr?: string): Date | null {
    if (!isoStr) return null;
    const d = new Date(isoStr);
    if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
      d.setUTCHours(20, 0, 0, 0);
    }
    return d;
  }
}

export const stageManager = new StageManager();
