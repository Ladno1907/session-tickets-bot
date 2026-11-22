import { mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { MyApi } from '../types/context.js';

/**
 * Локальное файловое хранилище решений билетов (`./data/tickets/`).
 * Отвечает за скачивание документов с серверов Telegram Bot API с версионированием
 * (`ticket_{ticketId}_v{version}{ext}`) и формирование путей к файлам на диске.
 */
export class TicketFileStorage {
  private readonly baseDir = join(process.cwd(), 'data', 'tickets');

  // =========================================================================
  // СКАЧИВАНИЕ И СОХРАНЕНИЕ ДОКУМЕНТОВ
  // =========================================================================

  /**
   * Скачивает документ из Telegram по `fileId` и сохраняет его на диск с указанным номером версии.
   */
  public async saveTelegramDocument(
    api: MyApi,
    fileId: string,
    subjectName: string,
    ticketNumber: number,
    version: number
  ): Promise<{ filePath: string; extension: string }> {
    await mkdir(this.baseDir, { recursive: true });

    const file = await api.getFile(fileId);
    if (!file.file_path) {
      throw new Error(`Не удалось получить путь к файлу ${fileId}`);
    }

    const extension = extname(file.file_path) || '.bin';
    const filePath = this.getFilePath(subjectName, ticketNumber, version, extension);

    await file.download(filePath);

    return { filePath, extension };
  }

  // =========================================================================
  // ПОЛУЧЕНИЕ ПУТЕЙ К ФАЙЛАМ
  // =========================================================================

  /**
   * Возвращает абсолютный путь к сохранённому файлу решения по ID билета, версии и расширению.
   */
  public getFilePath(
    subjectName: string,
    ticketNumber: number,
    version: number,
    extension: string
  ): string {
    const safeSubject = subjectName
      .trim()
      .replace(/[\/\\:*?"<>|]/g, '_')
      .replace(/\s+/g, '_');

    return join(this.baseDir, `${safeSubject}_Билет_${ticketNumber}_v${version}${extension}`);
  } 
}

export const ticketFileStorage = new TicketFileStorage();
