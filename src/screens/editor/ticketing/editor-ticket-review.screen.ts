import { InlineKeyboard } from 'grammy';
import { existsSync } from 'node:fs';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { TicketStatus } from '../../../types/entities.js';
import { editorService } from '../../../services/EditorService.js';
import { ticketFileStorage } from '../../../storage/TicketFileStorage.js';
import { EditorTicketingScreen } from './editor-ticketing.screen.js';
import { escapeMarkdown } from '../../../utils/format.js';

/**
 * Карточка проверки конкретного билета Редактором.
 * Отправляет прикреплённый файл решения вместе с клавиатурой действий:
 * принятие (`APPROVED`), отправка на доработку с комментарием (`ON_REWORK`) и замена файла.
 */
export class EditorTicketReviewScreen implements BaseScreen {
  readonly id = 'editor_ticket_review';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    const ticketId = ctx.session.meta?.reviewTicketId;
    const mode = ctx.session.meta?.edActionMode as 'rework' | 'replace' | undefined;

    if (!ticketId) {
      return {
        displayType: 'main_menu',
        text: '❌ Ошибка: билет не выбран.',
        reply_markup: new InlineKeyboard().text('⬅️ Назад', 'ed_act:back'),
      };
    }

    const ticket = await editorService.getTicket(ctx.from!.id, ticketId);
    if (!ticket) {
      return {
        displayType: 'main_menu',
        text: '❌ Билет не найден или недоступен для проверки.',
        reply_markup: new InlineKeyboard().text('⬅️ Назад', 'ed_act:back'),
      };
    }

    // Режим ввода комментария при отправке на доработку
    if (mode === 'rework') {
      let text = `✏️ *Отправка на доработку — Билет №${ticket.ticketNumber}* (${escapeMarkdown(ticket.subjectName)})\n\n` +
                 `Напишите текстовым сообщением, что нужно исправить студенту:`;
      if (notice) text += `\n\n${notice}`;

      return {
        displayType: 'main_menu',
        text,
        reply_markup: new InlineKeyboard().text('❌ Отмена', 'ed_act:cancel_mode'),
      };
    }

    // Режим загрузки нового файла редактором
    if (mode === 'replace') {
      let text = `📤 *Замена файла — Билет №${ticket.ticketNumber}* (${escapeMarkdown(ticket.subjectName)})\n\n` +
                 `Отправьте новый *файл (документ)* в этот чат:`;
      if (notice) text += `\n\n${notice}`;

      return {
        displayType: 'main_menu',
        text,
        reply_markup: new InlineKeyboard().text('❌ Отмена', 'ed_act:cancel_mode'),
      };
    }

    // Основной режим просмотра карточки билета
    const statusText = ticket.status === TicketStatus.APPROVED ? '🟢 Принят' : '🟡 На проверке';
    let text = `🎫 *Билет №${ticket.ticketNumber}* (${escapeMarkdown(ticket.subjectName)})\n\n` +
               `❓ *Вопрос:* ${escapeMarkdown(ticket.question)}\n` +
               `👤 *Студент:* ${escapeMarkdown(ticket.studentName || 'Неизвестно')}\n` +
               `📊 *Статус:* ${statusText}\n`;

    if (ticket.studentComment) {
      text += `\n💬 *Комментарий студента:* ${escapeMarkdown(ticket.studentComment)}\n`;
    }
    if (ticket.editorComment) {
      text += `\n✏️ *Предыдущее замечание:* ${escapeMarkdown(ticket.editorComment)}\n`;
    }
    if (notice) text += `\n${notice}`;

    let documentPath: string | undefined;
    if (ticket.fileVersion && ticket.fileExtension) {
      const candidatePath = ticketFileStorage.getFilePath(
        ticket.subjectName,
        ticket.ticketNumber,
        ticket.fileVersion,
        ticket.fileExtension
      );
      if (existsSync(candidatePath)) {
        documentPath = candidatePath;
        // Лимит подписи к документу в Telegram API — 1024 символа
        if (text.length > 1000) {
          text = text.slice(0, 997) + '...';
        }
      } else {
        text += `\n⚠️ _Файл решения не найден на сервере._`;
      }
    }

