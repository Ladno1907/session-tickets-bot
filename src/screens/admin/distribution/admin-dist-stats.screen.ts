import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { AdminDistributionScreen } from './admin-distribution.screen.js';
import { escapeMarkdown } from '../../../utils/format.js';

/**
 * Экран детальной статистики распределения студентов и билетов по предметам.
 */
export class AdminDistStatsScreen implements BaseScreen {
  readonly id = 'admin_dist_stats';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) throw new Error('Пользователь не найден.');

    const activeStats = await chiefEditorService.getRegistrationStats(ctx.from.id);
    const detailedStats = await chiefEditorService.getSubjectsDetailedStats(ctx.from.id);
    const prepStats = await chiefEditorService.getPreparationStats(ctx.from.id);

    const ticketsMap = new Map(prepStats.map((p) => [p.subjectId, p.ticketsCount]));

    let text = `📊 *Детальная статистика распределения*\n\n` +
               `👥 *Всего участников в системе:*\n` +
               `• Студентов с билетами: *${activeStats.totalStudents}*\n` +
               `• Активных модераторов: *${activeStats.totalEditors}*\n\n` +
               `📘 *Сводка по дисциплинам:*\n`;

    if (detailedStats.length === 0) {
      text += `_❌ Предметы отсутствуют в системе._`;
    } else {
      detailedStats.forEach((sub, i) => {
        const totalTickets = ticketsMap.get(sub.subjectId) || 0;
        text += `${i + 1}. *${escapeMarkdown(sub.name)}*\n` +
                `   ↳ Записано студентов: *${sub.studentsCount}*\n` +
                `   ↳ Всего билетов в базе: *${totalTickets}*\n`;
      });
    }

    if (notice) {
      text += `\n\n${notice}`;
    }

    const keyboard = new InlineKeyboard()
      .text('🔄 Обновить данные', 'stats_action:refresh').row()
      .text('⬅️ Назад в меню', 'stats_action:back');

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

    if (data === 'stats_action:refresh') return this;
    if (data === 'stats_action:back') return new AdminDistributionScreen();

    return null;
  }
}

