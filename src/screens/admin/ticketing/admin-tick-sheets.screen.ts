import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { escapeMarkdown } from '../../../utils/format.js';
import { AdminTicketingScreen } from './admin-ticketing.screen.js';

/**
 * Экран синхронизации и перераспределения ведомостей с Google Sheets на этапе `TICKETING` / `FINISHED`.
 */
export class AdminTickSheetsScreen implements BaseScreen {
  readonly id = 'admin_tick_sheets';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) throw new Error('Пользователь не найден.');

    const subjects = await chiefEditorService.getAllSubjects(ctx.from.id);
    const targetSubjectId = ctx.session.meta?.targetSubjectId;
    const currentSub = subjects.find((s) => s.subjectId === targetSubjectId);

    let text = `📝 *Синхронизация ведомостей с Google Sheets*\n\n`;

    if (currentSub) {
      text += `🎯 *Выбран предмет:* _${escapeMarkdown(currentSub.subjectName)}_\n\n` +
              `Выберите операцию синхронизации:`;
    } else {
      text += `ℹ️ *Выберите предмет из списка на клавиатуре*, чтобы открыть инструменты импорта/экспорта:`;
    }

    if (notice) {
      text += `\n\n${notice}`;
    }

    const keyboard = new InlineKeyboard();

    if (subjects.length > 0) {
      for (let i = 0; i < subjects.length; i += 2) {
        const chunk = subjects.slice(i, i + 2);
        chunk.forEach((sub) => {
          const isTarget = sub.subjectId === targetSubjectId;
          keyboard.text(`${isTarget ? '🎯 ' : '📘 '}${sub.subjectName}`, `t_sub_focus:${sub.subjectId}`);
        });
        keyboard.row();
      }
    }

    if (currentSub) {
      keyboard.text('📤 Выгрузить локальную БД в таблицу (Сброс)', 't_sheet:export_local').row()
              .text('📥 Загрузить «Как есть» (Без пересчета)', 't_sheet:import_as_is').row()
              .text('🔄 Загрузить вопросы + Пересчитать Студентов', 't_sheet:shake_students').row()
              .text('👑 Загрузить вопросы + Пересчитать Редакторов', 't_sheet:shake_editors').row()
              .text('⚡ Загрузить вопросы + Пересчитать ВСЕХ', 't_sheet:shake_all').row();
    }

    keyboard.text('⬅️ Назад в панель', 't_sheet:back');

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

    if (data === 't_sheet:back') {
      delete ctx.session.meta.targetSubjectId;
      return new AdminTicketingScreen();
    }

    if (data.startsWith('t_sub_focus:')) {
      ctx.session.meta.targetSubjectId = parseInt(data.split(':')[1], 10);
      return this;
    }

    const targetSubjectId = ctx.session.meta?.targetSubjectId;
    if (!targetSubjectId) return this;

    const actionsMap: Record<string, { fn: () => Promise<void>; okMsg: string; errPrefix: string }> = {
      't_sheet:export_local': {
        fn: () => chiefEditorService.exportLocalDataToSheet(ctx.from!.id, targetSubjectId),
        okMsg: '✅ Локальные данные SQLite успешно выгружены в лист Google Таблицы!',
        errPrefix: '❌ Ошибка экспорта',
      },
      't_sheet:import_as_is': {
        fn: () => chiefEditorService.importDataAsIsFromSheet(ctx.from!.id, targetSubjectId),
        okMsg: '✅ Таблица успешно импортирована в базу один в один!',
        errPrefix: '❌ Ошибка импорта',
      },
      't_sheet:shake_students': {
        fn: () => chiefEditorService.importWithStudentRedistribution(ctx.from!.id, targetSubjectId),
        okMsg: '✅ Вопросы обновлены, студенты перераспределены и выгружены в таблицу!',
        errPrefix: '❌ Ошибка перерасчета',
      },
      't_sheet:shake_editors': {
        fn: () => chiefEditorService.importWithEditorRedistribution(ctx.from!.id, targetSubjectId),
        okMsg: '✅ Вопросы обновлены, редакторы перераспределены и выгружены в таблицу!',
        errPrefix: '❌ Ошибка перерасчета',
      },
      't_sheet:shake_all': {
        fn: () => chiefEditorService.importWithFullRedistribution(ctx.from!.id, targetSubjectId),
        okMsg: '✅ Вопросы обновлены, студенты и редакторы перераспределены и выгружены!',
        errPrefix: '❌ Ошибка полного перерасчета',
      },
    };

    const selectedAction = actionsMap[data];
    if (selectedAction) {
      try {
        await selectedAction.fn();
        ctx.session.meta.notice = selectedAction.okMsg;
      } catch (e: any) {
        ctx.session.meta.notice = `${selectedAction.errPrefix}: ${e.message || e}`;
      }
      return this;
    }

    return null;
  }
}

