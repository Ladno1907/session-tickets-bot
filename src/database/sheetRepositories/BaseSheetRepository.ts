import { google, sheets_v4 } from 'googleapis';
import { config } from '../../config.js';

/**
 * Базовый класс для репозиториев, работающих с Google Sheets API через сервисный аккаунт.
 */
export class BaseSheetRepository {
  protected spreadsheetId: string;
  private keyFile: string;

  constructor() {
    this.spreadsheetId = config.googleSheets.spreadsheetId;
    this.keyFile = config.googleSheets.credentialsPath;
  }

  /**
   * Создаёт и возвращает авторизованный клиент Google Sheets API v4.
   */
  protected async getSheetsClient(): Promise<sheets_v4.Sheets> {
    const auth = new google.auth.GoogleAuth({
      keyFile: this.keyFile,
      scopes: ['https://googleapis.com'],
    });

    return google.sheets({ version: 'v4', auth });
  }
}

