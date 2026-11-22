import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { config } from '../config.js';
import { MyContext } from '../types/context.js';
import { ProcessStage, User } from '../types/entities.js';
import { UserMainMenuStateRepository } from '../database/repositories/UserMainMenuStateRepo.js';
import { UserRepository } from '../database/repositories/UserRepo.js';

/**
 * Менеджер интерактивных сообщений и массовых рассылок в Telegram.
 * Отвечает за паттерн «одного окна» (редактирование/удаление старых меню),
 * генерацию адаптивных уведомлений при смене этапов и пакетную отправку медиа.
 */
export class MessageManager {
  constructor(
    private readonly userMainMenuStateRepository: UserMainMenuStateRepository = new UserMainMenuStateRepository(),
    private readonly userRepository: UserRepository = new UserRepository(),
  ) {}

  // =========================================================================
  // УПРАВЛЕНИЕ ГЛАВНЫМ МЕНЮ ПОЛЬЗОВАТЕЛЯ (SINGLE-WINDOW UI)
  // =========================================================================

  /**
   * Отображает или обновляет единственное активное сообщение меню пользователя в личном чате.
   * Если передан `documentPath`, старое сообщение удаляется и отправляется документ с подписью.
   */
  public async manageMainMenu(
    ctx: MyContext,
    text: string,
    keyboard?: InlineKeyboard,
    forceNew: boolean = false,
    documentPath?: string
  ): Promise<void> {
    if (!ctx.chat || ctx.chat.type !== 'private') return;

    const telegramId = ctx.chat.id;
    const nowIsoString = new Date().toISOString();
    let existingState = await this.userMainMenuStateRepository.findByUserId(telegramId);

    if (documentPath) {
      forceNew = true;
    }

    if (existingState && !forceNew) {
      try {
        await ctx.api.editMessageText(
          existingState.telegramId,
          existingState.messageId,
          text,
          { reply_markup: keyboard, parse_mode: 'Markdown' }
        );
        await this.userMainMenuStateRepository.updateByUserId(telegramId, { lastUpdated: nowIsoString });
        return;
      } catch (editError: any) {
        const errorDesc = editError?.description || '';
        if (errorDesc.includes('message is not modified')) {
          await this.userMainMenuStateRepository.updateByUserId(telegramId, { lastUpdated: nowIsoString });
          return;
        }
        await this.userMainMenuStateRepository.removeByUserId(telegramId);
        existingState = null;
      }
    }

    if (existingState) {
      try {
        await ctx.api.deleteMessage(existingState.telegramId, existingState.messageId);
      } catch {}
      await this.userMainMenuStateRepository.removeByUserId(telegramId);
    }

    const sentMessage = documentPath
      ? await ctx.replyWithDocument(new InputFile(documentPath), {
          caption: text,
          reply_markup: keyboard,
          parse_mode: 'Markdown',
        })
      : await ctx.reply(text, {
          reply_markup: keyboard,
          parse_mode: 'Markdown',
        });

    if (sentMessage?.message_id) {
      await this.userMainMenuStateRepository.insert({
        telegramId,
        messageId: sentMessage.message_id,
        lastUpdated: nowIsoString,
      });
    }
  }

  /**
   * Удаляет активное сообщение главного меню у конкретного пользователя и очищает запись в БД.
   */
  public async removeMainMenuForUser(bot: Bot<MyContext>, telegramId: number): Promise<boolean> {
    try {
      const existingState = await this.userMainMenuStateRepository.findByUserId(telegramId);
      if (!existingState) return true;

      try {
        await bot.api.deleteMessage(telegramId, existingState.messageId);
      } catch {}

      await this.userMainMenuStateRepository.removeByUserId(telegramId);
      return true;
    } catch (error) {
      console.error(`MessageManager: Ошибка удаления меню для ${telegramId}:`, error);
      return false;
    }
  }

  /**
   * Удаляет сообщения главного меню у всех обычных пользователей (кроме главных редакторов).
   */
  public async removeAllUserMenus(bot: Bot<MyContext>): Promise<void> {
    const allStates = await this.userMainMenuStateRepository.findAll();
    for (const state of allStates) {
      if (config.chiefEditorIds.includes(state.telegramId)) continue;
      await this.removeMainMenuForUser(bot, state.telegramId);
      await new Promise((resolve) => setTimeout(resolve, config.delayMs));
    }
  }

