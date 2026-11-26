import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from './base.screen.js';
import { MyContext } from '../types/context.js';
import { stageManager } from '../managers/StageManager.js';
import { studentService } from '../services/StudentService.js';
import { feedbackStorage } from '../storage/FeedbackStorage.js';
import { screenFactory } from './screenFactory.js';

/**
 * Универсальный экран отправки обратной связи / баг-репорта из любого главного меню.
 */
export class FeedbackScreen implements BaseScreen {
  readonly id = 'feedback_input';

  render(ctx: MyContext, notice?: string): RenderResult {
    const roleLabel = ctx.session.meta?.fbRoleLabel || 'Неизвестное меню';

    let text = `💬 *Обратная связь / Сообщить о баге*\n\n` +
               `Отправьте одним текстовым сообщением ваше предложение, вопрос или описание проблемы.\n` +
               `_(Обращение будет зафиксировано из раздела: ${roleLabel})_`;

    if (notice) {
      text += `\n\n${notice}`;
    }

    return {
      displayType: 'main_menu',
      text,
      reply_markup: new InlineKeyboard().text('❌ Отмена', 'fb:cancel'),
    };
  }

  async handle(ctx: MyContext): Promise<BaseScreen | null> {
    const returnScreenId = ctx.session.meta?.fbReturnScreenId || 'student_ticketing';
    const roleLabel = ctx.session.meta?.fbRoleLabel || 'Неизвестно';

    if (ctx.callbackQuery?.data === 'fb:cancel') {
      await ctx.answerCallbackQuery();
      this.cleanupSession(ctx);
      return screenFactory.create(returnScreenId);
    }

    if (ctx.message?.text && ctx.from) {
      const msgText = ctx.message.text.trim();
      if (!msgText) {
        ctx.session.meta.notice = '⚠️ Сообщение не может быть пустым. Напишите текст:';
        return this;
      }

      try {
        const stage = await stageManager.getCurrentStageFast();
        const user = await studentService.getUserById(ctx.from.id);
        const userName = user?.userName || ctx.from.first_name || `User ${ctx.from.id}`;

        await feedbackStorage.appendFeedback({
          telegramId: ctx.from.id,
          userName,
          roleLabel,
          stage,
          text: msgText,
        });

        this.cleanupSession(ctx);
        ctx.session.meta.notice = '✅ Спасибо! Ваше обращение записано и передано администратору.';
        return screenFactory.create(returnScreenId);
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Не удалось сохранить обращение: ${e.message || e}`;
        return this;
      }
    }

    if (ctx.message) {
      ctx.session.meta.notice = '⚠️ Пожалуйста, отправьте обращение именно *текстовым сообщением*.';
      return this;
    }

    return null;
  }

  private cleanupSession(ctx: MyContext): void {
    delete ctx.session.meta.fbReturnScreenId;
    delete ctx.session.meta.fbRoleLabel;
  }
}

