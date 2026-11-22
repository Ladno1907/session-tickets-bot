import { sheets_v4 } from 'googleapis';
import { BaseSheetRepository } from './BaseSheetRepository.js';
import { ParsedSubjectRow } from '../../types/sheets.js';
import { TicketStatus } from '../../types/entities.js';

/**
 * Репозиторий для синхронизации ведомостей билетов с Google Sheets.
 * Структура листа: A — номер билета, B — вопрос, C — студент, D — редактор (начиная с 8-й строки).
 */
export class TicketSheetRepository extends BaseSheetRepository {
  private readonly startRow = 8; // Строка начала таблицы в листе (1-based)
  private readonly startRowIndex = 7; // Индекс начала таблицы в API Google Sheets (0-based)

  // =========================================================================
  // ИМПОРТ ДАННЫХ (ЧТЕНИЕ ЛИСТА)
  // =========================================================================

  /**
   * Скачивает ведомость предмета (`A8:D`) из Google Sheets.
   * Корректно разворачивает объединённые ячейки редакторов в колонке D.
   */
  async getSubjectData(sheetName: string): Promise<ParsedSubjectRow[]> {
    const sheets = await this.getSheetsClient();
    const range = `'${sheetName.trim()}'!A${this.startRow}:D`;

    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });

      const rows = response.data.values || [];
      const parsedRows: ParsedSubjectRow[] = [];
      let currentEditorFio: string | null = null;

      for (const row of rows) {
        const rawNumber = row[0]?.toString().trim();
        const rawQuestion = row[1]?.toString().trim();

        if (!rawNumber || !rawQuestion) continue;

        const ticketNumber = parseInt(rawNumber, 10);
        const question = rawQuestion.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        const studentFio = row[2]?.toString().trim() || null;

        const cellEditorFio = row[3]?.toString().trim();
        if (cellEditorFio) {
          currentEditorFio = cellEditorFio;
        }

        parsedRows.push({
          ticketNumber,
          question,
          studentFio,
          editorFio: currentEditorFio,
        });
      }

      return parsedRows;
    } catch (error: any) {
      if (error.code === 400) {
        throw new Error('SHEET_NOT_FOUND');
      }
      throw error;
    }
  }

  // =========================================================================
  // ЭКСПОРТ ДАННЫХ (ЗАПИСЬ В ЛИСТ)
  // =========================================================================

  /**
   * Записывает распределённых студентов в колонку C (`C8:C...`).
   */
  async saveAssignedStudents(
    sheetName: string,
    assignments: { ticketNumber: number; studentFio: string }[]
  ): Promise<void> {
    if (assignments.length === 0) return;

    const sheets = await this.getSheetsClient();
    const maxNumber = Math.max(...assignments.map((a) => a.ticketNumber));
    const flatRows: string[][] = new Array(maxNumber).fill(null).map(() => ['']);

    for (const assignment of assignments) {
      flatRows[assignment.ticketNumber - 1] = [assignment.studentFio];
    }

    const endRow = this.startRowIndex + flatRows.length;
    const range = `'${sheetName.trim()}'!C${this.startRow}:C${endRow}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: flatRows },
    });
  }

  /**
   * Записывает распределённых редакторов в колонку D (`D8:D...`)
   * и объединяет смежные ячейки с одинаковым ФИО редактора (`mergeCells`).
   */
  async saveAssignedEditors(
    sheetName: string,
    assignments: { ticketNumber: number; editorFio: string }[]
  ): Promise<void> {
    if (assignments.length === 0) return;

    const sheets = await this.getSheetsClient();
    const sheetId = await this.getSheetIdByName(sheets, sheetName);
    if (sheetId === null) {
      throw new Error(`Лист "${sheetName}" не найден в Google Таблице.`);
    }

    const sortedAssignments = [...assignments].sort((a, b) => a.ticketNumber - b.ticketNumber);
    const maxNumber = sortedAssignments[sortedAssignments.length - 1].ticketNumber;

    const editorNamesArray: string[] = new Array(maxNumber).fill('');
    for (const asm of sortedAssignments) {
      editorNamesArray[asm.ticketNumber - 1] = asm.editorFio;
    }

    const mergeRequests: sheets_v4.Schema$Request[] = [];
    const flatRowsToWrite: string[][] = [];

    let i = 0;
    while (i < editorNamesArray.length) {
      const currentFio = editorNamesArray[i];

      if (currentFio === '') {
        flatRowsToWrite.push(['']);
        i++;
        continue;
      }

      let j = i + 1;
      while (j < editorNamesArray.length && editorNamesArray[j] === currentFio) {
        j++;
      }

      if (j - i > 1) {
        mergeRequests.push({
          mergeCells: {
            range: {
              sheetId,
              startRowIndex: this.startRowIndex + i,
              endRowIndex: this.startRowIndex + j,
              startColumnIndex: 3,
              endColumnIndex: 4,
            },
            mergeType: 'MERGE_ALL',
          },
        });
      }

      flatRowsToWrite.push([currentFio]);
      for (let k = 1; k < j - i; k++) {
        flatRowsToWrite.push(['']);
      }

      i = j;
    }

    await this.unmergeEditorColumn(sheets, sheetName, sheetId);

    const endRow = this.startRowIndex + flatRowsToWrite.length;
    const updateRange = `'${sheetName.trim()}'!D${this.startRow}:D${endRow}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: updateRange,
      valueInputOption: 'RAW',
      requestBody: { values: flatRowsToWrite },
    });

    if (mergeRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: mergeRequests },
      });
    }
  }

  // =========================================================================
  // ФОРМАТИРОВАНИЕ ЯЧЕЕК (ЦВЕТОВЫЕ СТАТУСЫ)
  // =========================================================================

  /**
   * Окрашивает ячейку студента (колонка C) в цвет текущего статуса билета.
   */
  async updateTicketCellColor(
    sheetName: string,
    ticketNumber: number,
    status: TicketStatus
  ): Promise<void> {
    const sheets = await this.getSheetsClient();
    const sheetId = await this.getSheetIdByName(sheets, sheetName);
    if (sheetId === null) return;

    const rowIndex = this.startRowIndex + (ticketNumber - 1);

    const colorMap: Record<TicketStatus, sheets_v4.Schema$Color> = {
      [TicketStatus.APPROVED]: { red: 0.486, green: 0.651, blue: 0.055 },    // Зелёный
      [TicketStatus.ON_REWORK]: { red: 0.984, green: 0.733, blue: 0.016 },   // Жёлтый
      [TicketStatus.ON_CHECK]: { red: 0.718, green: 0.718, blue: 0.718 },    // Серый
      [TicketStatus.IN_PROGRESS]: { red: 1.0, green: 1.0, blue: 1.0 },       // Белый
    };

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: rowIndex,
                endRowIndex: rowIndex + 1,
                startColumnIndex: 2,
                endColumnIndex: 3,
              },
              cell: {
                userEnteredFormat: { backgroundColor: colorMap[status] },
              },
              fields: 'userEnteredFormat.backgroundColor',
            },
          },
        ],
      },
    });
  }

  // =========================================================================
  // ВСПОМОГАТЕЛЬНЫЕ ПРИВАТНЫЕ МЕТОДЫ
  // =========================================================================

  /**
   * Возвращает внутренний числовой `sheetId` листа по его названию или `null`, если лист не найден.
   */
  private async getSheetIdByName(
    sheets: sheets_v4.Sheets,
    sheetName: string
  ): Promise<number | null> {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const targetSheet = spreadsheet.data.sheets?.find(
      (s) => s.properties?.title === sheetName.trim()
    );

    return targetSheet?.properties?.sheetId ?? null;
  }

  /**
   * Снимает существующие объединения ячеек в колонке D (начиная с 8-й строки).
   */
  private async unmergeEditorColumn(
    sheets: sheets_v4.Sheets,
    sheetName: string,
    sheetId: number
  ): Promise<void> {
    try {
      const sheetWithMerges = await sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        ranges: [sheetName.trim()],
        fields: 'sheets(merges)',
      });

      const currentMerges = sheetWithMerges.data.sheets?.[0]?.merges || [];
      const unmergeRequests: sheets_v4.Schema$Request[] = [];

      for (const merge of currentMerges) {
        if (
          merge.startColumnIndex === 3 &&
          merge.endColumnIndex === 4 &&
          (merge.startRowIndex ?? 0) >= this.startRowIndex
        ) {
          unmergeRequests.push({
            unmergeCells: {
              range: {
                sheetId,
                startRowIndex: merge.startRowIndex,
                endRowIndex: merge.endRowIndex,
                startColumnIndex: merge.startColumnIndex,
                endColumnIndex: merge.endColumnIndex,
              },
            },
          });
        }
      }

      if (unmergeRequests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: { requests: unmergeRequests },
        });
      }
    } catch {
      console.warn(
        `TicketSheetRepository: Не удалось сбросить старые merge-диапазоны для листа "${sheetName}". Продолжаем.`
      );
    }
  }
}

export const ticketSheetRepository = new TicketSheetRepository();

