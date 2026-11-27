import { InlineKeyboard } from 'grammy';
import { existsSync } from 'node:fs';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { TicketStatus } from '../../../types/entities.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { ticketFileStorage } from '../../../storage/TicketFileStorage.js';
import { paginateItems, appendPaginationButtons } from '../../pagination.js';
import { escapeMarkdown } from '../../../utils/format.js';
import { AdminTicketingScreen } from './admin-ticketing.screen.js';

type TicketsAdminMode = 'subjects' | 'list' | 'card' | 'pick_student' | 'pick_editor';

/**
 * Экран ручного управления билетами и назначениями для Администратора:
 * просмотр карточки билета, смена студента/редактора, принудительное принятие или сброс статуса.
 */
export class AdminTickTicketsScreen implements BaseScreen {
  readonly id = 'admin_tick_tickets';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) throw new Error('Пользователь не найден.');

    const mode = (ctx.session.meta?.admTkMode as TicketsAdminMode) || 'subjects';
    const subjectId = ctx.session.meta?.admTkSubjectId as number | undefined;
    const ticketId = ctx.session.meta?.admTkTicketId as number | undefined;

    // -----------------------------------------------------------------------
    // РЕЖИМ 1: ВЫБОР ПРЕДМЕТА
    // -----------------------------------------------------------------------
    if (mode === 'subjects' || !subjectId) {
      const subjects = await chiefEditorService.getAllSubjects(ctx.from.id);
      let text = `🎫 *Управление билетами и назначениями*\n\n` +
                 `Выберите предмет для просмотра билетов:`;
      if (notice) text += `\n\n${notice}`;

      const keyboard = new InlineKeyboard();
      for (let i = 0; i < subjects.length; i += 2) {
        const chunk = subjects.slice(i, i + 2);
        for (const sub of chunk) {
          keyboard.text(`📘 ${sub.subjectName}`, `adm_tk_sub:${sub.subjectId}`);
        }
        keyboard.row();
      }
      keyboard.text('⬅️ Назад в панель', 'adm_tk:exit');

      return {
        displayType: 'main_menu',
        text,
        reply_markup: keyboard,
      };
    }

    // -----------------------------------------------------------------------
    // РЕЖИМ 2: СПИСОК БИЛЕТОВ ВЫБРАННОГО ПРЕДМЕТА
    // -----------------------------------------------------------------------
    if (mode === 'list' || !ticketId) {
      const subjects = await chiefEditorService.getAllSubjects(ctx.from.id);
      const currentSub = subjects.find((s) => s.subjectId === subjectId);
      const tickets = await chiefEditorService.getSubjectTicketsForAdmin(ctx.from.id, subjectId);

      let text = `📘 *Билеты предмета: ${escapeMarkdown(currentSub?.subjectName || '')}*\n\n`;

      const keyboard = new InlineKeyboard();

      if (tickets.length === 0) {
        text += `_В этом предмете нет билетов._`;
      } else {
        const { pageItems, page, totalPages } = paginateItems(
          tickets,
          ctx,
          'adm_tk_list_page',
          (t) => `${t.ticketNumber}. ${t.studentName || ''} ${t.question}`,
          12,
          2900
        );

        for (const t of pageItems) {
          const emoji = this.getStatusEmoji(t.status);
          const owner = t.studentName ? escapeMarkdown(t.studentName) : '_Не назначен_';
          text += `${emoji} *№${t.ticketNumber}* — ${owner}\n`;
        }

        for (let i = 0; i < pageItems.length; i += 4) {
          const chunk = pageItems.slice(i, i + 4);
          for (const t of chunk) {
            keyboard.text(`${this.getStatusEmoji(t.status)} №${t.ticketNumber}`, `adm_tk_open:${t.ticketId}`);
          }
          keyboard.row();
        }

        appendPaginationButtons(keyboard, page, totalPages, 'adm_tk_pg');
      }

      if (notice) text += `\n\n${notice}`;

      keyboard.text('⬅️ К выбору предмета', 'adm_tk:to_subjects');

      return {
        displayType: 'main_menu',
        text,
        reply_markup: keyboard,
      };
    }

    // -----------------------------------------------------------------------
    // РЕЖИМ 3: ВЫБОР НОВОГО СТУДЕНТА ИЛИ РЕДАКТОРА ДЛЯ БИЛЕТА
    // -----------------------------------------------------------------------
    if (mode === 'pick_student' || mode === 'pick_editor') {
      const isStudent = mode === 'pick_student';
      const users = await chiefEditorService.getAllRegisteredUsers(ctx.from.id);

      let text = isStudent
        ? `👤 *Назначение студента на билет*\n\nВыберите участника кнопкой ниже или введите его *Фамилию / Имя* текстом:`
        : `👑 *Назначение редактора на билет*\n\nВыберите проверяющего кнопкой ниже или введите его *Фамилию / Имя* текстом:`;

      if (notice) text += `\n\n${notice}`;

      const { pageItems, page, totalPages } = paginateItems(
        users,
        ctx,
        'adm_tk_user_page',
        (u) => u.name,
        10,
        2500
      );

      const keyboard = new InlineKeyboard();
      for (let i = 0; i < pageItems.length; i += 2) {
        const chunk = pageItems.slice(i, i + 2);
        for (const u of chunk) {
          keyboard.text(u.name, `adm_tk_set_user:${u.telegramId}`);
        }
        keyboard.row();
      }

      appendPaginationButtons(keyboard, page, totalPages, 'adm_tk_upg');

      keyboard
        .text(isStudent ? '🚫 Снять студента (Оставить пустым)' : '🚫 Снять редактора', 'adm_tk_set_user:none').row()
        .text('❌ Отмена', 'adm_tk:back_to_card');

      return {
        displayType: 'main_menu',
        text,
        reply_markup: keyboard,
      };
    }

    // -----------------------------------------------------------------------
    // РЕЖИМ 4: КАРТОЧКА КОНКРЕТНОГО БИЛЕТА
    // -----------------------------------------------------------------------
    const ticket = await chiefEditorService.getTicketDetailsForAdmin(ctx.from.id, ticketId);
    if (!ticket) {
      return {
        displayType: 'main_menu',
        text: '❌ Билет не найден.',
        reply_markup: new InlineKeyboard().text('⬅️ Назад', 'adm_tk:to_list'),
      };
    }

    const statusLabels: Record<string, string> = {
      [TicketStatus.APPROVED]: '🟢 Принят',
      [TicketStatus.ON_CHECK]: '🟡 На проверке',
      [TicketStatus.ON_REWORK]: '🔴 На доработке',
      [TicketStatus.IN_PROGRESS]: '⚪ Не сдан (в работе)',
    };
    const statusText = ticket.status ? (statusLabels[ticket.status] || ticket.status) : '⚪ Не назначен';

    let text = `🎫 *Билет №${ticket.ticketNumber}* (${escapeMarkdown(ticket.subjectName)})\n\n` +
               `❓ *Вопрос:* ${escapeMarkdown(ticket.question)}\n\n` +
               `👤 *Студент:* ${ticket.studentName ? escapeMarkdown(ticket.studentName) : '_Не назначен_'}\n` +
               `👑 *Редактор:* ${ticket.editorName ? escapeMarkdown(ticket.editorName) : '_Не назначен_'}\n` +
               `📊 *Статус:* ${statusText}\n`;

    if (ticket.studentComment) {
      text += `💬 *Комментарий студента:* ${escapeMarkdown(ticket.studentComment)}\n`;
    }
    if (ticket.editorComment) {
      text += `✏️ *Комментарий редактора:* ${escapeMarkdown(ticket.editorComment)}\n`;
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
        if (text.length > 1000) {
          text = text.slice(0, 997) + '...';
        }
      } else {
        text += `\n⚠️ _Файл v${ticket.fileVersion} не найден на диске._`;
      }
    }

    const keyboard = new InlineKeyboard()
      .text('👤 Сменить студента', 'adm_tk:pick_student')
      .text('👑 Сменить редактора', 'adm_tk:pick_editor').row()
      .text('🟢 Принять (APPROVED)', 'adm_tk:force_approve')
      .text('⚪ Сбросить статус', 'adm_tk:force_reset').row()
      .text('⬅️ К списку билетов', 'adm_tk:to_list');

    return {
      displayType: 'main_menu',
      text,
      reply_markup: keyboard,
      documentPath,
    };
  }

  async handle(ctx: MyContext): Promise<BaseScreen | null> {
    if (!ctx.from) return null;

    const mode = (ctx.session.meta?.admTkMode as TicketsAdminMode) || 'subjects';
    const ticketId = ctx.session.meta?.admTkTicketId as number | undefined;

    if (ctx.callbackQuery?.data) {
      const data = ctx.callbackQuery.data;
      await ctx.answerCallbackQuery();

      if (data === 'noop') return null;

      if (data === 'adm_tk:exit') {
        this.cleanupSession(ctx);
        return new AdminTicketingScreen();
      }

      if (data === 'adm_tk:to_subjects') {
        delete ctx.session.meta.admTkSubjectId;
        delete ctx.session.meta.admTkTicketId;
        delete ctx.session.meta.adm_tk_list_page;
        ctx.session.meta.admTkMode = 'subjects';
        return this;
      }

      if (data === 'adm_tk:to_list') {
        delete ctx.session.meta.admTkTicketId;
        ctx.session.meta.admTkMode = 'list';
        return this;
      }

      if (data === 'adm_tk:back_to_card') {
        delete ctx.session.meta.adm_tk_user_page;
        ctx.session.meta.admTkMode = 'card';
        return this;
      }

      if (data.startsWith('adm_tk_sub:')) {
        const [, rawSubId] = data.split(':');
        ctx.session.meta.admTkSubjectId = parseInt(rawSubId, 10);
        ctx.session.meta.adm_tk_list_page = 0;
        ctx.session.meta.admTkMode = 'list';
        return this;
      }

      if (data.startsWith('adm_tk_pg:')) {
        const [, rawPage] = data.split(':');
        ctx.session.meta.adm_tk_list_page = parseInt(rawPage, 10);
        return this;
      }

      if (data.startsWith('adm_tk_open:')) {
        const [, rawTid] = data.split(':');
        ctx.session.meta.admTkTicketId = parseInt(rawTid, 10);
        ctx.session.meta.admTkMode = 'card';
        return this;
      }

      if (data === 'adm_tk:pick_student') {
        ctx.session.meta.adm_tk_user_page = 0;
        ctx.session.meta.admTkMode = 'pick_student';
        return this;
      }

      if (data === 'adm_tk:pick_editor') {
        ctx.session.meta.adm_tk_user_page = 0;
        ctx.session.meta.admTkMode = 'pick_editor';
        return this;
      }

      if (data.startsWith('adm_tk_upg:')) {
        const [, rawPage] = data.split(':');
        ctx.session.meta.adm_tk_user_page = parseInt(rawPage, 10);
        return this;
      }

      if (data.startsWith('adm_tk_set_user:') && ticketId) {
        const [, rawUid] = data.split(':');
        const newUid = rawUid === 'none' ? null : parseInt(rawUid, 10);
        try {
          if (mode === 'pick_student') {
            await chiefEditorService.reassignTicketStudent(ctx.from.id, ticketId, newUid);
            ctx.session.meta.notice = '✅ Студент на билете обновлён!';
          } else if (mode === 'pick_editor') {
            await chiefEditorService.reassignTicketEditor(ctx.from.id, ticketId, newUid);
            ctx.session.meta.notice = '✅ Редактор на билете обновлён!';
          }
        } catch (e: any) {
          ctx.session.meta.notice = `❌ Ошибка: ${e.message || e}`;
        }
        delete ctx.session.meta.adm_tk_user_page;
        ctx.session.meta.admTkMode = 'card';
        return this;
      }

      if (data === 'adm_tk:force_approve' && ticketId) {
        try {
          await chiefEditorService.forceSetTicketStatus(ctx.from.id, ticketId, TicketStatus.APPROVED);
          ctx.session.meta.notice = '✅ Статус билета принудительно изменён на «🟢 Принят»!';
        } catch (e: any) {
          ctx.session.meta.notice = `❌ Ошибка: ${e.message || e}`;
        }
        return this;
      }

      if (data === 'adm_tk:force_reset' && ticketId) {
        try {
          await chiefEditorService.forceSetTicketStatus(ctx.from.id, ticketId, TicketStatus.IN_PROGRESS);
          ctx.session.meta.notice = '✅ Статус билета сброшен на «⚪ Не сдан»!';
        } catch (e: any) {
          ctx.session.meta.notice = `❌ Ошибка: ${e.message || e}`;
        }
        return this;
      }
    }

    // Поиск участника по ФИО текстом в режиме pick_student / pick_editor
    if ((mode === 'pick_student' || mode === 'pick_editor') && ctx.message?.text && ticketId) {
      const query = ctx.message.text.trim().toLowerCase();
      const users = await chiefEditorService.getAllRegisteredUsers(ctx.from.id);
      const found = users.find((u) => u.name.toLowerCase().includes(query));
      if (!found) {
        ctx.session.meta.notice = `⚠️ Пользователь «${escapeMarkdown(ctx.message.text)}» не найден в базе. Выберите из списка или введите точнее:`;
        return this;
      }
      try {
        if (mode === 'pick_student') {
          await chiefEditorService.reassignTicketStudent(ctx.from.id, ticketId, found.telegramId);
          ctx.session.meta.notice = `✅ Студент *${escapeMarkdown(found.name)}* назначен на билет!`;
        } else {
          await chiefEditorService.reassignTicketEditor(ctx.from.id, ticketId, found.telegramId);
          ctx.session.meta.notice = `✅ Редактор *${escapeMarkdown(found.name)}* назначен на билет!`;
        }
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка: ${e.message || e}`;
      }
      delete ctx.session.meta.adm_tk_user_page;
      ctx.session.meta.admTkMode = 'card';
      return this;
    }

    return null;
  }

  private getStatusEmoji(status?: TicketStatus): string {
    switch (status) {
      case TicketStatus.APPROVED: return '🟢';
      case TicketStatus.ON_REWORK: return '🔴';
      case TicketStatus.ON_CHECK: return '🟡';
      default: return '⚪';
    }
  }

  private cleanupSession(ctx: MyContext): void {
    delete ctx.session.meta.admTkMode;
    delete ctx.session.meta.admTkSubjectId;
    delete ctx.session.meta.admTkTicketId;
    delete ctx.session.meta.adm_tk_list_page;
    delete ctx.session.meta.adm_tk_user_page;
  }
}
