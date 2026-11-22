import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { AdminRegSelectSubjectScreen } from './admin-reg-select-subject.screen.js';
import { AdminRegEditorFioInputScreen } from './admin-reg-editor-fio-input.screen.js';
import { escapeMarkdown } from '../../../utils/format.js';

/**
 * Экран просмотра текущих редакторов и заявок по конкретному предмету
 * с переходом к назначению или отстранению редакторов.
 */
export class AdminRegSubjectEditorsScreen implements BaseScreen {
  readonly id = 'admin_reg_subject_editors';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) {
      throw new Error('Критическая ошибка: не удалось определить пользователя в контексте grammY.');
    }

    const subjectId = ctx.session.meta?.targetSubjectId;
    const subjects = await chiefEditorService.getAllSubjects(ctx.from.id);
    const currentSub = subjects.find((s) => s.subjectId === subjectId);

    if (!currentSub) {
      return {
        displayType: 'main_menu',
        text: '❌ Ошибка: Предмет потерян.',
        reply_markup: new InlineKeyboard().text('⬅️ Назад', 'back_to_subs_list'),
      };
    }

    const editors = await chiefEditorService.getEditorsForSubject(ctx.from.id, subjectId);
    const requests = await chiefEditorService.getEditorRequestsForSubject(ctx.from.id, subjectId);

    let text = `👑 *Редакторы предмета: ${escapeMarkdown(currentSub.subjectName)}*\n\n`;

    text += `*Текущие редакторы*:\n`;
    if (editors.length === 0) {
      text += `  ❌ Нет назначенных редакторов\n`;
    } else {
      editors.forEach((e, i) => {
        text += `  ${i + 1}. ${escapeMarkdown(e.name)} (\`ID: ${e.telegramId}\`)\n`;
      });
    }

    text += `\n*Подали заявку через бота (Желающие)*:\n`;
    if (requests.length === 0) {
      text += `  ❌ Нет активных заявок\n`;
    } else {
      requests.forEach((r) => {
        text += `  • ${escapeMarkdown(r.name)} (\`ID: ${r.telegramId}\`)\n`;
      });
    }

    if (notice) {
      text += `\n\n${notice}`;
    }

    const keyboard = new InlineKeyboard()
      .text('➕ Назначить редактора', 'editor_action:assign').row()
      .text('➖ Отстранить редактора', 'editor_action:unassign').row()
      .text('⬅️ Назад к предметам', 'back_to_subs_list');

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

    if (data === 'back_to_subs_list') {
      delete ctx.session.meta.targetSubjectId;
      ctx.session.meta.subjectAction = 'manage_editors';
      return new AdminRegSelectSubjectScreen();
    }

    if (data.startsWith('editor_action:')) {
      ctx.session.meta.editorInputType = data.split(':');
      return new AdminRegEditorFioInputScreen();
    }

    return null;
  }
}

