import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { AdminRegistrationScreen } from './admin-registration.screen.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';

/**
 * Экран удаления предмета из системы во время этапа регистрации.
 */
export class AdminRegDeleteSubjectScreen implements BaseScreen {
  readonly id = 'admin_reg_delete_subject';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) {
      throw new Error('Критическая ошибка: не удалось определить пользователя в контексте grammY.');
    }

    const stats = await chiefEditorService.getPreparationStats(ctx.from.id);
    const keyboard = new InlineKeyboard();

    if (stats.length === 0) {
      keyboard.text('⬅️ Назад', 'back_to_reg');

      let emptyText = '🗑 *Удаление предметов*\n\nВ системе еще нет ни одного предмета.';
      if (notice) {
        emptyText += `\n\n${notice}`;
      }

      return {
        displayType: 'main_menu',
        text: emptyText,
        reply_markup: keyboard,
      };
    }

    let text = '🗑 *Удаление предметов (Этап Регистрации)*\n\nВыберите предмет, который хотите ПОЛНОСТЬЮ стереть из системы:';
    for (const sub of stats) {
      keyboard.text(`❌ Удалить: ${sub.name}`, `del_sub:${sub.subjectId}`).row();
    }
    keyboard.text('⬅️ Отмена', 'back_to_reg');

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
    const data = ctx.callbackQuery?.data;
    if (!data) return null;

    await ctx.answerCallbackQuery();

    if (data === 'back_to_reg') {
      return new AdminRegistrationScreen();
    }

    if (data.startsWith('del_sub:')) {
      const subjectId = parseInt(data.split(':')[1], 10);

      try {
        await chiefEditorService.deleteSubjectByIdWithAllData(ctx.from!.id, subjectId);
        ctx.session.meta.notice = '🗑 Предмет успешно удален отовсюду!';
        return this;
      } catch (error: any) {
        ctx.session.meta.notice = `❌ Ошибка удаления: ${error.message || error}`;
        return this;
      }
    }

    return null;
  }
}

