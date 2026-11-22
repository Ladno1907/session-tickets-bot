import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { AdminPreparationScreen } from './admin-preparation.screen.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';

export class AdminPrepDeleteSubjectScreen implements BaseScreen {
  readonly id = 'admin_prep_delete_subject';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) {
      throw new Error("Критическая ошибка: не удалось определить пользователя в контексте grammY.");
    }

    const stats = await chiefEditorService.getPreparationStats(ctx.from.id);

    const keyboard = new InlineKeyboard();

    let text = '🗑 *Удаление предметов*\n\nВыберите предмет, который хотите ПОЛНОСТЬЮ стереть из системы:';

    if (stats.length === 0) {
      keyboard.text('⬅️ Назад', 'back_to_prep');
      
      let emptyText = '🗑 *Удаление предметов*\n\nВ системе еще нет ни одного предмета.';
      if (notice) {
        emptyText += `\n\n${notice}`;
      }

      return {
        displayType: 'main_menu',
        text: emptyText,
        reply_markup: keyboard
      };
    }

    for (const sub of stats) {
      keyboard.text(`❌ Удалить: ${sub.name}`, `del_sub:${sub.subjectId}`).row();
    }

    keyboard.text('⬅️ Отмена', 'back_to_prep');

    if (notice) {
      text += `\n\n${notice}`;
    }

    return {
      displayType: 'main_menu',
      text: text,
      reply_markup: keyboard
    };
  }

  async handle(ctx: MyContext): Promise<BaseScreen | null> {
    const data = ctx.callbackQuery?.data;
    if (!data) return null;

    await ctx.answerCallbackQuery();

    if (data === 'back_to_prep') {
      return new AdminPreparationScreen();
    }

    if (data.startsWith('del_sub:')) {
      const subjectId = parseInt(data.split(':')[1], 10);

      try {
        await chiefEditorService.deleteSubjectByIdWithAllData(ctx.from!.id, subjectId);

        ctx.session.meta.notice = `🗑 Предмет успешно удален отовсюду!`;
        return this;

      } catch (error: any) {
        ctx.session.meta.notice = `❌ Ошибка удаления: ${error.message || error}`;
        return this;
      }
    }

    return null;
  }
}
