import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { ProcessStage, TicketStatus } from '../../../types/entities.js';
import { editorService } from '../../../services/EditorService.js';
import { stageManager } from '../../../managers/StageManager.js';
import { EditorTicketReviewScreen } from './editor-ticket-review.screen.js';
import { paginateItems, appendPaginationButtons } from '../../pagination.js';

export class EditorTicketingScreen implements BaseScreen {
  readonly id = 'editor_ticketing';

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
    const tickets = await editorService.getTicketsForEditor(ctx.from.id);

    let text = isFinished
      ? `🏁 *Сессия завершена: Панель Редактора*\n\n`
      : `👑 *Панель Проверки Редактора*\n\n`;

    const keyboard = new InlineKeyboard();

    if (tickets.length === 0) {
      text += `_За вами не закреплено ни одного билета._`;
    } else {
      const onCheckCount = tickets.filter(t => t.status === TicketStatus.ON_CHECK).length;
      const approvedCount = tickets.filter(t => t.status === TicketStatus.APPROVED).length;
      const reworkCount = tickets.filter(t => t.status === TicketStatus.ON_REWORK).length;
      const pendingCount = tickets.length - onCheckCount - approvedCount - reworkCount;

      text += `📊 *Сводка:* 🟡 На проверке: *${onCheckCount}* | 🟢 Принято: *${approvedCount}* из *${tickets.length}*\n` +
              `_(🔴 На доработке: ${reworkCount} | ⚪ Не сдано: ${pendingCount})_\n\n`;

      const priority: Record<string, number> = {
        [TicketStatus.ON_CHECK]: 0,
        [TicketStatus.ON_REWORK]: 1,
        [TicketStatus.IN_PROGRESS]: 2,
        [TicketStatus.APPROVED]: 3,
      };
      const sortedTickets = [...tickets].sort((a, b) => {
        const pA = priority[a.status || TicketStatus.IN_PROGRESS] ?? 2;
        const pB = priority[b.status || TicketStatus.IN_PROGRESS] ?? 2;
        if (pA !== pB) return pA - pB;
        if (a.subjectId !== b.subjectId) return a.subjectId - b.subjectId;
        return a.ticketNumber - b.ticketNumber;
      });

      const { pageItems, page, totalPages } = paginateItems(
        sortedTickets,
        ctx,
        'ed_tickets_page',
        t => `${t.ticketNumber}. ${t.question} ${t.studentName || ''}`,
        10,
        2900
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
          const studentInfo = t.studentName ? ` _(${t.studentName})_` : '';
          text += `  ${this.getStatusEmoji(t.status)} *№${t.ticketNumber}.* ${safeQuestion}${studentInfo}\n`;
        }
        text += '\n';

        const reviewable = subTickets.filter(
          t => t.status === TicketStatus.ON_CHECK || t.status === TicketStatus.APPROVED
        );

        if (reviewable.length > 0) {
          keyboard.text(`📘 ${subjectName}`, 'noop').row();
          for (let i = 0; i < reviewable.length; i += 4) {
            const chunk = reviewable.slice(i, i + 4);
            for (const t of chunk) {
              keyboard.text(
                `${this.getStatusEmoji(t.status)} №${t.ticketNumber}`,
                `ed_review:${t.ticketId}`
              );
            }
            keyboard.row();
          }
        }
      }

      text += `⚪ — не сдан | 🟡 — на проверке | 🔴 — доработка | 🟢 — принят`;
      appendPaginationButtons(keyboard, page, totalPages, 'ed_page');
    }

    if (notice) text += `\n\n${notice}`;

    keyboard.text('🔄 Обновить очередь', 'ed_tick:refresh');

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

    if (data.startsWith('ed_page:')) {
      ctx.session.meta.ed_tickets_page = parseInt(data.split(':')[1], 10);
      return this;
    }

    if (data === 'ed_tick:refresh') return this;

    if (data.startsWith('ed_review:')) {
      const ticketId = parseInt(data.split(':')[1], 10);
      ctx.session.meta.reviewTicketId = ticketId;
      delete ctx.session.meta.edActionMode;
      return new EditorTicketReviewScreen();
    }

    return null;
  }
}

