import { stageManager } from '../managers/StageManager.js';
import { ProcessStage, TicketStatus } from '../types/entities.js';
import type { TicketWithSubjectView } from '../database/repositories/TicketViewRepo.js';

import { userRepository } from '../database/repositories/UserRepo.js';
import { editorRepository } from '../database/repositories/EditorRepo.js';
import { ticketRepository } from '../database/repositories/TicketRepo.js';
import { ticketViewRepository } from '../database/repositories/TicketViewRepo.js';
import { ticketSheetRepository } from '../database/sheetRepositories/TicketSheetRepository.js';

export class EditorService {
  constructor(
    private readonly userRepo = userRepository,
    private readonly editorRepo = editorRepository,
    private readonly ticketRepo = ticketRepository,
    private readonly ticketViewRepo = ticketViewRepository,
    private readonly stageMgr = stageManager,
  ) {}

  async getTicketsForEditor(editorTelegramId: number): Promise<TicketWithSubjectView[]> {
    const currentStage = await this.stageMgr.getCurrentStageFast();
    if (currentStage !== ProcessStage.TICKETING && currentStage !== ProcessStage.FINISHED) {
      throw new Error(`Просмотр билетов возможен только на этапах '${ProcessStage.TICKETING}' или '${ProcessStage.FINISHED}'`);
    }

    const user = await this.userRepo.findById(editorTelegramId);
    if (!user || user.editor !== 1) {
      throw new Error("Пользователь не является редактором.");
    }

    const edits = await this.editorRepo.findByUserId(editorTelegramId);
    const editedSubjectIds = edits.map(edit => edit.subjectId);
    if (editedSubjectIds.length === 0) return [];

    return this.ticketViewRepo.findByEditorIdAndSubjectIds(editorTelegramId, editedSubjectIds);
  }

  async getTicket(editorTelegramId: number, ticketId: number): Promise<TicketWithSubjectView | null> {
    const currentStage = await this.stageMgr.getCurrentStageFast();
    if (currentStage !== ProcessStage.TICKETING && currentStage !== ProcessStage.FINISHED) {
      throw new Error(`Получение билета недоступно на текущем этапе.`);
    }

    const user = await this.userRepo.findById(editorTelegramId);
    if (!user || user.editor !== 1) {
      throw new Error("Пользователь не является редактором.");
    }

    const ticketToUpdate = await this.ticketRepo.findByTicketIdAndEditorId(ticketId, editorTelegramId);
    if (!ticketToUpdate) {
      throw new Error(`Билет ${ticketId} не назначен вам или не существует.`);
    }

    if (ticketToUpdate.status !== TicketStatus.ON_CHECK && ticketToUpdate.status !== TicketStatus.APPROVED) {
      throw new Error(`Билет ${ticketId} не находится на проверке и не одобрен.`);
    }

    return await this.ticketViewRepo.findByTicketId(ticketId);
  }

  async sendTicketForRework(editorTelegramId: number, ticketId: number, comment?: string): Promise<TicketWithSubjectView> {
    const ticketView = await this.getTicket(editorTelegramId, ticketId);
    if (!ticketView || ticketView.status !== TicketStatus.ON_CHECK) {
      throw new Error(`Билет не находится на проверке.`);
    }

    await this.ticketRepo.update(ticketId, {
      status: TicketStatus.ON_REWORK,
      updatedAt: new Date().toISOString(),
      ...(comment !== undefined && { editorComment: comment }),
    });

    await ticketSheetRepository
      .updateTicketCellColor(ticketView.subjectName, ticketView.ticketNumber, TicketStatus.ON_REWORK)
      .catch(err => console.error('Ошибка покраски ячейки в Sheets:', err));

    return ticketView;
  }

  async acceptTicket(editorTelegramId: number, ticketId: number): Promise<TicketWithSubjectView> {
    const ticketView = await this.getTicket(editorTelegramId, ticketId);
    if (!ticketView || ticketView.status !== TicketStatus.ON_CHECK) {
      throw new Error(`Билет не находится на проверке.`);
    }

    await this.ticketRepo.update(ticketId, {
      status: TicketStatus.APPROVED,
      updatedAt: new Date().toISOString(),
    });

    await ticketSheetRepository
      .updateTicketCellColor(ticketView.subjectName, ticketView.ticketNumber, TicketStatus.APPROVED)
      .catch(err => console.error('Ошибка покраски ячейки в Sheets:', err));

    return ticketView;
  }

  async replaceTicket(editorTelegramId: number, ticketId: number, fileExtension: string): Promise<number> {
    const ticketView = await this.getTicket(editorTelegramId, ticketId);
    if (!ticketView) {
      throw new Error(`Билет не найден или недоступен.`);
    }

    const newFileVersion = (ticketView.fileVersion ?? 0) + 1;

    await this.ticketRepo.update(ticketId, {
      updatedAt: new Date().toISOString(),
      fileVersion: newFileVersion,
      fileExtension,
    });

    return newFileVersion;
  }
}

export const editorService = new EditorService();
