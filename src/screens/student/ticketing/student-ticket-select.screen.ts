import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { TicketStatus } from '../../../types/entities.js';
import { studentService } from '../../../services/StudentService.js';
import { StudentTicketingScreen } from './student-ticketing.screen.js';
import { StudentTicketSubmitScreen } from './student-ticket-submit.screen.js';
import { paginateItems, appendPaginationButtons } from '../../pagination.js';

export class StudentTicketSelectScreen implements BaseScreen {
  readonly id = 'student_ticket_select';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    const tickets = await studentService.getTicketsForStudent(ctx.from!.id);
    const sendable = tickets.filter(
      t => !t.status || t.status === TicketStatus.IN_PROGRESS || t.status === TicketStatus.ON_REWORK
    );

    let text = `📤 *Выберите билет для отправки решения:*\n` +
               `_(Отображаются только несданные билеты и билеты на доработке)_`;
    if (notice) text += `\n\n${notice}`;

    const keyboard = new InlineKeyboard();

    if (sendable.length === 0) {
      text += `\n\n✅ Все ваши билеты уже приняты или находятся на проверке!`;
    } else {
      const { pageItems, page, totalPages } = paginateItems(
        sendable,
        ctx,
        'st_sel_page',
        t => t.subjectName,
        16,
        3000
      );

      const grouped = new Map<string, typeof pageItems>();
      for (const t of pageItems) {
        const list = grouped.get(t.subjectName) || [];
        list.push(t);
        grouped.set(t.subjectName, list);
      }

      for (const [subjectName, subTickets] of grouped) {
        keyboard.text(`📘 ${subjectName}`, 'noop').row();
        for (let i = 0; i < subTickets.length; i += 4) {
          const chunk = subTickets.slice(i, i + 4);
          for (const t of chunk) {
            const icon = t.status === TicketStatus.ON_REWORK ? '🔴 ' : '';
            keyboard.text(`${icon}№${t.ticketNumber}`, `st_sub_pick:${t.ticketId}`);
          }
          keyboard.row();
        }
      }

      appendPaginationButtons(keyboard, page, totalPages, 'st_sel_page');
    }

    keyboard.text('⬅️ Назад', 'st_sub_pick:back');

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

    if (data.startsWith('st_sel_page:')) {
      ctx.session.meta.st_sel_page = parseInt(data.split(':')[1], 10);
      return this;
    }

    if (data === 'st_sub_pick:back') {
      delete ctx.session.meta.st_sel_page;
      return new StudentTicketingScreen();
    }

    if (data.startsWith('st_sub_pick:')) {
      const ticketId = parseInt(data.split(':')[1], 10);
      delete ctx.session.meta.st_sel_page;
      ctx.session.meta.targetTicketId = ticketId;
      return new StudentTicketSubmitScreen();
    }

    return null;
  }
}

