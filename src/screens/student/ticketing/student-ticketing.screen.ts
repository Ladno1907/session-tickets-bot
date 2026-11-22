import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { ProcessStage, TicketStatus } from '../../../types/entities.js';
import { studentService } from '../../../services/StudentService.js';
import { stageManager } from '../../../managers/StageManager.js';
import { StudentTicketSelectScreen } from './student-ticket-select.screen.js';
import { paginateItems, appendPaginationButtons } from '../../pagination.js';

export class StudentTicketingScreen implements BaseScreen {
  readonly id = 'student_ticketing';

  private getStatusEmoji(status?: TicketStatus): string {
    switch (status) {
      case TicketStatus.APPROVED: return '🟢';
      case TicketStatus.ON_REWORK: return '🔴';
      case TicketStatus.ON_CHECK: return '🟡';
      default: return '⚪';
    }
  }

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) throw new Error('Пользователь не найден');

    const stage = await stageManager.getCurrentStageFast();
    const isFinished = stage === ProcessStage.FINISHED;
    const tickets = await studentService.getTicketsForStudent(ctx.from.id);

    let text = isFinished
      ? `🏁 *Сессия завершена! Ваши итоговые билеты:*\n\n`
      : `🎫 *Личный кабинет: Сдача билетов*\n\n`;

    const keyboard = new InlineKeyboard();

    if (tickets.length === 0) {
      text += `_У вас нет назначенных билетов._`;
    } else {
      const { pageItems, page, totalPages } = paginateItems(
        tickets,
        ctx,
        'st_tickets_page',
        t => `${t.ticketNumber}. ${t.question} ${t.editorComment || ''}`,
        10,
        3000
      );

      const grouped = new Map<string, typeof pageItems>();
      for (const t of pageItems) {
        const list = grouped.get(t.subjectName) || [];
        list.push(t);
        grouped.set(t.subjectName, list);
      }

      for (const [subjectName, subTickets] of grouped) {
        text += `📘 *${subjectName}*\n`;
        for (const t of subTickets) {
          const safeQuestion = t.question.replace(/[_*`]/g, '');
          text += `  ${this.getStatusEmoji(t.status)} *№${t.ticketNumber}.* ${safeQuestion}\n`;
          if (t.status === TicketStatus.ON_REWORK && t.editorComment) {
            text += `     ↳ _Замечание редактора:_ ${t.editorComment.replace(/[_*`]/g, '')}\n`;
          }
        }
        text += '\n';
      }

      text += `⚪ — не отправлен | 🟡 — на проверке\n🔴 — на доработке | 🟢 — принят`;

      appendPaginationButtons(keyboard, page, totalPages, 'st_page');
    }

    if (notice) text += `\n\n${notice}`;

    if (!isFinished && tickets.length > 0) {
      keyboard.text('📤 Отправить решение', 'st_tick:select').row();
    }
    keyboard.text('🔄 Обновить список', 'st_tick:refresh');

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

    if (data === 'noop') return null;

    if (data.startsWith('st_page:')) {
      ctx.session.meta.st_tickets_page = parseInt(data.split(':')[1], 10);
      return this;
    }

    if (data === 'st_tick:refresh') return this;
    if (data === 'st_tick:select') {
      delete ctx.session.meta.st_sel_page;
      return new StudentTicketSelectScreen();
    }

    return null;
  }
}

