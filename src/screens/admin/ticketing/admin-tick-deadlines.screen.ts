import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { escapeMarkdown } from '../../../utils/format.js';
import { paginateItems, appendPaginationButtons } from '../../pagination.js';
import { AdminTicketingScreen } from './admin-ticketing.screen.js';

type DeadlinesMode = 'overview' | 'add_date' | 'misses';

/**
 * Экран управления промежуточными дедлайнами, тумблерами напоминаний/просрочек
 * и ручной корректировки меток просрочек студентов (кандидатов на отчисление).
 */
export class AdminTickDeadlinesScreen implements BaseScreen {
  readonly id = 'admin_tick_deadlines';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) throw new Error('Пользователь не найден.');

    const mode = (ctx.session.meta?.dlMode as DeadlinesMode) || 'overview';
    const keyboard = new InlineKeyboard();
    let text = '';

    // -----------------------------------------------------------------------
    // РЕЖИМ 1: ВВОД ДАТЫ НОВОГО ПРОМЕЖУТОЧНОГО ДЕДЛАЙНА
    // -----------------------------------------------------------------------
    if (mode === 'add_date') {
      text = `📅 *Новый промежуточный дедлайн*\n\n` +
             `Введите дату в формате \`YYYY-MM-DD\` (время будет установлено на *23:00 МСК*):`;
      if (notice) text += `\n\n${notice}`;

      return {
        displayType: 'main_menu',
        text,
        reply_markup: new InlineKeyboard().text('❌ Отмена', 'dl:cancel_add'),
      };
    }

    // -----------------------------------------------------------------------
    // РЕЖИМ 2: УПРАВЛЕНИЕ МЕТКАМИ ПРОСРОЧЕК И СПИСОК НА ОТЧИСЛЕНИЕ
    // -----------------------------------------------------------------------
    if (mode === 'misses') {
      const students = await chiefEditorService.getStudentsMissesList(ctx.from.id);
      const expulsionCandidates = students.filter((s) => s.missedDeadlines >= 2);

      text = `🚨 *Метки просрочек и кандидаты на отчисление*\n\n`;

      if (expulsionCandidates.length > 0) {
        text += `⛔ *На отчисление (2+ пропуска):*\n` +
                expulsionCandidates
                  .map((s) => `  • *${escapeMarkdown(s.userName)}* — ${s.missedDeadlines} проп.`)
                  .join('\n') +
                `\n\n`;
      } else {
        text += `✅ Кандидатов на отчисление (2+ пропуска) пока нет.\n\n`;
      }

      text += `📋 *Все студенты (нажмите +1 или -1 для правки меток):*\n`;

      const { pageItems, page, totalPages } = paginateItems(
        students,
        ctx,
        'dl_misses_page',
        (s) => `${s.userName} (${s.missedDeadlines})`,
        8,
        2800
      );

      for (const s of pageItems) {
        const badge = s.missedDeadlines >= 2 ? '🚨' : s.missedDeadlines === 1 ? '⚠️' : '✅';
        text += `${badge} *${escapeMarkdown(s.userName)}* — пропусков: *${s.missedDeadlines}*\n`;

        keyboard
          .text(`${badge} ${s.userName.split(' ')[0]} (${s.missedDeadlines})`, 'noop')
          .text('➖1', `dl_miss_adj:${s.telegramId}:-1`)
          .text('➕1', `dl_miss_adj:${s.telegramId}:1`)
          .row();
      }

      appendPaginationButtons(keyboard, page, totalPages, 'dl_misses_pg');
      keyboard.text('⬅️ Назад к дедлайнам', 'dl:mode_overview');

      if (notice) text += `\n${notice}`;

      return {
        displayType: 'main_menu',
        text,
        reply_markup: keyboard,
      };
    }

    // -----------------------------------------------------------------------
    // РЕЖИМ 3: ОБЗОР ШКАЛЫ ДЕДЛАЙНОВ, ТУМБЛЕРОВ И ТЕКУЩИХ ДОЛЖНИКОВ
    // -----------------------------------------------------------------------
    const { timeline, settings, nextPoint, currentDebtors } =
      await chiefEditorService.getCheckpointsOverview(ctx.from.id);

    text = `⏱ *Промежуточные дедлайны и контроль сдачи*\n\n` +
           `⚙️ *Автоматика:*\n` +
           `• Напоминания перед дедлайном: ${settings.autoRemind ? '🟢 ВКЛ' : '🔴 ВЫКЛ'}\n` +
           `• Авто-фиксация просрочек: ${settings.autoPenalize ? '🟢 ВКЛ' : '🔴 ВЫКЛ'}\n\n` +
           `📅 *Шкала дедлайнов этапа сдачи:*\n`;

    if (timeline.length === 0) {
      text += `_Контрольные точки не заданы._\n`;
    } else {
      for (const p of timeline) {
        const dateStr = p.deadlineAt.toLocaleString('ru-RU', {
          timeZone: 'Europe/Moscow',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        const statusIcon = p.processedAt ? '✅' : '⏳';
        const label = p.checkpointId === null ? 'Финал (ticketingEnd)' : `Этап №${p.index}`;
        text += `${statusIcon} *${label}:* ${dateStr} МСК\n`;

        if (p.checkpointId !== null) {
          keyboard.text(`🗑 Удалить дедлайн ${dateStr.split(',')[0]}`, `dl:del:${p.checkpointId}`).row();
        }
      }
    }

    if (nextPoint) {
      text += `\n📉 *Отстают от графика к Этапу №${nextPoint.index} из ${nextPoint.totalPoints} (${currentDebtors.length} чел.):*\n`;
      if (currentDebtors.length === 0) {
        text += `_Все студенты укладываются в норму!_\n`;
      } else {
        const preview = currentDebtors.slice(0, 15).map((d, i) => {
          const subStr = d.subjects.map((s) => `${s.subjectName}: ${s.submitted}/${s.required}`).join(', ');
          return `${i + 1}. *${escapeMarkdown(d.userName)}* — _${escapeMarkdown(subStr)}_`;
        });
        text += preview.join('\n') + '\n';
        if (currentDebtors.length > 15) {
          text += `_...и ещё ${currentDebtors.length - 15} чел._\n`;
        }
      }
    }

    if (notice) text += `\n${notice}`;

    keyboard
      .text(`${settings.autoRemind ? '🔔 Напоминания: ВКЛ' : '🔕 Напоминания: ВЫКЛ'}`, 'dl:toggle_remind').row()
      .text(`${settings.autoPenalize ? '⚡ Авто-просрочки: ВКЛ' : '⏸ Авто-просрочки: ВЫКЛ'}`, 'dl:toggle_penalize').row()
      .text('➕ Добавить промежуточный дедлайн', 'dl:add').row()
      .text('🚨 Метки просрочек / Отчисление', 'dl:mode_misses').row()
      .text('⬅️ Назад в панель', 'dl:back');

    return {
      displayType: 'main_menu',
      text,
      reply_markup: keyboard,
    };
  }

  async handle(ctx: MyContext): Promise<BaseScreen | null> {
    if (!ctx.from) return null;

    if (ctx.callbackQuery?.data) {
      const data = ctx.callbackQuery.data;
      await ctx.answerCallbackQuery();

      if (data === 'noop') return null;

      if (data === 'dl:back') {
        delete ctx.session.meta.dlMode;
        delete ctx.session.meta.dl_misses_page;
        return new AdminTicketingScreen();
      }

      if (data === 'dl:mode_overview' || data === 'dl:cancel_add') {
        ctx.session.meta.dlMode = 'overview';
        return this;
      }

      if (data === 'dl:mode_misses') {
        ctx.session.meta.dlMode = 'misses';
        ctx.session.meta.dl_misses_page = 0;
        return this;
      }

      if (data === 'dl:add') {
        ctx.session.meta.dlMode = 'add_date';
        return this;
      }

      if (data === 'dl:toggle_remind') {
        await chiefEditorService.toggleCheckpointSetting(ctx.from.id, 'autoRemind');
        return this;
      }

      if (data === 'dl:toggle_penalize') {
        await chiefEditorService.toggleCheckpointSetting(ctx.from.id, 'autoPenalize');
        return this;
      }

      if (data.startsWith('dl:del:')) {
        const [, , rawId] = data.split(':');
        await chiefEditorService.removeCheckpoint(ctx.from.id, parseInt(rawId, 10));
        ctx.session.meta.notice = '🗑 Промежуточный дедлайн удалён.';
        return this;
      }

      if (data.startsWith('dl_misses_pg:')) {
        const [, rawPage] = data.split(':');
        ctx.session.meta.dl_misses_page = parseInt(rawPage, 10);
        return this;
      }

      if (data.startsWith('dl_miss_adj:')) {
        const [, rawUid, rawDelta] = data.split(':');
        const targetUid = parseInt(rawUid, 10);
        const delta = parseInt(rawDelta, 10);
        await chiefEditorService.adjustUserMissedDeadlines(ctx.from.id, targetUid, delta);
        return this;
      }
    }

    if (ctx.session.meta?.dlMode === 'add_date' && ctx.message?.text) {
      const input = ctx.message.text.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        ctx.session.meta.notice = '⚠️ Неверный формат! Введите дату строго как `YYYY-MM-DD`:';
        return this;
      }

      try {
        const [year, month, day] = input.split('-').map(Number);
        const isoDate = new Date(Date.UTC(year, month - 1, day, 20, 0, 0, 0)).toISOString();
        await chiefEditorService.addCheckpoint(ctx.from.id, isoDate);

        ctx.session.meta.dlMode = 'overview';
        ctx.session.meta.notice = `✅ Промежуточный дедлайн на *${input} 23:00 МСК* добавлен!`;
        return this;
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка добавления: ${e.message || e}`;
        return this;
      }
    }

    return null;
  }
}