    const kb = new InlineKeyboard();
    if (ticket.status === TicketStatus.ON_CHECK) {
      kb.text('✅ Принять', `ed_act:approve:${ticketId}`)
        .text('🔄 На доработку', `ed_act:rework:${ticketId}`)
        .row();
    }
    kb.text('📤 Заменить файл', `ed_act:replace:${ticketId}`).row()
      .text('⬅️ К списку билетов', 'ed_act:back');

    return {
      displayType: 'main_menu',
      text,
      reply_markup: kb,
      documentPath,
    };
  }

  async handle(ctx: MyContext): Promise<BaseScreen | null> {
    const ticketId = ctx.session.meta?.reviewTicketId;
    const mode = ctx.session.meta?.edActionMode as 'rework' | 'replace' | undefined;

    // 1. Обработка инлайн-кнопок
    if (ctx.callbackQuery?.data) {
      const data = ctx.callbackQuery.data;
      await ctx.answerCallbackQuery();

      if (data === 'ed_act:back') {
        delete ctx.session.meta.reviewTicketId;
        delete ctx.session.meta.edActionMode;
        return new EditorTicketingScreen();
      }

      if (data === 'ed_act:cancel_mode') {
        delete ctx.session.meta.edActionMode;
        return this;
      }

      const [, action] = data.split(':');

      if (action === 'approve' && ticketId) {
        try {
          const ticketView = await editorService.acceptTicket(ctx.from!.id, ticketId);
          if (ticketView.studentId) {
            await ctx.api.sendMessage(
              ticketView.studentId,
              `✅ Ваш билет *№${ticketView.ticketNumber}* по предмету *${escapeMarkdown(ticketView.subjectName)}* принят редактором!`,
              { parse_mode: 'Markdown' }
            ).catch(() => {});
          }
          delete ctx.session.meta.reviewTicketId;
          delete ctx.session.meta.edActionMode;
          ctx.session.meta.notice = `✅ Билет №${ticketView.ticketNumber} (${escapeMarkdown(ticketView.subjectName)}) принят!`;
          return new EditorTicketingScreen();
        } catch (e: any) {
          ctx.session.meta.notice = `❌ Ошибка: ${e.message || e}`;
          return this;
        }
      }

      if (action === 'rework') {
        ctx.session.meta.edActionMode = 'rework';
        return this;
      }

      if (action === 'replace') {
        ctx.session.meta.edActionMode = 'replace';
        return this;
      }
    }

    // 2. Ввод комментария для отправки на доработку
    if (mode === 'rework' && ctx.message?.text && ticketId) {
      const comment = ctx.message.text.trim();
      try {
        const ticketView = await editorService.sendTicketForRework(ctx.from!.id, ticketId, comment);
        if (ticketView.studentId) {
          await ctx.api.sendMessage(
            ticketView.studentId,
            `🔄 Ваш билет *№${ticketView.ticketNumber}* по предмету *${escapeMarkdown(ticketView.subjectName)}* отправлен на доработку.\n\n` +
            `💬 *Комментарий редактора:* ${escapeMarkdown(comment)}`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }
        delete ctx.session.meta.reviewTicketId;
        delete ctx.session.meta.edActionMode;
        ctx.session.meta.notice = `🔄 Билет №${ticketView.ticketNumber} отправлен на доработку!`;
        return new EditorTicketingScreen();
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка: ${e.message || e}`;
        delete ctx.session.meta.edActionMode;
        return this;
      }
    }

    // 3. Загрузка нового документа при замене файла редактором
    if (mode === 'replace' && ctx.message?.document && ticketId) {
      try {
        const doc = ctx.message.document;
        const ext = doc.file_name ? doc.file_name.slice(doc.file_name.lastIndexOf('.')) : '.bin';

        const ticketView = await editorService.getTicket(ctx.from!.id, ticketId);
        if (!ticketView) throw new Error('Билет не найден');

        const newVersion = await editorService.replaceTicket(ctx.from!.id, ticketId, ext);
        await ticketFileStorage.saveTelegramDocument(
          ctx.api,
          doc.file_id,
          ticketView.subjectName,
          ticketView.ticketNumber,
          newVersion
        );

        delete ctx.session.meta.edActionMode;
        ctx.session.meta.notice = `✅ Файл билета успешно заменён (версия v${newVersion})!`;
        return this;
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка замены файла: ${e.message || e}`;
        delete ctx.session.meta.edActionMode;
        return this;
      }
    }

    return null;
  }
}

