import { mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface FeedbackEntry {
  telegramId: number;
  userName: string;
  roleLabel: string;
  stage: string;
  text: string;
}

/**
 * Хранилище пользовательских обращений, жалоб и баг-репортов в Markdown-файле (`./data/feedback.md`).
 */
export class FeedbackStorage {
  private readonly filePath = join(process.cwd(), 'data', 'feedback.md');

  public async appendFeedback(entry: FeedbackEntry): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    if (!existsSync(this.filePath)) {
      await appendFile(
        this.filePath,
        `# 💬 Журнал обратной связи и баг-репортов\n\n---\n\n`,
        'utf-8'
      );
    }

    const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const block =
      `### 📩 Обращение от ${now} (МСК)\n` +
      `- **Отправитель:** ${entry.userName} (\`ID: ${entry.telegramId}\`)\n` +
      `- **Меню / Роль:** ${entry.roleLabel}\n` +
      `- **Этап сессии:** \`${entry.stage}\`\n\n` +
      `> ${entry.text.replace(/\n/g, '\n> ')}\n\n` +
      `---\n\n`;

    await appendFile(this.filePath, block, 'utf-8');
  }

  /**
   * Возвращает абсолютный путь к файлу журнала обратной связи (`./data/feedback.md`).
   */
  public getFilePath(): string {
    return this.filePath;
  }
}

export const feedbackStorage = new FeedbackStorage();

