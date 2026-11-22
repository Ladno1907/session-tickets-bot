import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { AdminRegSelectSubjectScreen } from './admin-reg-select-subject.screen.js';
import { AdminRegSubjectEditorsScreen } from './admin-reg-subject-editors.screen.js';

/**
 * Экран текстового ввода ФИО (или списка через запятую) для назначения или отстранения редакторов.
 */
export class AdminRegEditorFioInputScreen implements BaseScreen {
  readonly id = 'admin_reg_editor_fio_input';

  render(ctx: MyContext, notice?: string): RenderResult {
    const type = ctx.session.meta?.editorInputType;
    const word = type === 'assign' ? 'НАЗНАЧЕНИЯ' : 'ОТСТРАНЕНИЯ';

    let text = `✏️ *Ввод ФИО редактора*\n\n` +
               `Отправьте Фамилию и Имя пользователя для его ${word}.\n` +
               `_Поиск работает частично (можно ввести только фамилию). Можно перечислить через запятую:_`;

    if (notice) {
      text += `\n\n${notice}`;
    }

    return {
      displayType: 'main_menu',
      text,
      reply_markup: new InlineKeyboard().text('❌ Отмена', 'cancel_fio'),
    };
  }

  async handle(ctx: MyContext): Promise<BaseScreen | null> {
    if (ctx.callbackQuery?.data === 'cancel_fio') {
      await ctx.answerCallbackQuery();
      delete ctx.session.meta.editorInputType;
      return new AdminRegSubjectEditorsScreen();
    }

    if (ctx.message?.text) {
      const input = ctx.message.text.trim();
      const type = ctx.session.meta?.editorInputType as 'assign' | 'unassign' | undefined;
      const subjectId = ctx.session.meta?.targetSubjectId;

      const items = input
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);

      if (items.length === 0) {
        ctx.session.meta.notice = '⚠️ Введите корректное имя!';
        return this;
      }

      try {
        if (!ctx.from) {
          throw new Error('Критическая ошибка: не удалось определить пользователя в контексте grammY.');
        }

        if (!type || !subjectId) {
          ctx.session.meta.notice = '❌ Ошибка: сессия ввода устарела. Пожалуйста, выберите предмет заново.';
          return new AdminRegSelectSubjectScreen();
        }

        const allUsers = await chiefEditorService.getAllRegisteredUsers(ctx.from.id);
        let success = 0;
        const missed: string[] = [];

        for (const rawName of items) {
          const found = allUsers.find((u) => u.name.toLowerCase().includes(rawName.toLowerCase()));
          if (found) {
            await chiefEditorService.manageEditor(ctx.from.id, found.telegramId, subjectId, type);
            success++;
          } else {
            missed.push(rawName);
          }
        }

        let report = `✅ Изменения внесены для ${success} пользователей.`;
        if (missed.length > 0) report += `\n❌ Не найдены в базе: ${missed.join(', ')}`;

        delete ctx.session.meta.editorInputType;
        ctx.session.meta.notice = report;
        return new AdminRegSubjectEditorsScreen();
      } catch (error: any) {
        ctx.session.meta.notice = `❌ Ошибка: ${error.message || error}`;
        return new AdminRegSubjectEditorsScreen();
      }
    }

    return null;
  }
}

