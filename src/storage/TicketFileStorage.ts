import { Api } from 'grammy';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { config } from '../config.js';

export class TicketFileStorage {
  private readonly baseDir = join(process.cwd(), 'data', 'tickets');

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
    const fileName = `ticket_${ticketId}_v${version}${extension}`;
    const filePath = join(this.baseDir, fileName);

    const token = config.botToken.trim();
    
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Ошибка скачивания файла: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(filePath, buffer);

    return { filePath, extension };
  }

  public getFilePath(ticketId: number, version: number, extension: string): string {
    return join(this.baseDir, `ticket_${ticketId}_v${version}${extension}`);
  }
}

export const ticketFileStorage = new TicketFileStorage();

