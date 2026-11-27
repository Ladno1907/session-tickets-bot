import { InlineKeyboard } from 'grammy';
import { unlink } from 'node:fs/promises';
import { bot } from '../../../bot.js';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { ProcessStage } from '../../../types/entities.js';
import { getDeadlinesText } from '../utils.js';
import { stageManager } from '../../../managers/StageManager.js';
import { messageManager } from '../../../managers/MessageManager.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { escapeMarkdown } from '../../../utils/format.js';
import { AdminTickFilesScreen } from './admin-tick-files.screen.js';
import { AdminTickBroadcastScreen } from './admin-tick-broadcast.screen.js';
import { AdminTickSheetsScreen } from './admin-tick-sheets.screen.js';
import { AdminTickAddUserScreen } from './admin-tick-add-user.screen.js';
import { AdminTickDeadlinesScreen } from './admin-tick-deadlines.screen.js';
import { FeedbackScreen } from '../../feedback.screen.js';

/**
 * Главный экран Администратора на этапах активной подготовки (`TICKETING`) и завершения (`FINISHED`).
 */
export class AdminTicketingScreen implements BaseScreen {
  readonly id = 'admin_ticketing';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) throw new Error('Пользователь не найден.');

    const stage = await stageManager.getCurrentStageFast();
    const isFinished = stage === ProcessStage.FINISHED;

    const deadlinesPart = await getDeadlinesText(ctx.from.id);
    const progressStats = await chiefEditorService.getTicketingProgressStats(ctx.from.id);

    let text = isFinished
      ? `🏁 *Панель Администратора: Сессия завершена*\n\n`
      : `🎫 *Панель Администратора: Подготовка и проверка билетов*\n\n`;

    text += `${deadlinesPart}\n📊 *Прогресс по предметам:*\n`;

    if (progressStats.length === 0) {
      text += `_Предметы отсутствуют._\n`;
    } else {
      for (const s of progressStats) {
        text += `📘 *${escapeMarkdown(s.subjectName)}* (всего ${s.total}):\n` +
                `   🟢 Принято: *${s.approved}* | 🟡 На проверке: *${s.onCheck}*\n` +
                `   🔴 Доработка: *${s.onRework}* | ⚪ Не сдано: *${s.inProgress}*\n`;
      }
    }

    if (notice) {
      text += `\n${notice}`;
    }

    const keyboard = new InlineKeyboard()
      .text('🔄 Обновить статистику', 'tick_adm:refresh').row()
      .text('📥 Скачать файлы билетов', 'tick_adm:files').row()
      .text('💾 Скачать бэкап (БД + data)', 'admin_dl_backup').row()
      .text('📢 Массовая рассылка (Спам)', 'tick_adm:broadcast').row()
      .text('📝 Синхронизация с таблицами', 'tick_adm:sheets').row()
      .text('➕ Добавить участника', 'tick_adm:add_user').row()
      .text('⏱ Промежуточные дедлайны', 'tick_adm:deadlines').row()
      .text('📥 Скачать журнал фидбека', 'admin_dl_feedback').row();

    if (!isFinished) {
      keyboard.text('🏁 Завершить сессию (Закрыть приём)', 'tick_adm:finish').row();
    }

    keyboard.text('💬 Обратная связь', 'open_feedback');

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

    if (data === 'tick_adm:refresh') return this;
    if (data === 'tick_adm:files') return new AdminTickFilesScreen();
    if (data === 'tick_adm:broadcast') return new AdminTickBroadcastScreen();
    if (data === 'tick_adm:sheets') return new AdminTickSheetsScreen();
    if (data === 'tick_adm:add_user') return new AdminTickAddUserScreen();
    if (data === 'tick_adm:deadlines') return new AdminTickDeadlinesScreen();

    if (data === 'admin_dl_backup') {
      try {
        const zipPath = await chiefEditorService.createFullBackup(ctx.from!.id);
        await messageManager.sendMediaToOne(bot, ctx.from!.id, zipPath);
        await unlink(zipPath).catch(() => {});
        ctx.session.meta.notice = '✅ Полный бэкап (`storage.db` + `data/`) отправлен в чат!';
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка создания бэкапа: ${e.message || e}`;
      }
      return this;
    }

    if (data === 'tick_adm:finish') {
      try {
        await chiefEditorService.startNextStage(ctx.from!.id);
        ctx.session.meta = {};
        ctx.session.meta.notice = '🏁 Сессия официально завершена! Приём новых решений закрыт.';
        return this;
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка завершения: ${e.message || e}`;
        return this;
      }
    }

    if (data === 'admin_dl_feedback') {
      try {
        const filePath = chiefEditorService.getFeedbackFilePath(ctx.from!.id);
        await messageManager.sendMediaToOne(bot, ctx.from!.id, filePath);
        ctx.session.meta.notice = '✅ Журнал обратной связи (`feedback.md`) отправлен в чат!';
      } catch (e: any) {
        ctx.session.meta.notice = `⚠️ ${e.message || e}`;
      }
      return this;
    }

    if (data === 'open_feedback') {
      ctx.session.meta.fbReturnScreenId = this.id;
      ctx.session.meta.fbRoleLabel = 'Администратор (/admin)';
      return new FeedbackScreen();
    }

    return null;
  }
}

