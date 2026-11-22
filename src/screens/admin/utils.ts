import { chiefEditorService } from '../../services/ChiefEditorService.js';

export async function getDeadlinesText(chiefEditorTelegramId: number): Promise<string> {
  const cfg = await chiefEditorService.getDeadlines(chiefEditorTelegramId);
  
  const reg = cfg?.registrationEnd ? new Date(cfg.registrationEnd).toLocaleDateString() : '❌ Не установлена';
  const dist = cfg?.distributionEnd ? new Date(cfg.distributionEnd).toLocaleDateString() : '❌ Не установлена';
  const tick = cfg?.ticketingEnd ? new Date(cfg.ticketingEnd).toLocaleDateString() : '❌ Не установлена';

  return `📅 *Текущие дедлайны*:\n` +
         `1. Регистрация до:  ${reg}\n` +
         `2. Распределение до: ${dist}\n` +
         `3. Подготовка до:    ${tick}\n`;
}

export async function getPreparationStatusText(chiefEditorTelegramId: number): Promise<string> {
  const stats = await chiefEditorService.getPreparationStats(chiefEditorTelegramId);

  let subjectsText = '';
  if (stats.length === 0) {
    subjectsText = '❌ Предметы еще не загружены';
  } else {
    subjectsText = stats
      .map((sub, index) => `${index + 1}. *${sub.name}* (${sub.ticketsCount})`)
      .join('\n');
  }

  return `📚 *Загруженные предметы и билеты*:\n${subjectsText}\n`;
}

export async function getRegistrationStatusText(chiefEditorTelegramId: number): Promise<string> {
  const stats = await chiefEditorService.getRegistrationStats(chiefEditorTelegramId);

  return `📝 *Этап регистрации участников*\n\n` +
         `👥 *Текущая активность*:\n` +
         `• Зарегистрировано студентов: *${stats.totalStudents}*\n` +
         `• Активных редакторов в системе: *${stats.totalEditors}*\n\n` +
         `_Сейчас студенты выбирают предметы, а редакторы могут подавать заявки на ведение предметов._`;
}

