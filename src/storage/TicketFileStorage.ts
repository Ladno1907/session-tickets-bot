import { Api } from 'grammy';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { config } from '../config.js';

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
    api: Api,
    fileId: string,
    ticketId: number,
    version: number
  ): Promise<{ filePath: string; extension: string }> {
    await mkdir(this.baseDir, { recursive: true });

    const file = await api.getFile(fileId);
    if (!file.file_path) {
      throw new Error(`Не удалось получить путь к файлу ${fileId}`);
    }

    const extension = extname(file.file_path) || '.bin';
    const filePath = this.getFilePath(ticketId, version, extension);

    const token = config.botToken.trim();
    const url = `https://telegram.org{token}/${file.file_path}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Ошибка скачивания файла: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(filePath, buffer);

    return { filePath, extension };
  }

  // =========================================================================
  // ПОЛУЧЕНИЕ ПУТЕЙ К ФАЙЛАМ
  // =========================================================================

  /**
   * Возвращает абсолютный путь к сохранённому файлу решения по ID билета, версии и расширению.
   */
  public getFilePath(ticketId: number, version: number, extension: string): string {
    return join(this.baseDir, `ticket_${ticketId}_v${version}${extension}`);
  }
}

export const ticketFileStorage = new TicketFileStorage();

