import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { bot } from '../../../bot.js';
import { messageManager } from '../../../managers/MessageManager.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { escapeMarkdown } from '../../../utils/format.js';
import { AdminTicketingScreen } from './admin-ticketing.screen.js';

type BroadcastMode =
  | 'all'
  | 'students'
  | 'editors'
  | 'students_by_sub'
  | 'editors_by_sub'
  | 'by_fio';

/**
 * Экран массовой рассылки объявлений администратора с гибкими фильтрами:
 * всем, студентам, редакторам, по выбранным предметам или выборочно по ФИО.
 */
export class AdminTickBroadcastScreen implements BaseScreen {
  readonly id = 'admin_tick_broadcast';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) throw new Error('Пользователь не найден.');

    const mode = ctx.session.meta?.bcMode as BroadcastMode | undefined;
    const step = (ctx.session.meta?.bcStep as 'select_mode' | 'select_subjects' | 'select_fio' | 'input_text') || 'select_mode';

    const keyboard = new InlineKeyboard();
    let text = `📢 *Массовая рассылка сообщений*\n\n`;

    if (step === 'select_mode' || !mode) {
      text += `Выберите кому отправить объявление:`;
      keyboard
        .text('👥 Всем участникам', 'bc_mode:all').row()
        .text('🎓 Всем студентам', 'bc_mode:students').row()
        .text('👑 Всем редакторам', 'bc_mode:editors').row()
        .text('📘 Студентам по предмету(-ам)', 'bc_mode:students_by_sub').row()
        .text('👑 Редакторам по предмету(-ам)', 'bc_mode:editors_by_sub').row()
        .text('👤 Выборочно по ФИ', 'bc_mode:by_fio').row()
        .text('⬅️ Отмена', 'bc_act:cancel');
    }

    else if (step === 'select_subjects') {
      const selectedIds: number[] = ctx.session.meta?.bcSubjectIds || [];
      const subjects = await chiefEditorService.getAllSubjects(ctx.from.id);
      const roleTitle = mode === 'students_by_sub' ? 'студентов' : 'редакторов';

      text += `📚 *Выбор предметов для ${roleTitle}*\n\n` +
              `Отметьте один или несколько предметов и нажмите «Далее»:`;

      for (const sub of subjects) {
        const checked = selectedIds.includes(sub.subjectId) ? '✅ ' : '⬜ ';
        keyboard.text(`${checked}${sub.subjectName}`, `bc_sub_toggle:${sub.subjectId}`).row();
      }

      if (selectedIds.length > 0) {
        keyboard.text(`➡️ Далее (выбрано: ${selectedIds.length})`, 'bc_act:subjects_done').row();
      }
      keyboard.text('⬅️ Назад', 'bc_act:reset');
    }

    else if (step === 'select_fio') {
      const users = await chiefEditorService.getAllRegisteredUsers(ctx.from.id);
      text += `👤 *Выборочная рассылка по ФИ*\n\n` +
              `Введите *номера из списка* или *Фамилии / Имена* через запятую:\n\n`;

      if (users.length === 0) {
        text += `_В системе нет зарегистрированных пользователей._`;
      } else {
        const listLines = users.map((u, idx) => `${idx + 1}. ${escapeMarkdown(u.name)}`);
        const joined = listLines.join('\n');
        text += joined.length > 3200 ? joined.slice(0, 3200) + '\n_...список обрезан, используйте поиск по фамилии_' : joined;
      }

      keyboard.text('⬅️ Назад', 'bc_act:reset');
    }

    else if (step === 'input_text') {
      const recipients: number[] = ctx.session.meta?.bcRecipients || [];
      text += `✏️ *Ввод текста объявления*\n\n` +
              `🎯 Найдено получателей: *${recipients.length}*\n\n` +
              `Отправьте следующим текстовым сообщением текст объявления — бот разошлёт его выбранным участникам:`;
      keyboard.text('❌ Отмена', 'bc_act:cancel');
    }

    if (notice) {
      text += `\n\n${notice}`;
    }

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

      if (data === 'bc_act:cancel') {
        this.cleanupSession(ctx);
        return new AdminTicketingScreen();
      }

      if (data === 'bc_act:reset') {
        this.cleanupSession(ctx);
        return this;
      }

      if (data.startsWith('bc_mode:')) {
        const [, mode] = data.split(':');
        ctx.session.meta.bcMode = mode as BroadcastMode;

        if (mode === 'all' || mode === 'students' || mode === 'editors') {
          ctx.session.meta.bcRecipients = await chiefEditorService.getBroadcastRecipientIds(ctx.from.id, mode);
          ctx.session.meta.bcStep = 'input_text';
          return this;
        }

        if (mode === 'students_by_sub' || mode === 'editors_by_sub') {
          ctx.session.meta.bcSubjectIds = [];
          ctx.session.meta.bcStep = 'select_subjects';
          return this;
        }

        if (mode === 'by_fio') {
          ctx.session.meta.bcStep = 'select_fio';
          return this;
        }
      }

      if (data.startsWith('bc_sub_toggle:')) {
        const [, rawId] = data.split(':');
        const subId = parseInt(rawId, 10);
        const current: number[] = ctx.session.meta.bcSubjectIds || [];
        ctx.session.meta.bcSubjectIds = current.includes(subId)
          ? current.filter((id) => id !== subId)
          : [...current, subId];
        return this;
      }

      if (data === 'bc_act:subjects_done') {
        const mode = ctx.session.meta.bcMode as 'students_by_sub' | 'editors_by_sub';
        const subjectIds: number[] = ctx.session.meta.bcSubjectIds || [];
        const role = mode === 'students_by_sub' ? 'students' : 'editors';

        const recipients = await chiefEditorService.getBroadcastRecipientsBySubjects(ctx.from.id, role, subjectIds);
        if (recipients.length === 0) {
          ctx.session.meta.notice = '⚠️ По выбранным предметам не найдено ни одного получателя.';
          return this;
        }

        ctx.session.meta.bcRecipients = recipients;
        ctx.session.meta.bcStep = 'input_text';
        return this;
      }
    }

    const step = ctx.session.meta?.bcStep;

    if (step === 'select_fio' && ctx.message?.text) {
      const { matched, missed } = await chiefEditorService.resolveBroadcastUsersByQuery(
        ctx.from.id,
        ctx.message.text
      );

      if (matched.length === 0) {
        ctx.session.meta.notice = `⚠️ Никто не найден по запросу: ${escapeMarkdown(ctx.message.text)}. Попробуйте снова:`;
        return this;
      }

      ctx.session.meta.bcRecipients = matched.map((m) => m.telegramId);
      ctx.session.meta.bcStep = 'input_text';

      const namesList = matched.map((m) => escapeMarkdown(m.name)).join(', ');
      let info = `✅ Выбраны: *${namesList}*`;
      if (missed.length > 0) {
        info += `\n⚠️ Не найдены: ${escapeMarkdown(missed.join(', '))}`;
      }
      ctx.session.meta.notice = info;
      return this;
    }

    if (step === 'input_text' && ctx.message?.text) {
      const msgText = ctx.message.text.trim();
      const recipients: number[] = ctx.session.meta?.bcRecipients || [];

      if (!msgText) return this;

      try {
        await messageManager.broadcastTextToUsers(
          bot,
          recipients,
          `📢 *Объявление от администратора:*\n\n${msgText}`
        );

        this.cleanupSession(ctx);
        ctx.session.meta.notice = `✅ Рассылка успешно отправлена *${recipients.length}* получателям!`;
        return new AdminTicketingScreen();
      } catch (e: any) {
        this.cleanupSession(ctx);
        ctx.session.meta.notice = `❌ Ошибка рассылки: ${e.message || e}`;
        return new AdminTicketingScreen();
      }
    }

    return null;
  }

  private cleanupSession(ctx: MyContext): void {
    delete ctx.session.meta.bcMode;
    delete ctx.session.meta.bcStep;
    delete ctx.session.meta.bcSubjectIds;
    delete ctx.session.meta.bcRecipients;
  }
}

