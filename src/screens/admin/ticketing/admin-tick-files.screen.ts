import { InlineKeyboard } from 'grammy';
import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { bot } from '../../../bot.js';
import { unlink } from 'node:fs/promises';
import { ticketFileStorage } from '../../../storage/TicketFileStorage.js';
import { messageManager } from '../../../managers/MessageManager.js';
import { chiefEditorService } from '../../../services/ChiefEditorService.js';
import { escapeMarkdown } from '../../../utils/format.js';
import { AdminTicketingScreen } from './admin-ticketing.screen.js';

/**
 * Экран выгрузки готовых файлов решений выбранного предмета в чат администратора.
 */
export class AdminTickFilesScreen implements BaseScreen {
  readonly id = 'admin_tick_files';

  async render(ctx: MyContext, notice?: string): Promise<RenderResult> {
    if (!ctx.from) throw new Error('Пользователь не найден.');

    const subjects = await chiefEditorService.getAllSubjects(ctx.from.id);
    const targetSubjectId = ctx.session.meta?.filesSubjectId;
    const currentSub = subjects.find((s) => s.subjectId === targetSubjectId);

    let text = `📥 *Выгрузка файлов билетов*\n\n`;

    if (currentSub) {
      text += `🎯 *Выбран предмет:* _${escapeMarkdown(currentSub.subjectName)}_\n\n` +
              `Выберите, какие файлы отправить вам в этот чат (альбомами по 10 документов):`;
    } else {
      text += `Выберите предмет из списка ниже для выгрузки файлов:`;
    }

    if (notice) {
      text += `\n\n${notice}`;
    }

    const keyboard = new InlineKeyboard();

    for (let i = 0; i < subjects.length; i += 2) {
      const chunk = subjects.slice(i, i + 2);
      chunk.forEach((sub) => {
        const isTarget = sub.subjectId === targetSubjectId;
        keyboard.text(`${isTarget ? '🎯 ' : '📘 '}${sub.subjectName}`, `files_sub:${sub.subjectId}`);
      });
      keyboard.row();
    }

    if (currentSub) {
      keyboard.text('🟢 Скачать только ПРИНЯТЫЕ (альбомом)', 'files_dl:approved').row()
              .text('📦 Скачать ВСЕ загруженные (альбомом)', 'files_dl:all').row()
              .text('🗜 Скачать ПРИНЯТЫЕ единым ZIP-архивом', 'files_dl:zip_approved').row();
    }

    keyboard.text('⬅️ Назад в панель', 'files_dl:back');

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

    if (data === 'files_dl:back') {
      delete ctx.session.meta.filesSubjectId;
      return new AdminTicketingScreen();
    }

    if (data.startsWith('files_sub:')) {
      ctx.session.meta.filesSubjectId = parseInt(data.split(':')[1], 10);
      return this;
    }

    if (data === 'files_dl:approved' || data === 'files_dl:all') {
      const subjectId = ctx.session.meta?.filesSubjectId;
      if (!subjectId || !ctx.from) return this;

      const onlyApproved = data === 'files_dl:approved';

      try {
        const { subjectName, files } = await chiefEditorService.getTicketFilesForSubject(
          ctx.from.id,
          subjectId,
          onlyApproved
        );

        if (files.length === 0) {
          ctx.session.meta.notice = `⚠️ По предмету «${escapeMarkdown(subjectName)}» подходящих файлов на диске не найдено.`;
          return this;
        }

        const paths = files.map((f) => f.filePath);
        await messageManager.sendMediaToOne(bot, ctx.from.id, paths);

        ctx.session.meta.notice = `✅ Выгружено файлов по предмету «${escapeMarkdown(subjectName)}»: *${files.length}* шт.`;
        return this;
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка выгрузки: ${e.message || e}`;
        return this;
      }
    }

     if (data === 'files_dl:zip_approved') {
      const subjectId = ctx.session.meta?.filesSubjectId;
      if (!subjectId || !ctx.from) return this;

      try {
        const { subjectName, files } = await chiefEditorService.getTicketFilesForSubject(
          ctx.from.id,
          subjectId,
          true
        );

        if (files.length === 0) {
          ctx.session.meta.notice = `⚠️ По предмету «${escapeMarkdown(subjectName)}» принятых файлов на диске не найдено.`;
          return this;
        }

        const zipPath = await ticketFileStorage.createSubjectZipArchive(subjectName, files, 'Принятые');
        await messageManager.sendMediaToOne(bot, ctx.from.id, zipPath);
        await unlink(zipPath).catch(() => {});

        ctx.session.meta.notice = `✅ Единый ZIP-архив по предмету «${escapeMarkdown(subjectName)}» отправлен (внутри *${files.length}* билетов)!`;
        return this;
      } catch (e: any) {
        ctx.session.meta.notice = `❌ Ошибка создания архива: ${e.message || e}`;
        return this;
      }
    }

    return null;
  }
}

