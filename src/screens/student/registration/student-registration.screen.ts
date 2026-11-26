import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { studentService } from '../../../services/StudentService.js';
import { StudentRegSubjectSelectionScreen } from './student-reg-subject-selection.screen.js';
import { escapeMarkdown } from '../../../utils/format.js';
import { FeedbackScreen } from '../../feedback.screen.js';

/**
 * Главный экран личного кабинета Студента на этапе регистрации (`REGISTRATION`).
 * Отображает ФИО, статус редактора (если назначен), выбранные предметы и заявки.
 */
export class StudentRegistrationScreen implements BaseScreen {
  readonly id = 'student_registration';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) {
      throw new Error('Критическая ошибка: пользователь не найден в контексте.');
    }

    const user = await studentService.getUserById(ctx.from.id);
    if (!user) {
      return {
        displayType: 'main_menu',
        text: 'Перенаправление на регистрацию...',
        forceNew: true,
      };
    }

    const prepSubjects = await studentService.getSelectedSubjectsForPreparation(ctx.from.id);
    const editSubjects = await studentService.getRequestedEditorSubjects(ctx.from.id);

    const prepText = prepSubjects.length > 0
      ? prepSubjects.map((s) => `• ${escapeMarkdown(s.name)}`).join('\n')
      : '❌ Предметы не выбраны';

    const editText = editSubjects.length > 0
      ? editSubjects.map((s) => `• ${escapeMarkdown(s.name)}`).join('\n')
      : '❌ Заявки не поданы';

    const roleStatusText = user.editor === 1
      ? `\n⭐ *Особый статус:* Вы утверждены в качестве *Редактора* системы! По завершении регистрации вам станет доступна команда /editor для проверки билетов.\n`
      : '';

    let text = `👤 *Личный кабинет студента*\n\n` +
               `*ФИО:* ${escapeMarkdown(user.userName)}\n` +
               `${roleStatusText}\n` +
               `📘 *Предметы для подготовки билетов*:\n${prepText}\n\n` +
               `👑 *Заявки на редакторство*:\n${editText}\n\n` +
               `_Вы можете в любой момент изменить свой выбор до окончания этапа регистрации._`;

    if (notice) {
      text += `\n\n${notice}`;
    }

    const keyboard = new InlineKeyboard()
      .text('✏️ Изменить предметы подготовки', 'select_type:student').row()
      .text('👑 Изменить заявки в редакторы', 'select_type:editor').row()
      .text('🔄 Обновить меню', 'refresh_user_menu').row()
      .text('💬 Обратная связь', 'open_feedback');

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

    if (data === 'refresh_user_menu') {
      return this;
    }

    if (data.startsWith('select_type:')) {
      if (!ctx.from) return null;

      const type = data.split(':')[1] as 'student' | 'editor';
      ctx.session.meta.selectionType = type;

      const current = type === 'student'
        ? await studentService.getSelectedSubjectsForPreparation(ctx.from.id)
        : await studentService.getRequestedEditorSubjects(ctx.from.id);

      ctx.session.meta.selectedSubjectIds = current.map((s) => s.id);
      return new StudentRegSubjectSelectionScreen();
    }

    if (data === 'open_feedback') {
      ctx.session.meta.fbReturnScreenId = this.id;
      ctx.session.meta.fbRoleLabel = 'Студент (/user)';
      return new FeedbackScreen();
    }

    return null;
  }
}

