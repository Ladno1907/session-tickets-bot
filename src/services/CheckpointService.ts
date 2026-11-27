import { Bot } from 'grammy';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { config } from '../config.js';
import { MyContext } from '../types/context.js';
import { TicketStatus } from '../types/entities.js';
import { checkpointRepository } from '../database/repositories/CheckpointRepo.js';
import { processConfigRepository } from '../database/repositories/ProcessConfigRepo.js';
import { subjectRepository } from '../database/repositories/SubjectRepo.js';
import { ticketRepository } from '../database/repositories/TicketRepo.js';
import { userRepository } from '../database/repositories/UserRepo.js';
import { escapeMarkdown } from '../utils/format.js';

export interface DebtorSubjectInfo {
  subjectName: string;
  submitted: number;
  required: number;
  total: number;
}

export interface CheckpointDebtor {
  telegramId: number;
  userName: string;
  missedDeadlinesCount: number;
  subjects: DebtorSubjectInfo[];
}

export interface TimelinePoint {
  checkpointId: number | null; // null для финального ticketingEnd
  index: number; // 1-based порядковый номер дедлайна
  totalPoints: number;
  deadlineAt: Date;
  remindedAt?: string | null;
  processedAt?: string | null;
}

/**
 * Сервис управления промежуточными дедлайнами (контрольными точками),
 * расчёта равномерной нормы сдачи билетов, напоминаний и фиксации просрочек.
 */
export class CheckpointService {
  constructor(
    private readonly checkpointRepo = checkpointRepository,
    private readonly processConfigRepo = processConfigRepository,
    private readonly subjectRepo = subjectRepository,
    private readonly ticketRepo = ticketRepository,
    private readonly userRepo = userRepository,
  ) {}

  private readonly settingsPath = join(process.cwd(), 'data', 'checkpoint_settings.json');

  // =========================================================================
  // ПОСТРОЕНИЕ ШКАЛЫ ДЕДЛАЙНОВ И РАСЧЁТ ДОЛЖНИКОВ
  // =========================================================================

  /**
   * Формирует отсортированную шкалу всех контрольных точек этапа `TICKETING`
   * (промежуточные чекпоинты из БД + финальный `ticketingEnd`, если он задан).
   */
  public async getTimeline(): Promise<TimelinePoint[]> {
    const checkpoints = await this.checkpointRepo.findAllSorted();
    const cfg = await this.processConfigRepo.findGlobalConfig();

    const rawPoints: {
      checkpointId: number | null;
      deadlineAt: Date;
      remindedAt?: string | null;
      processedAt?: string | null;
    }[] = checkpoints.map((cp) => ({
      checkpointId: cp.checkpointId,
      deadlineAt: new Date(cp.deadlineAt),
      remindedAt: cp.remindedAt,
      processedAt: cp.processedAt,
    }));

    if (cfg?.ticketingEnd) {
      const finalDate = new Date(cfg.ticketingEnd);
      if (finalDate.getUTCHours() === 0 && finalDate.getUTCMinutes() === 0) {
        finalDate.setUTCHours(20, 0, 0, 0);
      }

      const alreadyExists = rawPoints.some(
        (p) => Math.abs(p.deadlineAt.getTime() - finalDate.getTime()) < 60_000
      );
      if (!alreadyExists) {
        rawPoints.push({
          checkpointId: null,
          deadlineAt: finalDate,
        });
      }
    }

    rawPoints.sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime());

