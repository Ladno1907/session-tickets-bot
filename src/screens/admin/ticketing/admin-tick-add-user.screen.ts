import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { escapeMarkdown } from '../../../utils/format.js';
import { AdminTicketingScreen } from './admin-ticketing.screen.js';

/**
 * Экран ручного добавления нового участника в БД по Telegram ID и ФИО.
 */
export class AdminTickAddUserScreen implements BaseScreen {
  readonly id = 'admin_tick_add_user';

  render(_: MyContext, notice?: string): RenderResult {
    let text = `➕ *Добавление нового участника*\n\n` +
               `Отправьте *Telegram ID (UID)* и *Фамилию Имя* одним сообщением через пробел:\n` +
               `_(Например: \`123456789 Иванов Иван\`)_\n\n` +
               `_Билеты и предметы назначены не будут — пользователь просто появится в базе._`;

    if (notice) {
      text += `\n\n${notice}`;
    }

    return {
      displayType: 'main_menu',
      text,
      reply_markup: new InlineKeyboard().text('❌ Отмена', 'add_user:cancel'),
    };
  }

  async handle(ctx: MyContext): Promise<BaseScreen | null> {
    if (ctx.callbackQuery?.data === 'add_user:cancel') {
      await ctx.answerCallbackQuery();
      return new AdminTicketingScreen();
    }

    if (ctx.message?.text && ctx.from) {
      const raw = ctx.message.text.trim();
      const match = raw.match(/^(\d+)\s+(.+)$/);

      if (!match) {
        ctx.session.meta.notice = '⚠️ Неверный формат! Введите числовой UID и ФИ через пробел (например: `123456789 Иванов Иван`):';
        return this;
      }

      const targetUid = parseInt(match[1], 10);
      const fullName = match[2].replace(/\s+/g, ' ').trim();

      if (fullName.split(' ').length < 2) {
        ctx.session.meta.notice = '⚠️ Укажите и Фамилию, и Имя (через пробел после UID):';
        return this;
      }

      try {
        await chiefEditorService.addManualUser(ctx.from.id, targetUid, fullName);
        ctx.session.meta.notice = `✅ Участник *${escapeMarkdown(fullName)}* (\`${targetUid}\`) добавлен в базу!`;
        return new AdminTicketingScreen();
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка: ${e.message || e}`;
        return this;
      }
    }

    return null;
  }
}

