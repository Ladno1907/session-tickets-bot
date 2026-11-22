import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { AdminPreparationScreen } from './admin-preparation.screen.js';

/**
 * Экран ввода даты дедлайна (в формате `YYYY-MM-DD`, сохраняется как `23:00` МСК / `20:00` UTC).
 */
export class AdminPrepDateInputScreen implements BaseScreen {
  readonly id = 'admin_prep_date_input';

  render(ctx: MyContext, notice?: string): RenderResult {
    const targetField = ctx.session.meta?.targetField;

    const fieldNames: Record<string, string> = {
      registrationEnd: 'окончания регистрации',
      distributionEnd: 'окончания распределения',
      ticketingEnd: 'окончания подготовки (билетов)',
    };

    const name = fieldNames[targetField] || 'дедлайна';
    let text = `✏️ Введите дату ${name} в формате \`YYYY-MM-DD\`:`;

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
      const input = ctx.message.text.trim();
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

      if (!dateRegex.test(input)) {
        ctx.session.meta.notice = '⚠️ Неверный формат! Напишите дату строго в формате YYYY-MM-DD:';
        return this;
      }

      const targetField = ctx.session.meta?.targetField;
      if (!targetField) {
        ctx.session.meta.notice = '❌ Ошибка: Потерян контекст операции. Вернитесь в меню.';
        return new AdminPreparationScreen();
      }

      try {
        const [year, month, day] = input.split('-').map(Number);
        const isoDate = new Date(Date.UTC(year, month - 1, day, 20, 0, 0, 0)).toISOString();

        await chiefEditorService.setDeadlines(ctx.from!.id, {
          [targetField]: isoDate,
        });

        ctx.session.meta.notice = '✅ Дедлайн успешно обновлен!';
        return new AdminPreparationScreen();
      } catch (error: any) {
        ctx.session.meta.notice = `❌ Ошибка сохранения: ${error.message || error}`;
        return new AdminPreparationScreen();
      }
    }

    return null;
  }
}

