import { google, sheets_v4 } from "googleapis";
import { config } from "../../config.js";

export class BaseSheetRepository {
  protected spreadsheetId: string;
  private keyFile: string;

  constructor() {
    this.spreadsheetId = config.googleSheets.spreadsheetId; 
    this.keyFile = config.googleSheets.credentialsPath;
  }

  protected async getSheetsClient(): Promise<sheets_v4.Sheets> {
    const auth = new google.auth.GoogleAuth({
      keyFile: this.keyFile,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"], 
    });

    return google.sheets({ version: "v4", auth });
  }
}
