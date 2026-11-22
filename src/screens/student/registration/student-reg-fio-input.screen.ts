import { BaseScreen, RenderResult } from '../../base.screen.js';
import { MyContext } from '../../../types/context.js';
import { studentService } from '../../../services/StudentService.js';
import { StudentRegistrationScreen } from './student-registration.screen.js';

export class StudentRegFioInputScreen implements BaseScreen {
  readonly id = 'student_reg_fio_input';

  render(_: MyContext, notice?: string): RenderResult {
    let text = `📝 *Регистрация участника*\n\nПожалуйста, введите ваши **Фамилию и Имя** одним текстовым сообщением:\n_(Например: Иванов Иван)_`;

    if (notice) {
      text += `\n\n${notice}`;
    }

    return {
      displayType: 'main_menu',
      text,
    };
  }

  async handle(ctx: MyContext): Promise<BaseScreen | null> {
    if (ctx.message?.text) {
      const fio = ctx.message.text.trim();

      if (fio.split(/\s+/).length < 2) {
        ctx.session.meta.notice = '⚠️ Пожалуйста, введите и Фамилию, и Имя для корректного отображения в ведомостях!';
        return this;
      }

      try {
        await studentService.registerUser(ctx.from!.id, fio);
        return new StudentRegistrationScreen();
      } catch (error: any) {
        ctx.session.meta.notice = `❌ Ошибка регистрации: ${error.message || error}`;
        return this;
      }
    }

    return null;
  }
}

