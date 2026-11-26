import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { FeedbackScreen } from '../../feedback.screen.js';

/**
 * Информационный экран Студента на этапе перепроверки распределения (`DISTRIBUTION`).
 */
export class StudentDistributionScreen implements BaseScreen {
  readonly id = 'student_distribution';

  render(_: MyContext, notice?: string): RenderResult {
    let text = `👤 *Панель Студента: Распределение ведомостей*\n\n` +
               `Сейчас система находится на этапе перепроверки распределения билетов.\n` +
               `_Пожалуйста, дождитесь официального запуска этапа сдачи, после чего здесь появится список ваших билетов._`;

    if (notice) {
      text += `\n\n${notice}`;
    }

    return {
      displayType: 'main_menu',
      text,
      reply_markup: new InlineKeyboard().text('💬 Обратная связь', 'open_feedback'),
    };
  }

  async handle(ctx: MyContext): Promise<BaseScreen | null> {
    const data = ctx.callbackQuery?.data;
    if (!data) return null;

    await ctx.answerCallbackQuery();

    if (data === 'open_feedback') {
      ctx.session.meta.fbReturnScreenId = this.id;
      ctx.session.meta.fbRoleLabel = 'Студент (/user)';
      return new FeedbackScreen();
    }

    return null;
  }
}

