/**
 * Строка ведомости предмета, распарсенная из диапазона `A8:D` листа Google Sheets.
 */
export interface ParsedSubjectRow {
  ticketNumber: number;
  question: string;
  studentFio: string | null;
  editorFio: string | null;
}

