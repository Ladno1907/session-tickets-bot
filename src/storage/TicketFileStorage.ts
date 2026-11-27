import { mkdir } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { ZipArchive } from 'archiver';
import { config } from '../config.js';
import { MyApi } from '../types/context.js';

export class TicketFileStorage {
  private readonly baseDir = join(process.cwd(), 'data', 'tickets');
  private readonly archiveDir = join(process.cwd(), 'data', 'archives');

  // =========================================================================
  // ВАЛИДАЦИЯ ФОРМАТОВ ФАЙЛОВ (WHITELIST)
  // =========================================================================

  public validateFileExtension(fileName?: string): string {
    const ext = fileName ? extname(fileName).toLowerCase() : '';
    const allowed = config.allowedExtensions;

    if (!ext || !allowed.includes(ext)) {
      throw new Error(
        `Недопустимый формат файла (${ext || 'без расширения'}). Разрешены только: ${allowed.join(', ')}`
      );
    }

    return ext;
  }

  // =========================================================================
  // СКАЧИВАНИЕ И СОХРАНЕНИЕ ДОКУМЕНТОВ
  // =========================================================================

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

    const extension = extname(file.file_path).toLowerCase() || '.bin';
    const filePath = this.getFilePath(subjectName, ticketNumber, version, extension);

    await file.download(filePath);

    return { filePath, extension };
  }

  // =========================================================================
  // ПОЛУЧЕНИЕ ПУТЕЙ И СБОРКА ZIP-АРХИВА
  // =========================================================================

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

  /**
   * Собирает единый ZIP-архив по предмету из переданного списка файлов на диске.
   */
  public async createSubjectZipArchive(
    subjectName: string,
    files: { ticketNumber: number; filePath: string }[],
    suffix: string = 'Принятые'
  ): Promise<string> {
    await mkdir(this.archiveDir, { recursive: true });

    const safeSubject = subjectName
      .trim()
      .replace(/[\/\\:*?"<>|]/g, '_')
      .replace(/\s+/g, '_');

    const zipPath = join(this.archiveDir, `${safeSubject}_${suffix}_${Date.now()}.zip`);

    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = new ZipArchive({ zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err: Error) => reject(err));

      archive.pipe(output);

      for (const f of files) {
        archive.file(f.filePath, { name: basename(f.filePath) });
      }

      archive.finalize();
    });

    return zipPath;
  }

  /**
   * Собирает полный резервный ZIP-архив системы: файл базы данных SQLite
   * и всю директорию `data/` (кроме временной папки `data/archives`).
   */
  public async createFullBackupArchive(): Promise<string> {
    await mkdir(this.archiveDir, { recursive: true });

    const dataDir = join(process.cwd(), 'data');
    const zipPath = join(this.archiveDir, `backup_${new Date().toISOString().slice(0, 10)}_${Date.now()}.zip`);

    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = new ZipArchive({ zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err: Error) => reject(err));

      archive.pipe(output);

      if (existsSync(config.db.path)) {
        archive.file(config.db.path, { name: basename(config.db.path) });
      }

      if (existsSync(dataDir)) {
        archive.glob('**/*', {
          cwd: dataDir,
          ignore: ['archives/**'],
        }, { prefix: 'data' });
      }

      archive.finalize();
    });

    return zipPath;
  }
}

export const ticketFileStorage = new TicketFileStorage();

