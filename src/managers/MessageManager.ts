import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { config } from '../config.js';
import { MyContext } from '../types/context.js';
import { ProcessStage } from '../types/entities.js';
import { UserMainMenuStateRepository } from '../database/repositories/UserMainMenuStateRepo.js';
import { UserRepository } from '../database/repositories/UserRepo.js';

export class MessageManager {
  constructor(
    private readonly userMainMenuStateRepository: UserMainMenuStateRepository = new UserMainMenuStateRepository(),
    private readonly userRepository: UserRepository = new UserRepository(),
  ) {}

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

  public buildAdaptiveMenuText(user: any, stage: ProcessStage, customNotice?: string): string {
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
    } else if ((stage === ProcessStage.DISTRIBUTION || stage === ProcessStage.TICKETING || stage === ProcessStage.FINISHED) && user.student === 1) {
      text += `\n• *Ваш личный кабинет и сдача билетов:* Нажмите /user`;
      hasCommands = true;
    }

    if (!hasCommands) {
      text += `\n_Сейчас для вас нет активных действий. Ожидайте распоряжений администратора._`;
    }

    return text;
  }

  public async refreshMenuForUsers(bot: Bot<MyContext>, currentStage: ProcessStage, userIds: number[], noticeText?: string): Promise<void> {
    for (const userId of userIds) {
      try {
        const existingState = await this.userMainMenuStateRepository.findByUserId(userId);
        if (existingState) {
          try {
            await bot.api.deleteMessage(userId, existingState.messageId);
          } catch (deleteError) {
            
          }
          await this.userMainMenuStateRepository.removeByUserId(userId);
        }

        const user = await this.userRepository.findById(userId);
        if (!user) continue;

        const text = this.buildAdaptiveMenuText(user, currentStage, noticeText);

        const sentMessage = await bot.api.sendMessage(userId, text, { parse_mode: 'Markdown' });

        if (sentMessage && sentMessage.message_id) {
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
      await new Promise(resolve => setTimeout(resolve, config.delayMs));
    }
  }

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

  public async cleanupOldOrphanedMenus(bot: Bot<MyContext>): Promise<number> {
    let totalRemoved = 0;

    try {
      const orphanedBefore = await this.userMainMenuStateRepository.findOrphaned();
      const orphanedCount = orphanedBefore.length;

      for (const state of orphanedBefore) {
        try {
          await bot.api.deleteMessage(state.telegramId, state.messageId);
        } catch (deleteError) {
          
        }
        
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
 
  public async refreshAllMainMenus(
    bot: Bot<MyContext>,
    currentStage: ProcessStage,
    customNotice?: string,
  ): Promise<void> {
    try {
      const allUsers = await this.userRepository.findAll();

      for (const user of allUsers) {
        try {
          const existingState = await this.userMainMenuStateRepository.findByUserId(user.telegramId);
          if (existingState) {
            try {
              await bot.api.deleteMessage(user.telegramId, existingState.messageId);
            } catch (deleteError) {
              
            }
            await this.userMainMenuStateRepository.removeByUserId(user.telegramId);
          }

          const text = this.buildAdaptiveMenuText(user, currentStage, customNotice);

          const sentMessage = await bot.api.sendMessage(user.telegramId, text, {
            parse_mode: 'Markdown'
          });

          if (sentMessage && sentMessage.message_id) {
            await this.userMainMenuStateRepository.insert({
              telegramId: user.telegramId,
              messageId: sentMessage.message_id,
              lastUpdated: new Date().toISOString(),
            });
          }

        } catch (error) {
          console.error(`MessageManager: Ошибка отправки нового сообщения для пользователя ${user.telegramId}:`, error);
        }

        await new Promise(resolve => setTimeout(resolve, config.delayMs));
      }
    } catch (fetchError) {
      console.error('MessageManager: Ошибка при получении списка всех пользователей:', fetchError);
    }
  }

  public async refreshMainMenusForUsers(
    bot: Bot<MyContext>,
    userIds: number[],
    text: string,
    keyboard?: InlineKeyboard,
  ): Promise<void> {
    for (const telegramId of userIds) {
      try {
        const existingState = await this.userMainMenuStateRepository.findByUserId(telegramId);
        if (existingState) {
          try {
            await bot.api.deleteMessage(telegramId, existingState.messageId);
          } catch (deleteError) {}
          await this.userMainMenuStateRepository.removeByUserId(telegramId);
        }

        const sentMessage = await bot.api.sendMessage(telegramId, text, { reply_markup: keyboard });
        if (sentMessage && sentMessage.message_id) {
          await this.userMainMenuStateRepository.insert({
            telegramId: telegramId,
            messageId: sentMessage.message_id,
            lastUpdated: new Date().toISOString(),
          });
        }
      } catch (error: any) {
        console.error(`MessageManager: Ошибка при обновлении меню для пользователя ${telegramId}:`, error);
      }
      await new Promise(resolve => setTimeout(resolve, config.delayMs));
    }
  }

  public async sendTextToOne(
    bot: Bot,
    userId: number,
    text: string,
  ): Promise<boolean> {
    try {
      await bot.api.sendMessage(userId, text);
      await new Promise(resolve => setTimeout(resolve, config.delayMs));
      return true;
    } catch (error: any) {
      console.error(`MessageManager: Ошибка при отправке текстового сообщения пользователю ${userId}:`, error);
      await new Promise(resolve => setTimeout(resolve, config.delayMs));
      return false;
    }
  }

  public async sendMediaToOne(
    bot: Bot,
    userId: number,
    media: string | string[],
  ): Promise<boolean> {
    try {
      if (Array.isArray(media)) {
        const albumChunks = this.chunkArray(media, 10);
        for (const chunk of albumChunks) {
          await bot.api.sendMediaGroup(userId, chunk.map(m => ({ type: 'document', media: m })));
          await new Promise(resolve => setTimeout(resolve, config.delayMs));
        }
      } else {
        await bot.api.sendDocument(userId, media);
        await new Promise(resolve => setTimeout(resolve, config.delayMs));
      }
      return true;
    } catch (error: any) {
      console.error(`MessageManager: Ошибка при отправке медиа пользователю ${userId}:`, error);
      await new Promise(resolve => setTimeout(resolve, config.delayMs));
      return false;
    }
  }

  private chunkArray(array: string[], size: number): string[][] {
    const chunks: string[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  public async broadcastTextToUsers(
    bot: Bot,
    userIds: number[],
    text: string,
  ): Promise<void> {
    for (const userId of userIds) {
      await this.sendTextToOne(bot, userId, text);
    }
  }

  public async broadcastMediaToUsers(
    bot: Bot,
    userIds: number[],
    media: string | string[],
  ): Promise<void> {
    for (const userId of userIds) {
      await this.sendMediaToOne(bot, userId, media);
    }
  }

  public async broadcastMediaThenTextToUsers(
    bot: Bot,
    userIds: number[],
    media: string | string[],
    text: string,
  ): Promise<void> {
    for (const userId of userIds) {
      await this.sendMediaToOne(bot, userId, media);
      await this.sendTextToOne(bot, userId, text);
    }
  }

  public async removeAllUserMenus(bot: Bot<MyContext>): Promise<void> {
    const allStates = await this.userMainMenuStateRepository.findAll();
    for (const state of allStates) {
      if (config.chiefEditorIds.includes(state.telegramId)) continue;
      await this.removeMainMenuForUser(bot, state.telegramId);
      await new Promise(resolve => setTimeout(resolve, config.delayMs));
    }
  }
}

export const messageManager = new MessageManager();
