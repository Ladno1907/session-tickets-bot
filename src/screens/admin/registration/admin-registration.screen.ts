import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { getDeadlinesText, getRegistrationStatusText } from '../utils.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { AdminRegSelectSubjectScreen } from './admin-reg-select-subject.screen.js';
import { AdminDistributionScreen } from '../distribution/admin-distribution.screen.js';
import { escapeMarkdown } from '../../../utils/format.js';

/**
 * Главный экран Администратора на этапе регистрации (`REGISTRATION`).
 * Позволяет просматривать списки участников и редакторов, управлять составом предметов
 * и редакторов, а также досрочно закрыть регистрацию и запустить распределение билетов.
 */
export class AdminRegistrationScreen implements BaseScreen {
  readonly id = 'admin_registration';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) {
      throw new Error('Критическая ошибка: не удалось определить пользователя в контексте grammY.');
    }

    const deadlinesPart = await getDeadlinesText(ctx.from.id);
    const registrationPart = await getRegistrationStatusText(ctx.from.id);

    let fullText = `🛠 *Панель Администратора*\n\n` +
                   `${deadlinesPart}\n` +
                   `${registrationPart}\n` +
                   `Вы можете досрочно завершить этот этап и перейти к распределению билетов.`;

    if (notice) {
      fullText += `\n\n${notice}`;
    }

    const keyboard = new InlineKeyboard()
      .text('🔄 Обновить статистику', 'refresh_stats').row()
      .text('📋 Список пользователей', 'reg_view_all_users')
      .text('📚 Пользователи по предмету', 'reg_sub_action:view_students').row()
      .text('👑 Список редакторов', 'reg_view_all_editors')
      .text('🔑 Изменить редакторов', 'reg_sub_action:manage_editors').row()
      .text('📝 Изменить предметы', 'reg_sub_action:manage_subjects').row()
      .text('🛑 Закрыть регистрацию и начать распределение', 'stop_registration');

    return {
      displayType: 'main_menu',
      text: fullText,
      reply_markup: keyboard,
    };
  }

  async handle(ctx: MyContext): Promise<BaseScreen | null> {
    const data = ctx.callbackQuery?.data;
    if (!data) return null;

    await ctx.answerCallbackQuery();

    if (data === 'refresh_stats') {
      return this;
    }

    if (data === 'reg_view_all_users') {
      if (!ctx.from) {
        throw new Error('Критическая ошибка: не удалось определить пользователя в контексте grammY.');
      }

      const users = await chiefEditorService.getAllRegisteredUsers(ctx.from.id);
      let text = `📋 *Все зарегистрированные пользователи*:\n\n`;
      if (users.length === 0) {
        text += `❌ В системе пока нет пользователей.`;
      } else {
        users.forEach((u, i) => {
          text += `${i + 1}. ${escapeMarkdown(u.name)} (\`ID: ${u.telegramId}\`)\n`;
        });
      }
      ctx.session.meta.notice = text;
      return this;
    }

    if (data === 'reg_view_all_editors') {
      if (!ctx.from) {
        throw new Error('Критическая ошибка: не удалось определить пользователя в контексте grammY.');
      }

      const grouped = await chiefEditorService.getAllEditorsGroupedBySubject(ctx.from.id);
      let text = `👑 *Список назначенных редакторов*:\n\n`;
      let hasEditors = false;
      grouped.forEach((g) => {
        if (g.editors.length > 0) {
          hasEditors = true;
          text += `📘 *${escapeMarkdown(g.subjectName)}*:\n` +
                  g.editors.map((name) => `  • ${escapeMarkdown(name)}`).join('\n') +
                  '\n\n';
        }
      });
      if (!hasEditors) text += `❌ Ни один редактор еще не назначен.`;
      ctx.session.meta.notice = text;
      return this;
    }

    if (data.startsWith('reg_sub_action:')) {
      ctx.session.meta.subjectAction = data.split(':');
      return new AdminRegSelectSubjectScreen();
    }

    if (data === 'stop_registration') {
      try {
        await chiefEditorService.startNextStage(ctx.from!.id);

        ctx.session.meta = {};
        ctx.session.meta.notice = '✅ Этап регистрации успешно закрыт! Процесс переведен на этап распределения билетов.';

        return new AdminDistributionScreen();
      } catch (error: any) {
        ctx.session.meta.notice = `❌ Ошибка перехода: ${error.message || error}`;
        return this;
      }
    }

    return null;
  }
}