  /**
   * Зачищает «осиротевшие» (без пользователя в БД) и устаревшие записи активных меню.
   */
  public async cleanupOldOrphanedMenus(bot: Bot<MyContext>): Promise<number> {
    let totalRemoved = 0;

    try {
      const orphanedBefore = await this.userMainMenuStateRepository.findOrphaned();
      const orphanedCount = orphanedBefore.length;

      for (const state of orphanedBefore) {
        try {
          await bot.api.deleteMessage(state.telegramId, state.messageId);
        } catch {}

        await this.userMainMenuStateRepository.removeByUserId(state.telegramId);
      }

      if (orphanedCount > 0) {
        console.log(`MessageManager: Успешно зачищено осиротевших меню: ${orphanedCount}`);
      }
      totalRemoved += orphanedCount;
    } catch (error) {
      console.error('MessageManager: Ошибка при удалении осиротевших записей меню:', error);
    }

    try {
      const cutoffDate = new Date(Date.now() - config.maxMessageAgeMs);
      const cutoffDateStr = cutoffDate.toISOString();

      const oldBefore = await this.userMainMenuStateRepository.findOlderThan(cutoffDateStr);
      const oldCount = oldBefore.length;

      for (const state of oldBefore) {
        await this.removeMainMenuForUser(bot, state.telegramId);
      }
      totalRemoved += oldCount;
    } catch (error) {
      console.error('MessageManager: Ошибка при удалении устаревших записей:', error);
    }

    return totalRemoved;
  }

  // =========================================================================
  // АДАПТИВНЫЕ УВЕДОМЛЕНИЯ ПРИ ПЕРЕКЛЮЧЕНИИ ЭТАПОВ
  // =========================================================================

  /**
   * Формирует персонализированный текст уведомления со списком доступных пользователю команд
   * в зависимости от его ролей (`chiefEditor`, `editor`, `student`) и текущего этапа.
   */
  public buildAdaptiveMenuText(user: User, stage: ProcessStage, customNotice?: string): string {
    let text = `🔔 *Обновление статуса системы!*\n`;
    if (customNotice) {
      text += `\n${customNotice}\n`;
    }

    text += `\n📋 *Доступные вам разделы и команды:*`;

    let hasCommands = false;

    if (user.chiefEditor === 1) {
      text += `\n• *Панель управления сессией:* Нажмите /admin`;
      hasCommands = true;
    }

    if (user.editor === 1 && stage !== ProcessStage.PREPARATION && stage !== ProcessStage.REGISTRATION) {
      text += `\n• *Проверка решений (Редактор):* Нажмите /editor`;
      hasCommands = true;
    }

    if (stage === ProcessStage.REGISTRATION) {
      text += `\n• *Управление профилем и предметами:* Нажмите /user`;
      hasCommands = true;
    } else if (
      (stage === ProcessStage.DISTRIBUTION || stage === ProcessStage.TICKETING || stage === ProcessStage.FINISHED) &&
      user.student === 1
    ) {
      text += `\n• *Ваш личный кабинет и сдача билетов:* Нажмите /user`;
      hasCommands = true;
    }

    if (!hasCommands) {
      text += `\n_Сейчас для вас нет активных действий. Ожидайте распоряжений администратора._`;
    }

    return text;
  }

  /**
   * Пересоздаёт сообщение меню с адаптивным текстом для указанного списка Telegram ID.
   */
  public async refreshMenuForUsers(
    bot: Bot<MyContext>,
    currentStage: ProcessStage,
    userIds: number[],
    noticeText?: string
  ): Promise<void> {
    for (const userId of userIds) {
      try {
        const existingState = await this.userMainMenuStateRepository.findByUserId(userId);
        if (existingState) {
          try {
            await bot.api.deleteMessage(userId, existingState.messageId);
          } catch {}
          await this.userMainMenuStateRepository.removeByUserId(userId);
        }

        const user = await this.userRepository.findById(userId);
        if (!user) continue;

        const text = this.buildAdaptiveMenuText(user, currentStage, noticeText);
        const sentMessage = await bot.api.sendMessage(userId, text, { parse_mode: 'Markdown' });

        if (sentMessage?.message_id) {
          await this.userMainMenuStateRepository.insert({
            telegramId: userId,
            messageId: sentMessage.message_id,
            lastUpdated: new Date().toISOString(),
          });
        }
      } catch (error) {
        console.error(`MessageManager: Ошибка принудительного обновления для ${userId}:`, error);
        await this.userMainMenuStateRepository.removeByUserId(userId);
      }
      await new Promise((resolve) => setTimeout(resolve, config.delayMs));
    }
  }