    return rawPoints.map((p, idx) => ({
      ...p,
      index: idx + 1,
      totalPoints: rawPoints.length,
    }));
  }

  /**
   * Вычисляет список студентов, не выполнивших норму к дедлайну `stepIndex` из `totalSteps`.
   * Норма по каждому предмету рассчитывается равномерно: `Math.ceil((totalTickets * stepIndex) / totalSteps)`.
   * Если студент отстаёт хотя бы по одному предмету — он включается в список должников.
   */
  public async getDebtorsForStep(stepIndex: number, totalSteps: number): Promise<CheckpointDebtor[]> {
    const subjects = await this.subjectRepo.findAll();
    const users = await this.userRepo.findAll();
    const usersMap = new Map(users.map((u) => [u.telegramId, u]));

    const debtorsMap = new Map<number, CheckpointDebtor>();

    for (const sub of subjects) {
      const tickets = await this.ticketRepo.findBySubjectIdSorted(sub.subjectId);
      const byStudent = new Map<number, { total: number; submitted: number }>();

      for (const t of tickets) {
        if (!t.studentId) continue;
        const stat = byStudent.get(t.studentId) || { total: 0, submitted: 0 };
        stat.total++;

        if (
          t.status === TicketStatus.ON_CHECK ||
          t.status === TicketStatus.APPROVED ||
          t.status === TicketStatus.ON_REWORK
        ) {
          stat.submitted++;
        }

        byStudent.set(t.studentId, stat);
      }

      for (const [studentId, stat] of byStudent) {
        const user = usersMap.get(studentId);
        if (!user || user.student !== 1) continue;

        const required = Math.ceil((stat.total * stepIndex) / totalSteps);
        if (stat.submitted < required) {
          const entry = debtorsMap.get(studentId) || {
            telegramId: studentId,
            userName: user.userName,
            missedDeadlinesCount: user.missedDeadlines ?? 0,
            subjects: [],
          };

          entry.subjects.push({
            subjectName: sub.subjectName,
            submitted: stat.submitted,
            required,
            total: stat.total,
          });

          debtorsMap.set(studentId, entry);
        }
      }
    }

    return Array.from(debtorsMap.values()).sort((a, b) => a.userName.localeCompare(b.userName));
  }

  /**
   * Возвращает ближайший активный (ещё не обработанный) дедлайн и его должников для превью в админке.
   */
  public async getNextActiveCheckpointStatus(): Promise<{
    point: TimelinePoint | null;
    debtors: CheckpointDebtor[];
  }> {
    const timeline = await this.getTimeline();
    const nextPoint = timeline.find((p) => !p.processedAt) || timeline[timeline.length - 1] || null;

    if (!nextPoint) {
      return { point: null, debtors: [] };
    }

    const debtors = await this.getDebtorsForStep(nextPoint.index, nextPoint.totalPoints);
    return { point: nextPoint, debtors };
  }

  // =========================================================================
  // ФОНОВАЯ ПРОВЕРКА НАПОМИНАНИЙ И ПРОСРОЧЕК (ВЫЗЫВАЕТСЯ ИЗ StageManager)
  // =========================================================================

  /**
   * Проверяет все промежуточные чекпоинты:
   * 1) Если до дедлайна осталось <= `checkpointReminderHours` и напоминание ещё не слалось — рассылает предупреждение должникам.
   * 2) Если дедлайн наступил и ещё не обработан — начисляет `+1` к `missed_deadlines` должникам и рассылает уведомления.
   */
  public async processCheckpoints(bot: Bot<MyContext>): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.autoRemind && !settings.autoPenalize) return;

    const timeline = await this.getTimeline();
    if (timeline.length === 0) return;

    const now = new Date();
    const reminderWindowMs = config.checkpointReminderHours * 60 * 60 * 1000;

    for (const point of timeline) {
      if (point.checkpointId === null) continue;

      const timeLeftMs = point.deadlineAt.getTime() - now.getTime();
      const dateStr = point.deadlineAt.toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      if (settings.autoPenalize && timeLeftMs <= 0 && !point.processedAt) {
        const debtors = await this.getDebtorsForStep(point.index, point.totalPoints);
        const debtorIds = debtors.map((d) => d.telegramId);

        await this.userRepo.incrementMissedDeadlines(debtorIds);
        await this.checkpointRepo.update(point.checkpointId, {
          processedAt: now.toISOString(),
          ...(point.remindedAt ? {} : { remindedAt: now.toISOString() }),
        });

        for (const d of debtors) {
          const newMisses = d.missedDeadlinesCount + 1;
          const details = d.subjects
            .map((s) => `• *${escapeMarkdown(s.subjectName)}*: сдано *${s.submitted}* из *${s.required}* (всего ${s.total})`)
            .join('\n');

          const msg =
            `🚨 *Пропущен промежуточный дедлайн №${point.index} (${dateStr} МСК)!*\n\n` +
            `Вы не успели сдать необходимый минимум билетов:\n${details}\n\n` +
            `⚠️ Всего пропущенных дедлайнов: *${newMisses}*.\n` +
            `_Напоминаем: за второй пропуск дедлайна следует дисквалификация._`;

          await bot.api.sendMessage(d.telegramId, msg, { parse_mode: 'Markdown' }).catch(() => {});
          await new Promise((r) => setTimeout(r, config.delayMs));
        }

        const adminReport =
          debtors.length === 0
            ? `✅ *Дедлайн №${point.index} (${dateStr} МСК) завершён!*\nВсе студенты выполнили норму, должников нет.`
            : `📊 *Итоги дедлайна №${point.index} (${dateStr} МСК):*\n` +
              `Пропустили дедлайн (*${debtors.length}* чел.):\n\n` +
              debtors
                .map((d, i) => {
                  const subStr = d.subjects.map((s) => `${s.subjectName}: ${s.submitted}/${s.required}`).join(', ');
                  return `${i + 1}. *${escapeMarkdown(d.userName)}* (пропусков: *${d.missedDeadlinesCount + 1}*) — _${escapeMarkdown(subStr)}_`;
                })
                .join('\n');

        for (const adminId of config.chiefEditorIds) {
          await bot.api.sendMessage(adminId, adminReport, { parse_mode: 'Markdown' }).catch(() => {});
          await new Promise((r) => setTimeout(r, config.delayMs));
        }
      }

      else if (settings.autoRemind && timeLeftMs > 0 && timeLeftMs <= reminderWindowMs && !point.remindedAt) {
        const debtors = await this.getDebtorsForStep(point.index, point.totalPoints);
        await this.checkpointRepo.update(point.checkpointId, {
          remindedAt: now.toISOString(),
        });

        for (const d of debtors) {
          const details = d.subjects
            .map((s) => `• *${escapeMarkdown(s.subjectName)}*: сдано *${s.submitted}*, нужно к дедлайну — *${s.required}*`)
            .join('\n');

          const msg =
            `⏰ *Напоминание о дедлайне №${point.index} (${dateStr} МСК)!*\n\n` +
            `До окончания промежуточного срока осталось меньше *${config.checkpointReminderHours} ч.* У вас ещё не закрыта норма по следующим предметам:\n` +
            `${details}\n\n` +
            `📤 Загрузите решения в меню /user, чтобы не получить пропуск дедлайна.`;

          await bot.api.sendMessage(d.telegramId, msg, { parse_mode: 'Markdown' }).catch(() => {});
          await new Promise((r) => setTimeout(r, config.delayMs));
        }
      }
    }
  }

  /**
   * Возвращает текущие настройки автоматических напоминаний и авто-фиксации просрочек.
   */
  public async getSettings(): Promise<{ autoRemind: boolean; autoPenalize: boolean }> {
    try {
      if (existsSync(this.settingsPath)) {
        const raw = await readFile(this.settingsPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          autoRemind: parsed.autoRemind !== false,
          autoPenalize: parsed.autoPenalize !== false,
        };
      }
    } catch {}
    return { autoRemind: true, autoPenalize: true };
  }

  /**
   * Переключает один из тумблеров (`autoRemind` или `autoPenalize`).
   */
  public async toggleSetting(key: 'autoRemind' | 'autoPenalize'): Promise<{ autoRemind: boolean; autoPenalize: boolean }> {
    const current = await this.getSettings();
    const updated = { ...current, [key]: !current[key] };
    await mkdir(dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  }
}

export const checkpointService = new CheckpointService();
