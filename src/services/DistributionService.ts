import { db } from '../database/client.js';
import { userRepository } from '../database/repositories/UserRepo.js';
import { editorRepository } from '../database/repositories/EditorRepo.js';
import { ticketRepository } from '../database/repositories/TicketRepo.js';
import { subjectRepository } from '../database/repositories/SubjectRepo.js';
import { registrationRepository } from '../database/repositories/RegistrationRepo.js';
import { userMainMenuStateRepository } from '../database/repositories/UserMainMenuStateRepo.js';
import { sessionRepository } from '../database/repositories/SessionRepo.js';
import { ticketSheetRepository } from '../database/sheetRepositories/TicketSheetRepository.js';

interface StudentAllocationState {
  telegramId: number;
  userName: string;
  registeredAtMs: number;
  subjectIds: Set<number>;
  expectedShare: number;
  targetQuota: number;
  assignedTotal: number;
  assignedBySubject: Map<number, number>;
}

/**
 * Сервис распределения билетов между студентами (с глобальной балансировкой нагрузки,
 * учётом неполного набора предметов, приоритетом ранней регистрации и чередованием сложности)
 * и пропорциональной нарезки билетов между редакторами.
 */
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

  // =========================================================================
  // РАСПРЕДЕЛЕНИЕ БИЛЕТОВ ПО СТУДЕНТАМ И РЕДАКТОРАМ
  // =========================================================================

  /**
   * Распределяет билеты между активными студентами с глобальной балансировкой:
   * - Суммарное количество билетов у студентов с одинаковым набором предметов равно (±1).
   * - Студентам с неполным набором предметов добавляется +1 компенсационный билет,
   *   но их нагрузка строго ниже, чем у студентов с полным набором дисциплин.
   * - При делении с остатком лишний билет получают зарегистрировавшиеся позже (`registeredAt DESC`).
   * - Внутри каждого предмета билеты чередуются «змейкой» (сложные/лёгкие).
   */
  public async distributeTicketsToStudents(targetSubjectId?: number): Promise<void> {
    const subjectsWithAssignments = await db.transaction().execute(async (trx) => {
      const txSubjectRepo = this.subjectRepo.withTransaction(trx);
      const txTicketRepo = this.ticketRepo.withTransaction(trx);
      const txRegistrationRepo = this.registrationRepo.withTransaction(trx);
      const txUserRepo = this.userRepo.withTransaction(trx);

      const allSubjects = await txSubjectRepo.findAll();
      const targetSubjects = targetSubjectId !== undefined
        ? allSubjects.filter((s) => s.subjectId === targetSubjectId)
        : allSubjects;

      // Сбрасываем привязки студентов в целевых предметах (статусы уже сданных билетов сохраняются)
      for (const subject of targetSubjects) {
        await txTicketRepo.clearStudentAssignmentsBySubject(subject.subjectId);
      }

      // Собираем актуальную карту билетов и активных студентов по всем предметам
      const allUsers = await txUserRepo.findAll();
      const activeStudents = allUsers
        .filter((u) => u.student === 1)
        .sort((a, b) => new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime());

      const ticketsBySubject = new Map<number, Awaited<ReturnType<typeof txTicketRepo.findBySubjectIdSorted>>>();
      const studentsBySubject = new Map<number, Set<number>>();

      for (const sub of allSubjects) {
        const subTickets = await txTicketRepo.findBySubjectIdSorted(sub.subjectId);
        ticketsBySubject.set(sub.subjectId, subTickets);

        const regs = await txRegistrationRepo.findActiveStudentsBySubjectId(sub.subjectId);
        studentsBySubject.set(sub.subjectId, new Set(regs.map((r) => r.telegramId)));
      }

      // Инициализируем состояние каждого активного студента
      const studentStates = new Map<number, StudentAllocationState>();
      for (const u of activeStudents) {
        const subSet = new Set<number>();
        const assignedBySub = new Map<number, number>();
        let assignedTotal = 0;

        for (const sub of allSubjects) {
          if (studentsBySubject.get(sub.subjectId)?.has(u.telegramId)) {
            subSet.add(sub.subjectId);
            assignedBySub.set(sub.subjectId, 0);
          }

          // Учитываем уже закреплённые билеты в незатронутых предметах (при частичном перераспределении)
          if (targetSubjectId !== undefined && sub.subjectId !== targetSubjectId) {
            const existing = ticketsBySubject.get(sub.subjectId) || [];
            const count = existing.filter((t) => t.studentId === u.telegramId).length;
            if (count > 0) {
              assignedBySub.set(sub.subjectId, count);
              assignedTotal += count;
            }
          }
        }

        if (subSet.size > 0) {
          studentStates.set(u.telegramId, {
            telegramId: u.telegramId,
            userName: u.userName,
            registeredAtMs: new Date(u.registeredAt).getTime(),
            subjectIds: subSet,
            expectedShare: 0,
            targetQuota: 0,
            assignedTotal,
            assignedBySubject: assignedBySub,
          });
        }
      }

      if (studentStates.size === 0) return [];

      // Вычисляем базовую взвешенную долю каждого студента по его предметам
      let maxSubjectsCount = 0;
      let totalAllTickets = 0;

      for (const sub of allSubjects) {
        const subTickets = ticketsBySubject.get(sub.subjectId) || [];
        const subStudentIds = Array.from(studentsBySubject.get(sub.subjectId) || []).filter((id) =>
          studentStates.has(id)
        );
        if (subTickets.length === 0 || subStudentIds.length === 0) continue;

        totalAllTickets += subTickets.length;
        const sharePerStudent = subTickets.length / subStudentIds.length;

        for (const uid of subStudentIds) {
          const st = studentStates.get(uid)!;
          st.expectedShare += sharePerStudent;
        }
      }

      for (const st of studentStates.values()) {
        if (st.subjectIds.size > maxSubjectsCount) {
          maxSubjectsCount = st.subjectIds.size;
        }
      }

      // Находим эталонную нагрузку тех, кто выбрал полный набор предметов
      let fullSetMinQuota = Infinity;
      for (const st of studentStates.values()) {
        if (st.subjectIds.size === maxSubjectsCount) {
          const base = Math.floor(st.expectedShare);
          if (base < fullSetMinQuota) fullSetMinQuota = base;
        }
      }
      if (!isFinite(fullSetMinQuota)) fullSetMinQuota = totalAllTickets;

      // Применяем компенсацию (+1) для тех, у кого неполный набор предметов,
      // но строго не выше (fullSetMinQuota - 1)
      for (const st of studentStates.values()) {
        let rawQuota = st.expectedShare;
        if (st.subjectIds.size < maxSubjectsCount && maxSubjectsCount > 1) {
          const maxAllowedForPartial = Math.max(1, fullSetMinQuota - 1);
          rawQuota = Math.min(maxAllowedForPartial, st.expectedShare + 1);
        }
        st.targetQuota = Math.floor(rawQuota);
      }

      // Распределяем остаток билетов по +1 от более поздних регистраций к более ранним
      const orderedByRegAsc = Array.from(studentStates.values()).sort(
        (a, b) => a.registeredAtMs - b.registeredAtMs
      );
      let allocatedSum = orderedByRegAsc.reduce((acc, s) => acc + s.targetQuota, 0);
      let remainder = totalAllTickets - allocatedSum;

      // Идём с конца (самые поздние регистрации получают +1 первыми)
      let cursor = orderedByRegAsc.length - 1;
      while (remainder > 0 && orderedByRegAsc.length > 0) {
        const candidate = orderedByRegAsc.at(cursor)!;
        const maxPossibleForCandidate =
          candidate.subjectIds.size < maxSubjectsCount && maxSubjectsCount > 1
            ? Math.max(1, fullSetMinQuota - 1)
            : Number.MAX_SAFE_INTEGER;

        if (candidate.targetQuota < maxPossibleForCandidate) {
          candidate.targetQuota += 1;
          remainder -= 1;
        }

        cursor -= 1;
        if (cursor < 0) {
          cursor = orderedByRegAsc.length - 1;
          // Защита от бесконечного цикла, если все неполные упёрлись в потолок
          if (remainder === totalAllTickets - allocatedSum) {
            for (let k = orderedByRegAsc.length - 1; k >= 0 && remainder > 0; k--) {
              orderedByRegAsc.at(k)!.targetQuota += 1;
              remainder -= 1;
            }
            break;
          }
          allocatedSum = orderedByRegAsc.reduce((acc, s) => acc + s.targetQuota, 0);
        }
      }

      // Распределяем билеты по каждому целевому предмету с чередованием сложности («змейкой»)
      // Обрабатываем сначала предметы с наименьшим количеством участников (узкие места)
      const sortedTargetSubjects = [...targetSubjects].sort((a, b) => {
        const countA = studentsBySubject.get(a.subjectId)?.size ?? 0;
        const countB = studentsBySubject.get(b.subjectId)?.size ?? 0;
        return countA - countB;
      });

      const results: { sheetName: string; data: { ticketNumber: number; studentFio: string }[] }[] = [];

      for (const subject of sortedTargetSubjects) {
        const rawTickets = ticketsBySubject.get(subject.subjectId) || [];
        if (rawTickets.length === 0) continue;

        const eligibleStudents = Array.from(studentStates.values()).filter((st) =>
          st.subjectIds.has(subject.subjectId)
        );
        if (eligibleStudents.length === 0) continue;

        const snakeTickets = this.reorderTicketsSnake(rawTickets);
        const currentSubjectAssignments: { ticketNumber: number; studentFio: string }[] = [];

        for (const ticket of snakeTickets) {
          // Выбираем следующего студента:
          // 1) Меньше всего билетов по текущему предмету (равномерность внутри предмета)
          // 2) Наибольший оставшийся запас до глобальной квоты (targetQuota - assignedTotal)
          // 3) Наименьшее общее количество уже выданных билетов (assignedTotal)
          // 4) Более поздняя регистрация (registeredAtMs DESC — ранние получают меньше при остатке)
          eligibleStudents.sort((a, b) => {
            const subCountA = a.assignedBySubject.get(subject.subjectId) ?? 0;
            const subCountB = b.assignedBySubject.get(subject.subjectId) ?? 0;
            if (subCountA !== subCountB) return subCountA - subCountB;

            const deficitA = a.targetQuota - a.assignedTotal;
            const deficitB = b.targetQuota - b.assignedTotal;
            if (deficitA !== deficitB) return deficitB - deficitA;

            if (a.assignedTotal !== b.assignedTotal) return a.assignedTotal - b.assignedTotal;

            return b.registeredAtMs - a.registeredAtMs;
          });

          const chosen = eligibleStudents.at(0)!;
          await txTicketRepo.assignTicketToStudent(ticket.ticketId, chosen.telegramId);

          chosen.assignedTotal += 1;
          chosen.assignedBySubject.set(
            subject.subjectId,
            (chosen.assignedBySubject.get(subject.subjectId) ?? 0) + 1
          );

          currentSubjectAssignments.push({
            ticketNumber: ticket.ticketNumber,
            studentFio: chosen.userName,
          });
        }

        currentSubjectAssignments.sort((a, b) => a.ticketNumber - b.ticketNumber);

        results.push({
          sheetName: subject.subjectName,
          data: currentSubjectAssignments,
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

  /**
   * Пропорционально нарезает билеты каждого предмета непрерывными диапазонами между
   * утверждёнными редакторами и выгружает с объединёнными ячейками в Google Sheets.
   */
  public async distributeTicketsToEditors(targetSubjectId?: number): Promise<void> {
    const editorsWithAssignments = await db.transaction().execute(async (trx) => {
      const txSubjectRepo = this.subjectRepo.withTransaction(trx);
      const txTicketRepo = this.ticketRepo.withTransaction(trx);
      const txEditorRepo = this.editorRepo.withTransaction(trx);

      const allSubjects = await txSubjectRepo.findAll();
      const subjects = targetSubjectId !== undefined
        ? allSubjects.filter((s) => s.subjectId === targetSubjectId)
        : allSubjects;

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
          const editor = editorRecords.at(i)!;
          const countForThisEditor = baseCount + (i < remainder ? 1 : 0);

          for (const _ of Array.from({ length: countForThisEditor })) {
            const currentTicket = tickets.at(ticketIndex++)!;
            await txTicketRepo.assignTicketToEditor(currentTicket.ticketId, editor.telegramId);

            currentSubjectAssignments.push({
              ticketNumber: currentTicket.ticketNumber,
              editorFio: editor.userName,
            });
          }
        }

        results.push({
          sheetName: subject.subjectName,
          data: currentSubjectAssignments,
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

  // =========================================================================
  // ОЧИСТКА НЕАКТИВНЫХ УЧАСТНИКОВ
  // =========================================================================

  /**
   * Удаляет из базы данных пользователей без назначенных билетов (не являющихся редакторами или админами),
   * а также их сессии и состояния меню.
   */
  public async cleanupDeadUsersAndSessions(): Promise<number> {
    return db.transaction().execute(async (trx) => {
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

  // =========================================================================
  // ВСПОМОГАТЕЛЬНЫЕ ПРИВАТНЫЕ МЕТОДЫ
  // =========================================================================

  /**
   * Переупорядочивает отсортированный массив билетов «змейкой»
   * (первый, последний, второй, предпоследний...).
   */
  private reorderTicketsSnake<T>(tickets: T[]): T[] {
    const reordered: T[] = [];
    let left = 0;
    let right = tickets.length - 1;
    let takeFromLeft = true;

    while (left <= right) {
      if (takeFromLeft) {
        reordered.push(tickets.at(left++)!);
      } else {
        reordered.push(tickets.at(right--)!);
      }
      takeFromLeft = !takeFromLeft;
    }

    return reordered;
  }
}

export const distributionService = new DistributionService();
