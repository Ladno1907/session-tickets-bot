import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { AdminPreparationScreen } from './admin-preparation.screen.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';

/**
 * Экран загрузки предметов и билетов из Google Sheets на подготовительном этапе.
 */
export class AdminPrepLoadSubjectsScreen implements BaseScreen {
  readonly id = 'admin_prep_load_subjects';

  render(_: MyContext, notice?: string): RenderResult {
    let text = '📚 *Загрузка данных из Google Таблиц*\n\n' +
               'Введите названия предметов (они должны строго совпадать с названиями листов в таблице) через запятую:';

    if (notice) {
      text += `\n\n${notice}`;
    }

    return {
      displayType: 'main_menu',
      text,
      reply_markup: new InlineKeyboard().text('❌ Отмена', 'cancel_input'),
    };
  }

  async handle(ctx: MyContext): Promise<BaseScreen | null> {
    if (ctx.callbackQuery?.data === 'cancel_input') {
      await ctx.answerCallbackQuery();
      return new AdminPreparationScreen();
    }

    if (ctx.message?.text) {
      const subjects = ctx.message.text
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (subjects.length === 0) {
        ctx.session.meta.notice = '⚠️ Вы не ввели ни одного предмета. Попробуйте еще раз:';
        return this;
      }

      try {
        await chiefEditorService.loadSubjectsAndTicketsFromSheets(ctx.from!.id, subjects);
        ctx.session.meta.notice = `✅ Успешно загружено предметов: ${subjects.length}`;
        return new AdminPreparationScreen();
      } catch (error: any) {
        if (error.message === 'SHEET_NOT_FOUND') {
          ctx.session.meta.notice = '❌ Ошибка: Один из указанных листов не найден в вашей Google Таблице. Проверьте названия и регистр букв.';
        } else {
          ctx.session.meta.notice = `❌ Ошибка синхронизации: ${error.message || error}`;
        }
        return new AdminPreparationScreen();
      }
    }

    return null;
  }
}

