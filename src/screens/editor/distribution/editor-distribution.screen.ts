import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';

export class EditorDistributionScreen implements BaseScreen {
  readonly id = 'editor_distribution';

  render(_: MyContext, notice?: string): RenderResult {
    let text = `👑 *Панель Редактора: Распределение ведомостей*\n\n` +
               `Сейчас система находится на этапе перепроверки распределения билетов.\n` +
               `_Пожалуйста, дождитесь официального запуска этапа сдачи, после чего вам откроется доступ к очередям проверки._`;

    if (notice) {
      text += `\n\n${notice}`;
    }

    return {
      displayType: 'main_menu',
      text,
    };
  }

  async handle(_: MyContext): Promise<BaseScreen | null> {
    return null;
  }
}

