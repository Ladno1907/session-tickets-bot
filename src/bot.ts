import { Bot, session } from 'grammy';
import { config } from './config.js';
import { MyContext, BotSessionData } from './types/context.js';
import { ProcessStage } from './types/entities.js';
import { migrate } from './database/migrate.js';
import { sqliteSessionAdapter } from './database/adapters/SQLiteSessionAdapter.js';
import { stageManager } from './managers/StageManager.js';
import { chiefEditorService } from './services/ChiefEditorService.js';

import { screenFactory } from './screens/screenFactory.js';
import { messageManager } from './managers/MessageManager.js';
import { studentService } from './services/StudentService.js';

export const bot = new Bot<MyContext>(config.botToken);

async function runBot() {
  try {
    await migrate();
    await chiefEditorService.syncChiefEditors(config.chiefEditorIds);

    bot.api.config.use((prev, method, payload, signal) => {
      if (method === 'sendMessage' || method === 'editMessageText') {
        if (payload && typeof payload === 'object' && !('parse_mode' in payload)) {
          (payload as any).parse_mode = 'Markdown';
        }
      }
      return prev(method, payload, signal);
    });

    bot.use(
      session({
        storage: sqliteSessionAdapter,
        getSessionKey: (ctx) => ctx.from?.id.toString(),
        initial: (): BotSessionData => ({ 
          currentScreenId: 'main_menu',
          meta: {} as Record<string, any>
        }),
      })
    );

    await stageManager.checkAndTransition(bot);
    stageManager.startPeriodicCheck(bot);

    // =========================================================================
    // КОМАНДА: /admin (Панель Администратора)
    // =========================================================================
    bot.command('admin', async (ctx) => {
      try {
        const isAdmin = config.chiefEditorIds.includes(ctx.from?.id || 0);
        if (!isAdmin) return;

        const currentStage = await stageManager.getCurrentStageFast();

        const stageToScreenMap: Record<ProcessStage, string> = {
          [ProcessStage.PREPARATION]: 'admin_preparation',
          [ProcessStage.REGISTRATION]: 'admin_registration',
          [ProcessStage.DISTRIBUTION]: 'admin_distribution',
          [ProcessStage.TICKETING]: 'admin_ticketing',
          [ProcessStage.FINISHED]: 'admin_finished',
        };

        const targetScreenId = stageToScreenMap[currentStage];

        if (!targetScreenId) {
          console.error(`Команда /admin: Не удалось определить экран для стадии ${currentStage}`);
          await ctx.reply('❌ Ошибка: Текущая стадия процесса не поддерживается админ-панелью.');
          return;
        }

        ctx.session.currentScreenId = targetScreenId;

        const adminScreen = screenFactory.create(targetScreenId);
        const renderResult = await adminScreen.render(ctx);

        await messageManager.manageMainMenu(
          ctx,
          renderResult.text,
          renderResult.reply_markup,
          true
        );
      } catch (error) {
        console.error('Ошибка при обработке команды /admin:', error);
        await ctx.reply('Произошла ошибка при загрузке меню. Пожалуйста, попробуйте позже.');
      }
    });

    // =========================================================================
    // КОМАНДА: /start и /user (Личный кабинет Студента)
    // =========================================================================
    bot.command(['start', 'user'], async (ctx) => {
      try {
        if (!ctx.from) return;
        const currentStage = await stageManager.getCurrentStageFast();

        if (currentStage === ProcessStage.PREPARATION) {
          return;
        }

        const user = await studentService.getUserById(ctx.from.id);
        let targetScreenId: string;

        switch (currentStage) {
          case ProcessStage.REGISTRATION:
            targetScreenId = user ? 'student_registration' : 'student_reg_fio_input';
            break;

          case ProcessStage.DISTRIBUTION:
            if (!user) {
              return;
            }
            targetScreenId = 'student_distribution';
            break;

          case ProcessStage.TICKETING:
          case ProcessStage.FINISHED:
            if (!user) {
              return;
            }
            targetScreenId = 'student_ticketing';
            break;

          default:
            console.error(`Команда пользователя: Неизвестная стадия процесса: ${currentStage}`);
            await ctx.reply('❌ Ошибка: Текущий этап проекта не поддерживается интерфейсом.');
            return;
        }

        ctx.session.currentScreenId = targetScreenId;

        const currentScreen = screenFactory.create(targetScreenId);
        const renderResult = await currentScreen.render(ctx);

        await messageManager.manageMainMenu(
          ctx,
          renderResult.text,
          renderResult.reply_markup,
          true
        );
      } catch (error) {
        console.error('Ошибка при обработке команды /user:', error);
        await ctx.reply('Произошла ошибка при загрузке меню. Пожалуйста, попробуйте позже.');
      }
    });

    // =========================================================================
    // КОМАНДА: /editor (Панель Проверки Редактора)
    // =========================================================================
    bot.command('editor', async (ctx) => {
      try {
        if (!ctx.from) return;
        const currentStage = await stageManager.getCurrentStageFast();

        if (currentStage === ProcessStage.PREPARATION || currentStage === ProcessStage.REGISTRATION) {
          return;
        }

        const user = await studentService.getUserById(ctx.from.id);
        
        if (!user || user.editor !== 1) {
          return;
        }

        let targetScreenId: string;

        switch (currentStage) {
          case ProcessStage.DISTRIBUTION:
            targetScreenId = 'editor_distribution';
            break;

          case ProcessStage.TICKETING:
          case ProcessStage.FINISHED:
            targetScreenId = 'editor_ticketing';
            break;

          default:
            console.error(`Команда /editor: Неизвестная стадия процесса: ${currentStage}`);
            await ctx.reply('❌ Ошибка: Текущий этап проекта не поддерживается интерфейсом.');
            return;
        }

        ctx.session.currentScreenId = targetScreenId;

        const currentScreen = screenFactory.create(targetScreenId);
        const renderResult = await currentScreen.render(ctx);

        await messageManager.manageMainMenu(
          ctx,
          renderResult.text,
          renderResult.reply_markup,
          true
        );
      } catch (error) {
        console.error('Ошибка при обработке команды /editor:', error);
        await ctx.reply('Произошла ошибка при загрузке панели редактора. Пожалуйста, попробуйте позже.');
      }
    });

    bot.on(['message', 'callback_query:data'], async (ctx) => {
      try {
        const currentScreenId = ctx.session.currentScreenId;
        const currentScreen = screenFactory.create(currentScreenId);

        const userMessageId = ctx.message?.message_id;

        const nextScreen = await currentScreen.handle(ctx);

        if (nextScreen) {
          ctx.session.currentScreenId = nextScreen.id;
          let notice = ctx.session.meta?.notice;
          if (notice) {
            notice = notice.replace(/_/g, '\\_');
          }
          if (ctx.session.meta?.notice) {
            delete ctx.session.meta.notice;
          }
          const renderResult = await nextScreen.render(ctx, notice);

          if (userMessageId && !renderResult.keepUserMessage) {
            try {
              await ctx.api.deleteMessage(ctx.chat!.id, userMessageId);
            } catch (deleteError) {}
          }

          if (renderResult.displayType === 'main_menu') {
            const isForceNew = !ctx.callbackQuery || renderResult.forceNew;

            await messageManager.manageMainMenu(
              ctx,
              renderResult.text,
              renderResult.reply_markup,
              isForceNew,
              renderResult.documentPath
            );
          } else { // При необходимости добавить метод для управления билетами
            await ctx.reply(renderResult.text, {
              reply_markup: renderResult.reply_markup,
              parse_mode: 'Markdown'
            });
          }
        }
      } catch (error) {
        console.error('Ошибка обработки экрана:', error);
        await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
      }
    });

    console.log('Starting bot...');
    bot.start();
  } catch (error) {
    console.error('Critical error during bot startup:', error);
    process.exit(1);
  }
}

runBot();
