import { BaseSheetRepository } from "./BaseSheetRepository.js";
import { ParsedSubjectRow } from "../../types/sheets.js";

export class TicketSheetRepository extends BaseSheetRepository {
  async getSubjectData(sheetName: string): Promise<ParsedSubjectRow[]> {
    const sheets = await this.getSheetsClient();
    const range = `'${sheetName.trim()}'!A8:D`;

    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });

      const rows = response.data.values || [];
      const parsedRows: ParsedSubjectRow[] = [];

      let currentEditorFio: string | null = null;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        const rawNumber = row[0]?.toString().trim();
        const rawQuestion = row[1]?.toString().trim();

        if (!rawNumber || !rawQuestion) continue;
        
        const ticketNumber = parseInt(rawNumber, 10);
        const question = rawQuestion.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
        const studentFio = row[2]?.toString().trim() || null;

        const cellEditorFio = row[3]?.toString().trim();
        
        if (cellEditorFio) {
          currentEditorFio = cellEditorFio;
        }

        parsedRows.push({
          ticketNumber,
          question,
          studentFio,
          editorFio: currentEditorFio
        });
      }

      return parsedRows;

    } catch (error: any) {
      if (error.code === 400) {
        throw new Error(`SHEET_NOT_FOUND`);
      }
      throw error;
    }
  }

  async saveAssignedStudents(sheetName: string, assignments: { ticketNumber: number; studentFio: string }[]): Promise<void> {
    if (assignments.length === 0) return;

    const sheets = await this.getSheetsClient();
    const maxNumber = Math.max(...assignments.map(a => a.ticketNumber));
    const flatRows: string[][] = new Array(maxNumber).fill(null).map(() => [""]);

    for (const assignment of assignments) {
      flatRows[assignment.ticketNumber - 1] = [assignment.studentFio];
    }

    const range = `'${sheetName.trim()}'!C8:C${7 + flatRows.length}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: flatRows },
    });
  }

  async saveAssignedEditors(sheetName: string, assignments: { ticketNumber: number; editorFio: string }[]): Promise<void> {
    if (assignments.length === 0) return;

    const sheets = await this.getSheetsClient();

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const targetSheet = spreadsheet.data.sheets?.find(s => s.properties?.title === sheetName.trim());
    if (!targetSheet?.properties?.sheetId) {
      throw new Error(`Лист "${sheetName}" не найден в Google Таблице.`);
    }
    const sheetId = targetSheet.properties.sheetId;

    const sortedAssignments = [...assignments].sort((a, b) => a.ticketNumber - b.ticketNumber);
    const maxNumber = sortedAssignments[sortedAssignments.length - 1].ticketNumber;

    const editorNamesArray: string[] = new Array(maxNumber).fill("");
    for (const asm of sortedAssignments) {
      editorNamesArray[asm.ticketNumber - 1] = asm.editorFio;
    }

    const mergeRequests: any[] = [];
    const flatRowsToWrite: string[][] = [];

    let i = 0;
    while (i < editorNamesArray.length) {
      const currentFio = editorNamesArray[i];

      if (currentFio === "") {
        flatRowsToWrite.push([""]);
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
              sheetId: sheetId,
              startRowIndex: 7 + i,
              endRowIndex: 7 + j,
              startColumnIndex: 3,
              endColumnIndex: 4,
            },
            mergeType: "MERGE_ALL",
          },
        });
      }

      flatRowsToWrite.push([currentFio]);
      
      for (let k = 1; k < (j - i); k++) {
        flatRowsToWrite.push([""]);
      }

      i = j;
    }

    try {
      const sheetWithMerges = await sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        ranges: [sheetName.trim()],
        fields: "sheets(merges)",
      });

      const currentMerges = sheetWithMerges.data.sheets?.[0]?.merges || [];
      const unmergeRequests: any[] = [];

      for (const merge of currentMerges) {
        if (merge.startColumnIndex === 3 && merge.endColumnIndex === 4 && (merge.startRowIndex ?? 0) >= 7) {
          unmergeRequests.push({
            unmergeCells: {
              range: {
                sheetId: sheetId,
                startRowIndex: merge.startRowIndex,
                endRowIndex: merge.endRowIndex,
                startColumnIndex: merge.startColumnIndex,
                endColumnIndex: merge.endColumnIndex,
              }
            }
          });
        }
      }

      if (unmergeRequests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: { requests: unmergeRequests },
        });
      }
    } catch (unmergeError) {
      console.warn(`TicketSheetRepository: Не удалось сбросить старые merge-диапазоны для листа ${sheetName}. Продолжаем.`);
    }

    const updateRange = `'${sheetName.trim()}'!D8:D${7 + flatRowsToWrite.length}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: updateRange,
      valueInputOption: "RAW",
      requestBody: { values: flatRowsToWrite },
    });

    if (mergeRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests: mergeRequests },
      });
    }
  }

  async updateTicketCellColor(
    sheetName: string,
    ticketNumber: number,
    status: 'in_progress' | 'on_check' | 'approved' | 'on_rework'
  ): Promise<void> {
    const sheets = await this.getSheetsClient();
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const targetSheet = spreadsheet.data.sheets?.find(s => s.properties?.title === sheetName.trim());
    if (!targetSheet?.properties?.sheetId) return;

    const sheetId = targetSheet.properties.sheetId;
    const rowIndex = 7 + (ticketNumber - 1);

    const colorMap = {
      approved: { red: 0.486, green: 0.651, blue: 0.055 },  // Зелёный
      on_rework: { red: 0.984, green: 0.733, blue: 0.016 }, // Жёлтый
      on_check: { red: 0.718, green: 0.718, blue: 0.718 },  // Серый
      in_progress: { red: 1.0, green: 1.0, blue: 1.0 },     // Белый
    };

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [{
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
        }],
      },
    });
  }
}

export const ticketSheetRepository = new TicketSheetRepository();

