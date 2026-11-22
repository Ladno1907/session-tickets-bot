import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { AdminRegistrationScreen } from './admin-registration.screen.js';
import { AdminRegSubjectEditorsScreen } from './admin-reg-subject-editors.screen.js';
import { AdminRegLoadSubjectsScreen } from './admin-reg-load-subjects.screen.js';
import { AdminRegDeleteSubjectScreen } from './admin-reg-delete-subject.screen.js';

export class AdminRegSelectSubjectScreen implements BaseScreen {
  readonly id = 'admin_reg_select_subject';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) {
      throw new Error("Критическая ошибка: не удалось определить пользователя в контексте grammY.");
    }

    const subjects = await chiefEditorService.getAllSubjects(ctx.from.id);
    const action = ctx.session.meta?.subjectAction;

    let title = '📚 *Панель Администратора: Выбор Предмета*\n\n';
    
    if (action === 'view_students') {
      title += 'Выберите предмет для просмотра списка записавшихся студентов:';
    } else if (action === 'manage_editors') {
      title += 'Выберите предмет для управления его редакторами:';
    } else if (action === 'manage_subjects') {
      title = '📝 *Управление предметами*\n\nВы можете добавить новый предмет (скачать из Google Таблицы) или удалить текущий из бота:';
    }

    if (notice) {
      title += `\n\n${notice}`;
    }

    const keyboard = new InlineKeyboard();
    
    if (action === 'manage_subjects') {
      keyboard.text('📥 Загрузить новый предмет', 'sub_op:load').row();
      keyboard.text('🗑️ Удалить предмет из системы', 'sub_op:delete').row();
    }

    if (subjects.length === 0) {
      if (action !== 'manage_subjects') {
        title += '\n❌ В системе нет созданных предметов.';
      }
    } else {
      if (action === 'manage_subjects') {
        title += '\n\n*Текущие предметы в системе:*';
      }
      subjects.forEach(sub => {
        keyboard.text(`📘 ${sub.subjectName}`, `select_sub:${sub.subjectId}`).row();
      });
    }

    keyboard.text('⬅️ Вернуться назад', 'back_to_reg_main');

    return {
      displayType: 'main_menu',
      text: title,
      reply_markup: keyboard
    };
  }

  async handle(ctx: MyContext): Promise<BaseScreen | null> {
    const data = ctx.callbackQuery?.data;
    if (!data) return null;

    await ctx.answerCallbackQuery();

    if (data === 'back_to_reg_main') {
      delete ctx.session.meta.subjectAction;
      delete ctx.session.meta.targetSubjectId;
      return new AdminRegistrationScreen();
    }

    if (data === 'sub_op:load') {
      return new AdminRegLoadSubjectsScreen();
    }
    if (data === 'sub_op:delete') {
      return new AdminRegDeleteSubjectScreen();
    }

    if (data.startsWith('select_sub:')) {
      if (!ctx.from) {
        throw new Error("Критическая ошибка: не удалось определить пользователя в контексте grammY.");
      }

      const subjectId = parseInt(data.split(':')[1], 10);
      const action = ctx.session.meta?.subjectAction;
      ctx.session.meta.targetSubjectId = subjectId;

      if (action === 'view_students') {
        const students = await chiefEditorService.getUsersOnSubject(ctx.from.id, subjectId);
        let text = `📚 *Студенты, выбравшие этот предмет*:\n\n`;
        
        if (students.length === 0) {
          text += `❌ На этот предмет пока никто не записался.`;
        } else {
          students.forEach((s, i) => {
            text += `${i + 1}. ${s.userName} (ID: ${s.telegramId})\n`;
          }); 
        }
        
        delete ctx.session.meta.subjectAction;
        delete ctx.session.meta.targetSubjectId;
        ctx.session.meta.notice = text;
        return new AdminRegistrationScreen();
      }

      if (action === 'manage_editors') {
        return new AdminRegSubjectEditorsScreen();
      }
      
      if (action === 'manage_subjects') {
        return this; 
      }
    }

    return null;
  }
}
