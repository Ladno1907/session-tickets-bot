import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';

/**
 * Информационный экран Студента на этапе перепроверки распределения (`DISTRIBUTION`).
 */
export class StudentDistributionScreen implements BaseScreen {
  readonly id = 'student_distribution';

  render(_: MyContext, notice?: string): RenderResult {
    let text = `👤 *Панель Студента: Распределение ведомостей*\n\n` +
               `Сейчас система находится на этапе перепроверки распределения билетов.\n` +
               `_Пожалуйста, дождитесь официального запуска этапа сдачи, после чего здесь появится список ваших билетов._`;

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

