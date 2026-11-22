import { InlineKeyboard } from 'grammy';
import { bot } from '../../../bot.js';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { getDeadlinesText, getPreparationStatusText } from '../utils.js';
import { AdminPrepDateInputScreen } from './admin-prep-date-input.screen.js';
import { AdminPrepLoadSubjectsScreen } from './admin-prep-load-subjects.screen.js';
import { AdminPrepDeleteSubjectScreen } from './admin-prep-delete-subject.screen.js';
import { AdminRegistrationScreen } from '../registration/admin-registration.screen.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';

/**
 * Главный экран Администратора на подготовительном этапе (`PREPARATION`).
 * Позволяет задать дедлайны, загрузить или удалить предметы из Google Sheets и запустить регистрацию.
 */
export class AdminPreparationScreen implements BaseScreen {
  readonly id = 'admin_preparation';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) {
      throw new Error('Критическая ошибка: не удалось определить пользователя в контексте grammY.');
    }

    const deadlinesPart = await getDeadlinesText(ctx.from.id);
    const subjectsPart = await getPreparationStatusText(ctx.from.id);

    let text = `🛠 *Настройка подготовительного этапа*\n\n` +
               `${deadlinesPart}\n` +
               `${subjectsPart}\n` +
               `Выберите действие:`;

    if (notice) {
      text += `\n\n${notice}`;
    }

    const keyboard = new InlineKeyboard()
      .text('📅 Дедлайн регистрации', 'set_reg_end').row()
      .text('📅 Дедлайн распределения', 'set_dist_end').row()
      .text('📅 Дедлайн подготовки', 'set_tick_end').row()
      .text('📚 Загрузить предметы', 'load_subjects').row()
      .text('🗑 Удалить предмет', 'go_to_delete_subject').row()
      .text('🚀 Запустить регистрацию', 'confirm_deadlines');

    return {
      displayType: 'main_menu',
      text,
      reply_markup: keyboard,
    };
  }

  async handle(ctx: MyContext): Promise<BaseScreen | null> {
    const data = ctx.callbackQuery?.data;
    if (!data) return null;

    await ctx.answerCallbackQuery();

    if (data === 'set_reg_end') {
      ctx.session.meta.targetField = 'registrationEnd';
      return new AdminPrepDateInputScreen();
    }
    if (data === 'set_dist_end') {
      ctx.session.meta.targetField = 'distributionEnd';
      return new AdminPrepDateInputScreen();
    }
    if (data === 'set_tick_end') {
      ctx.session.meta.targetField = 'ticketingEnd';
      return new AdminPrepDateInputScreen();
    }
    if (data === 'load_subjects') return new AdminPrepLoadSubjectsScreen();
    if (data === 'go_to_delete_subject') return new AdminPrepDeleteSubjectScreen();

    if (data === 'confirm_deadlines') {
      try {
        await chiefEditorService.startRegistrationStage(ctx.from!.id, bot);
        ctx.session.meta = {};
        ctx.session.meta.notice = '🚀 Этап регистрации успешно запущен!';
        return new AdminRegistrationScreen();
      } catch (error: any) {
        ctx.session.meta.notice = `❌ Ошибка: ${error.message || error}`;
        return this;
      }
    }

    return null;
  }
}

