import { db } from '../database/client.js';
import { userRepository } from '../database/repositories/UserRepo.js';
import { editorRepository } from '../database/repositories/EditorRepo.js';
import { ticketRepository } from '../database/repositories/TicketRepo.js';
import { subjectRepository } from '../database/repositories/SubjectRepo.js';
import { registrationRepository } from '../database/repositories/RegistrationRepo.js';
import { userMainMenuStateRepository } from '../database/repositories/UserMainMenuStateRepo.js';
import { sessionRepository } from '../database/repositories/SessionRepo.js';
import { ticketSheetRepository } from '../database/sheetRepositories/TicketSheetRepository.js';

export class DistributionService {
  constructor(
    private readonly userRepo = userRepository,
    private readonly editorRepo = editorRepository,
    private readonly ticketRepo = ticketRepository,
    private readonly subjectRepo = subjectRepository,
    private readonly registrationRepo = registrationRepository,
    private readonly mainMenuStateRepo = userMainMenuStateRepository,
    private readonly sessionRepo = sessionRepository,
    private readonly ticketSheetRepo = ticketSheetRepository
  ) {}

  private reorderTicketsSnake<T>(tickets: T[]): T[] {
    const reordered: T[] = [];
    let left = 0;
    let right = tickets.length - 1;
    let takeFromLeft = true;

    while (left <= right) {
      if (takeFromLeft) {
        reordered.push(tickets[left++]);
      } else {
        reordered.push(tickets[right--]);
      }
      takeFromLeft = !takeFromLeft;
    }
    return reordered;
  }

  public async distributeTicketsToStudents(): Promise<void> {
    const subjectsWithAssignments = await db.transaction().execute(async (trx) => {
      const txSubjectRepo = this.subjectRepo.withTransaction(trx);
      const txTicketRepo = this.ticketRepo.withTransaction(trx);
      const txRegistrationRepo = this.registrationRepo.withTransaction(trx);
      const txUserRepo = this.userRepo.withTransaction(trx);

      const subjects = await txSubjectRepo.findAll();
      const results: { sheetName: string; data: { ticketNumber: number; studentFio: string }[] }[] = [];

      for (const subject of subjects) {
        await txTicketRepo.clearStudentAssignmentsBySubject(subject.subjectId);

        const tickets = await txTicketRepo.findBySubjectIdSorted(subject.subjectId);
        if (tickets.length === 0) continue;

        const students = await txRegistrationRepo.findActiveStudentsBySubjectId(subject.subjectId);
        if (students.length === 0) continue;

        const snakeTickets = this.reorderTicketsSnake(tickets);
        const totalStudents = students.length;
        const totalTickets = snakeTickets.length;
        const baseCount = Math.floor(totalTickets / totalStudents);
        const remainder = totalTickets % totalStudents;

        let ticketIndex = 0;
        const currentSubjectAssignments: { ticketNumber: number; studentFio: string }[] = [];

        for (let i = 0; i < totalStudents; i++) {
          const student = students[i];
          const countForThisStudent = baseCount + (i < remainder ? 1 : 0);

          const studentUser = await txUserRepo.findById(student.telegramId);
          const studentName = studentUser ? studentUser.userName : 'Неизвестный Студент';

          for (const _ of Array.from({ length: countForThisStudent })) {
            const currentTicket = snakeTickets[ticketIndex++];
            await txTicketRepo.assignTicketToStudent(currentTicket.ticketId, student.telegramId);

            currentSubjectAssignments.push({
              ticketNumber: currentTicket.ticketNumber,
              studentFio: studentName
            });
          }
        }

        results.push({
          sheetName: subject.subjectName,
          data: currentSubjectAssignments
        });
      }

      return results;
    });

    for (const res of subjectsWithAssignments) {
      try {
        await this.ticketSheetRepo.saveAssignedStudents(res.sheetName, res.data);
        console.log(`DistributionService: Студенты успешно выгружены в Google Таблицу для предмета "${res.sheetName}"`);
      } catch (err) {
        console.error(`DistributionService: Ошибка выгрузки студентов в Sheets для предмета "${res.sheetName}":`, err);
      }
    }
  }

  public async distributeTicketsToEditors(): Promise<void> {
    const editorsWithAssignments = await db.transaction().execute(async (trx) => {
      const txSubjectRepo = this.subjectRepo.withTransaction(trx);
      const txTicketRepo = this.ticketRepo.withTransaction(trx);
      const txEditorRepo = this.editorRepo.withTransaction(trx);

      const subjects = await txSubjectRepo.findAll();
      const results: { sheetName: string; data: { ticketNumber: number; editorFio: string }[] }[] = [];

      for (const subject of subjects) {
        await txTicketRepo.clearEditorAssignmentsBySubject(subject.subjectId);

        const tickets = await txTicketRepo.findBySubjectIdSorted(subject.subjectId);
        if (tickets.length === 0) continue;

        const editorRecords = await txEditorRepo.findActiveEditorsWithNamesBySubjectId(subject.subjectId);
        if (editorRecords.length === 0) continue;

        const totalEditors = editorRecords.length;
        const totalTickets = tickets.length;
        const baseCount = Math.floor(totalTickets / totalEditors);
        const remainder = totalTickets % totalEditors;

        let ticketIndex = 0;
        const currentSubjectAssignments: { ticketNumber: number; editorFio: string }[] = [];

        for (let i = 0; i < totalEditors; i++) {
          const editor = editorRecords[i];
          const countForThisEditor = baseCount + (i < remainder ? 1 : 0);

          for (const _ of Array.from({ length: countForThisEditor })) {
            const currentTicket = tickets[ticketIndex++];
            await txTicketRepo.assignTicketToEditor(currentTicket.ticketId, editor.telegramId);

            currentSubjectAssignments.push({
              ticketNumber: currentTicket.ticketNumber,
              editorFio: editor.userName
            });
          }
        }

        results.push({
          sheetName: subject.subjectName,
          data: currentSubjectAssignments
        });
      }

      return results;
    });

    for (const res of editorsWithAssignments) {
      try {
        await this.ticketSheetRepo.saveAssignedEditors(res.sheetName, res.data);
        console.log(`DistributionService: Редакторы успешно выгружены в Google Таблицу для предмета "${res.sheetName}"`);
      } catch (err) {
        console.error(`DistributionService: Ошибка выгрузки редакторов в Sheets для предмета "${res.sheetName}":`, err);
      }
    }
  }

  public async cleanupDeadUsersAndSessions(): Promise<number> {
    return await db.transaction().execute(async (trx) => {
      const txUserRepo = this.userRepo.withTransaction(trx);
      const txMainMenuRepo = this.mainMenuStateRepo.withTransaction(trx);
      const txSessionRepo = this.sessionRepo.withTransaction(trx);

      const deadUsers = await txUserRepo.findDeadUsers();
      if (deadUsers.length === 0) return 0;

      for (const user of deadUsers) {
        await txMainMenuRepo.removeByUserId(user.telegramId);
        await txSessionRepo.deleteById(user.telegramId);
        await txUserRepo.remove(user.telegramId);
      }

      console.log(`DistributionService: Через репозитории удалено неактивных участников: ${deadUsers.length}`);
      return deadUsers.length;
    });
  }
}

export const distributionService = new DistributionService();

