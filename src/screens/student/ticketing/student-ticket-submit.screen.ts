import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { TicketStatus } from '../../../types/entities.js';
import { studentService } from '../../../services/StudentService.js';
import { ticketFileStorage } from '../../../storage/TicketFileStorage.js';
import { StudentTicketSelectScreen } from './student-ticket-select.screen.js';
import { StudentTicketingScreen } from './student-ticketing.screen.js';
import { escapeMarkdown } from '../../../utils/format.js';

/**
 * Экран загрузки файла решения для выбранного билета Студентом.
 * Принимает документ до 20 МБ (с опциональной подписью-комментарием), сохраняет на диск
 * и переводит билет в статус `ON_CHECK`.
 */
export class StudentTicketSubmitScreen implements BaseScreen {
  readonly id = 'student_ticket_submit';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    const ticketId = ctx.session.meta?.targetTicketId;
    let ticketHeader = '';

    if (ticketId && ctx.from) {
      const tickets = await studentService.getTicketsForStudent(ctx.from.id);
      const target = tickets.find((t) => t.ticketId === ticketId);
      if (target) {
        ticketHeader = `📘 *${escapeMarkdown(target.subjectName)} — Билет №${target.ticketNumber}*\n` +
                       `❓ *Вопрос:* ${escapeMarkdown(target.question)}\n`;
        if (target.status === TicketStatus.ON_REWORK && target.editorComment) {
          ticketHeader += `✏️ *Замечание редактора:* ${escapeMarkdown(target.editorComment)}\n`;
        }
        ticketHeader += `\n`;
      }
    }

    let text = `📄 *Загрузка решения билета*\n\n` +
               `${ticketHeader}` +
               `Отправьте *файл (документ)* с решением в этот чат.\n` +
               `_При необходимости добавьте комментарий в подпись к файлу._`;

    if (notice) text += `\n\n${notice}`;

    return {
      displayType: 'main_menu',
      text,
      reply_markup: new InlineKeyboard().text('❌ Отмена', 'st_upload:cancel'),
    };
  }

  async handle(ctx: MyContext): Promise<BaseScreen | null> {
    if (ctx.callbackQuery?.data === 'st_upload:cancel') {
      await ctx.answerCallbackQuery();
      delete ctx.session.meta.targetTicketId;
      return new StudentTicketSelectScreen();
    }

    if (ctx.message?.document) {
      const ticketId = ctx.session.meta?.targetTicketId;
      if (!ticketId) return new StudentTicketingScreen();

      try {
        const doc = ctx.message.document;
        if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
          ctx.session.meta.notice = '⚠️ Файл слишком большой (максимум 20 МБ). Сожмите его и отправьте снова.';
          return this;
        }

        const tickets = await studentService.getTicketsForStudent(ctx.from!.id);
        const currentTicket = tickets.find((t) => t.ticketId === ticketId);
        if (!currentTicket) throw new Error('Билет не найден');

        const ext = doc.file_name ? doc.file_name.slice(doc.file_name.lastIndexOf('.')) : '.bin';

        const res = await studentService.submitTicketById(
          ctx.from!.id,
          ticketId,
          ext,
          ctx.message.caption
        );

        try {
          await ticketFileStorage.saveTelegramDocument(
            ctx.api,
            doc.file_id,
            res.subjectName,
            res.ticketNumber,
            res.version
          );
        } catch (downloadErr) {
          await studentService.revertTicketStatus(ticketId);
          throw downloadErr;
        }

        delete ctx.session.meta.targetTicketId;
        ctx.session.meta.notice = `✅ Билет №${res.ticketNumber} (${escapeMarkdown(res.subjectName)}) отправлен на проверку!`;
        return new StudentTicketingScreen();
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка отправки: ${e.message || e}`;
        return new StudentTicketingScreen();
      }
    }

    if (ctx.message) {
      ctx.session.meta.notice = '⚠️ Пожалуйста, отправьте решение именно как *файл (документ)*, а не текстом или сжатым фото.';
      return this;
    }

    return null;
  }
}

