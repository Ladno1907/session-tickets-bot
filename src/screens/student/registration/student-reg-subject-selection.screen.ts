import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { studentService } from '../../../services/StudentService.js';
import { StudentRegistrationScreen } from './student-registration.screen.js';

/**
 * Экран множественного выбора предметов (чекбоксы ✅/⬜) для подготовки билетов
 * или подачи заявки в редакторы на этапе регистрации.
 */
export class StudentRegSubjectSelectionScreen implements BaseScreen {
  readonly id = 'student_reg_subject_selection';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) {
      throw new Error('Пользователь не определен.');
    }

    const type = ctx.session.meta?.selectionType as 'student' | 'editor';
    const selectedIds: number[] = ctx.session.meta?.selectedSubjectIds || [];
    const allSubjects = await studentService.getAllSubjects();

    let text = type === 'student'
      ? `📚 *Выбор предметов для подготовки билетов*\n\nОтметьте предметы, по которым вы будете сдавать решения билетов:`
      : `👑 *Подача заявки на редакторство*\n\nОтметьте предметы, которые вы хотите проверять в качестве модератора/редактора:`;

    if (notice) {
      text += `\n\n${notice}`;
    }

    const keyboard = new InlineKeyboard();

    if (allSubjects.length === 0) {
      text += '\n\n❌ В системе пока нет доступных предметов. Обратитесь к администратору.';
    } else {
      allSubjects.forEach((sub) => {
        const isSelected = selectedIds.includes(sub.subjectId);
        const prefix = isSelected ? '✅ ' : '⬜ ';
        keyboard.text(`${prefix}${sub.subjectName}`, `toggle_subject:${sub.subjectId}`).row();
      });
    }

    keyboard.text('💾 Сохранить изменения', 'save_subjects').row();
    keyboard.text('❌ Отмена', 'cancel_selection');

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

    if (data === 'cancel_selection') {
      this.cleanupSession(ctx);
      return new StudentRegistrationScreen();
    }

    if (data.startsWith('toggle_subject:')) {
      const subjectId = parseInt(data.split(':')[1], 10);
      let selectedIds: number[] = ctx.session.meta.selectedSubjectIds || [];

      selectedIds = selectedIds.includes(subjectId)
        ? selectedIds.filter((id) => id !== subjectId)
        : [...selectedIds, subjectId];

      ctx.session.meta.selectedSubjectIds = selectedIds;
      ctx.session.currentScreenId = this.id;
      return this;
    }

    if (data === 'save_subjects') {
      const type = ctx.session.meta.selectionType;
      const selectedIds: number[] = ctx.session.meta.selectedSubjectIds || [];

      try {
        if (type === 'student') {
          await studentService.selectSubjectsForPreparation(ctx.from!.id, selectedIds);
          ctx.session.meta.notice = '✅ Список предметов для подготовки успешно обновлен!';
        } else {
          await studentService.expressDesireToBeEditor(ctx.from!.id, selectedIds);
          ctx.session.meta.notice = '✅ Ваши заявки на редакторство успешно сохранены!';
        }

        this.cleanupSession(ctx);
        return new StudentRegistrationScreen();
      } catch (error: any) {
        ctx.session.meta.notice = `❌ Ошибка сохранения: ${error.message || error}`;
        ctx.session.currentScreenId = this.id;
        return this;
      }
    }

    return null;
  }

  private cleanupSession(ctx: MyContext): void {
    delete ctx.session.meta.selectionType;
    delete ctx.session.meta.selectedSubjectIds;
  }
}