  /**
   * Массово обновляет сообщения меню с адаптивным текстом для всех пользователей в БД.
   */
  public async refreshAllMainMenus(
    bot: Bot<MyContext>,
    currentStage: ProcessStage,
    customNotice?: string
  ): Promise<void> {
    try {
      const allUsers = await this.userRepository.findAll();

      for (const user of allUsers) {
        try {
          const existingState = await this.userMainMenuStateRepository.findByUserId(user.telegramId);
          if (existingState) {
            try {
              await bot.api.deleteMessage(user.telegramId, existingState.messageId);
            } catch {}
            await this.userMainMenuStateRepository.removeByUserId(user.telegramId);
          }

          const text = this.buildAdaptiveMenuText(user, currentStage, customNotice);
          const sentMessage = await bot.api.sendMessage(user.telegramId, text, {
            parse_mode: 'Markdown',
          });

          if (sentMessage?.message_id) {
            await this.userMainMenuStateRepository.insert({
              telegramId: user.telegramId,
              messageId: sentMessage.message_id,
              lastUpdated: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error(`MessageManager: Ошибка отправки нового сообщения для пользователя ${user.telegramId}:`, error);
        }
        await new Promise((resolve) => setTimeout(resolve, config.delayMs));
      }
    } catch (fetchError) {
      console.error('MessageManager: Ошибка при получении списка всех пользователей:', fetchError);
    }
  }

  /**
   * Принудительно заменяет главное меню на произвольный текст и клавиатуру для указанных пользователей.
   */
  public async refreshMainMenusForUsers(
    bot: Bot<MyContext>,
    userIds: number[],
    text: string,
    keyboard?: InlineKeyboard
  ): Promise<void> {
    for (const telegramId of userIds) {
      try {
        const existingState = await this.userMainMenuStateRepository.findByUserId(telegramId);
        if (existingState) {
          try {
            await bot.api.deleteMessage(telegramId, existingState.messageId);
          } catch {}
          await this.userMainMenuStateRepository.removeByUserId(telegramId);
        }

        const sentMessage = await bot.api.sendMessage(telegramId, text, { reply_markup: keyboard });
        if (sentMessage?.message_id) {
          await this.userMainMenuStateRepository.insert({
            telegramId,
            messageId: sentMessage.message_id,
            lastUpdated: new Date().toISOString(),
          });
        }
      } catch (error: any) {
        console.error(`MessageManager: Ошибка при обновлении меню для пользователя ${telegramId}:`, error);
      }
      await new Promise((resolve) => setTimeout(resolve, config.delayMs));
    }
  }

  // =========================================================================
  // ТОЧЕЧНЫЕ И МАССОВЫЕ РАССЫЛКИ (ТЕКСТ И МЕДИА)
  // =========================================================================

  /**
   * Отправляет текстовое сообщение одному пользователю с учётом антифлуд-задержки.
   */
  public async sendTextToOne(bot: Bot<MyContext>, userId: number, text: string): Promise<boolean> {
    try {
      await bot.api.sendMessage(userId, text);
      await new Promise((resolve) => setTimeout(resolve, config.delayMs));
      return true;
    } catch (error: any) {
      console.error(`MessageManager: Ошибка при отправке текстового сообщения пользователю ${userId}:`, error);
      await new Promise((resolve) => setTimeout(resolve, config.delayMs));
      return false;
    }
  }

  /**
   * Отправляет один документ или группу документов (альбомами по 10 штук) одному пользователю.
   */
  public async sendMediaToOne(bot: Bot<MyContext>, userId: number, media: string | string[]): Promise<boolean> {
    try {
      if (Array.isArray(media)) {
        const albumChunks = this.chunkArray(media, 10);
        for (const chunk of albumChunks) {
          await bot.api.sendMediaGroup(
            userId,
            chunk.map((m) => ({ type: 'document', media: m }))
          );
          await new Promise((resolve) => setTimeout(resolve, config.delayMs));
        }
      } else {
        await bot.api.sendDocument(userId, media);
        await new Promise((resolve) => setTimeout(resolve, config.delayMs));
      }
      return true;
    } catch (error: any) {
      console.error(`MessageManager: Ошибка при отправке медиа пользователю ${userId}:`, error);
      await new Promise((resolve) => setTimeout(resolve, config.delayMs));
      return false;
    }
  }

  /**
   * Рассылает текстовое сообщение списку пользователей.
   */
  public async broadcastTextToUsers(bot: Bot<MyContext>, userIds: number[], text: string): Promise<void> {
    for (const userId of userIds) {
      await this.sendTextToOne(bot, userId, text);
    }
  }

  /**
   * Рассылает документ или медиагруппу списку пользователей.
   */
  public async broadcastMediaToUsers(bot: Bot<MyContext>, userIds: number[], media: string | string[]): Promise<void> {
    for (const userId of userIds) {
      await this.sendMediaToOne(bot, userId, media);
    }
  }

  /**
   * Рассылает сначала медиафайлы, а затем сопроводительный текст списку пользователей.
   */
  public async broadcastMediaThenTextToUsers(
    bot: Bot<MyContext>,
    userIds: number[],
    media: string | string[],
    text: string
  ): Promise<void> {
    for (const userId of userIds) {
      await this.sendMediaToOne(bot, userId, media);
      await this.sendTextToOne(bot, userId, text);
    }
  }

  // =========================================================================
  // ВСПОМОГАТЕЛЬНЫЕ ПРИВАТНЫЕ МЕТОДЫ
  // =========================================================================

  /**
   * Разбивает массив на подмассивы заданного размера (используется для лимита альбомов Telegram).
   */
  private chunkArray(array: string[], size: number): string[][] {
    const chunks: string[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

export const messageManager = new MessageManager();
