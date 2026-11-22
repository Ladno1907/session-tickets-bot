import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { AdminDistributionScreen } from './admin-distribution.screen.js';

export class AdminDistSubjectsScreen implements BaseScreen {
  readonly id = 'admin_dist_subjects';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) throw new Error("Пользователь не найден.");

    const subjects = await chiefEditorService.getAllSubjects(ctx.from.id);
    const targetSubjectId = ctx.session.meta?.targetSubjectId;
    const currentSub = subjects.find(s => s.subjectId === targetSubjectId);

    let text = `📝 *Синхронизация ведомостей с Google Sheets*\n\n`;

    if (currentSub) {
      text += `🎯 *Выбран предмет для работы:* _${currentSub.subjectName}_\n\n` +
              `Выберите тип операции синхронизации для этого листа ниже. Все изменения зафиксируются в SQLite.`;
    } else {
      text += `ℹ️ *Пожалуйста, выберите предмет из списка на клавиатуре*, чтобы открыть инструменты импорта/экспорта.`;
    }

    if (notice) {
      text += `\n\n${notice}`;
    }

    const keyboard = new InlineKeyboard();

    if (subjects.length > 0) {
      for (let i = 0; i < subjects.length; i += 2) {
        const chunk = subjects.slice(i, i + 2);
        chunk.forEach(sub => {
          const isTarget = sub.subjectId === targetSubjectId;
          keyboard.text(`${isTarget ? '🎯 ' : '📘 '}${sub.subjectName}`, `sub_focus:${sub.subjectId}`);
        });
        keyboard.row();
      }
    }

    if (currentSub) {
      keyboard.text('📤 Выгрузить локальную БД в таблицу (Сброс)', 'sheet_sync:export_local').row()
              .text('📥 Загрузить «Как есть» (Без пересчета)', 'sheet_sync:import_as_is').row()
              .text('🔄 Загрузить + Пересчитать Студентов змейкой', 'sheet_sync:shake_students').row()
              .text('👑 Загрузить + Пересчитать Редакторов', 'sheet_sync:shake_editors').row();
    }

    keyboard.text('⬅️ Назад в меню', 'sheet_sync:back');

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

    if (data === 'sheet_sync:back') {
      delete ctx.session.meta.targetSubjectId;
      return new AdminDistributionScreen();
    }

    if (data.startsWith('sub_focus:')) {
      const subjectId = parseInt(data.split(':')[1], 10);
      ctx.session.meta.targetSubjectId = subjectId;
      return this;
    }

    const targetSubjectId = ctx.session.meta?.targetSubjectId;
    if (!targetSubjectId) return this;

    if (data === 'sheet_sync:export_local') {
      try {
        await chiefEditorService.exportLocalDataToSheet(ctx.from!.id, targetSubjectId);
        ctx.session.meta.notice = '✅ Локальные данные SQLite успешно перезаписали лист Google Таблицы!';
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка экспорта: ${e.message || e}`;
      }
      return this;
    }

    if (data === 'sheet_sync:import_as_is') {
      try {
        await chiefEditorService.importDataAsIsFromSheet(ctx.from!.id, targetSubjectId);
        ctx.session.meta.notice = '✅ Таблица успешно импортирована в базу один в один!';
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка импорта: ${e.message || e}`;
      }
      return this;
    }

    if (data === 'sheet_sync:shake_students') {
      try {
        await chiefEditorService.importWithStudentRedistribution(ctx.from!.id, targetSubjectId);
        ctx.session.meta.notice = '✅ Состав обновлен. Студенты заново перераспределены змейкой и запушены в таблицу!';
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка перерасчета: ${e.message || e}`;
      }
      return this;
    }

    if (data === 'sheet_sync:shake_editors') {
      try {
        await chiefEditorService.importWithEditorRedistribution(ctx.from!.id, targetSubjectId);
        ctx.session.meta.notice = '✅ Состав обновлен. Редакторы заново пропорционально распределены по билетам!';
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка перерасчета: ${e.message || e}`;
      }
      return this;
    }

    return null;
  }
}

