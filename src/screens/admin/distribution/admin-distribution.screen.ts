import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { getDeadlinesText } from '../utils.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { AdminDistStatsScreen } from './admin-dist-stats.screen.js';
import { AdminDistSubjectsScreen } from './admin-dist-subjects.screen.js';

/**
 * Главный экран Администратора на этапе проверки распределения (`DISTRIBUTION`).
 */
export class AdminDistributionScreen implements BaseScreen {
  readonly id = 'admin_distribution';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) throw new Error('Пользователь не найден.');

    const deadlinesPart = await getDeadlinesText(ctx.from.id);

    let text = `⚙️ *Панель Администратора: Распределение ведомостей*\n\n` +
               `${deadlinesPart}\n` +
               `Регистрация участников успешно завершена. Сейчас вы можете проверить статистику распределения, ` +
               `выгрузить ведомости в Google Sheets или досрочно открыть этап активной сдачи билетов.`;

    if (notice) {
      text += `\n\n${notice}`;
    }

    const keyboard = new InlineKeyboard()
      .text('📊 Подробная статистика', 'dist_menu:stats').row()
      .text('📝 Синхронизация с таблицами', 'dist_menu:subjects').row()
      .text('🚀 Запустить этап Сдачи (Ticketing)', 'dist_menu:start_ticketing');

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

    if (data === 'dist_menu:stats') {
      return new AdminDistStatsScreen();
    }

    if (data === 'dist_menu:subjects') {
      return new AdminDistSubjectsScreen();
    }

    if (data === 'dist_menu:start_ticketing') {
      try {
        await chiefEditorService.startNextStage(ctx.from!.id);
        ctx.session.meta = {};
        ctx.session.meta.notice = '🚀 Этап подготовки и проверки билетов успешно запущен для всех участников!';
        return null; // Переход на AdminTicketingScreen после его подключения
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка перехода: ${e.message || e}`;
        return this;
      }
    }

    return null;
  }
}

