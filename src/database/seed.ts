import { db } from './client.js';
import { ProcessStage } from '../types/entities.js';

const FIRST_NAMES = ['Иван', 'Алексей', 'Михаил', 'Дмитрий', 'Артем', 'Сергей', 'Никита', 'Павел', 'Александр', 'Егор', 'Ольга', 'Анна', 'Елена', 'Мария', 'Юлия', 'Татьяна'];
const LAST_NAMES = ['Иванов', 'Петров', 'Смирнов', 'Сергеев', 'Кузнецов', 'Попов', 'Васильев', 'Соколов', 'Новиков', 'Федоров', 'Морозов', 'Волков', 'Алексеев', 'Лебедев'];

function generateFio(): string {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${lastName} ${firstName}`;
}

export async function seedFakeData(count: number = 25): Promise<void> {
  console.log(`⏳ Старт генерации ${count} фейковых пользователей...`);

  await db.transaction().execute(async (trx) => {
    let subjects = await trx.selectFrom('subjects').selectAll().execute();
    if (subjects.length === 0) {
      console.log('ℹ️ Предметы не найдены. Создаем тестовые предметы...');
      await trx.insertInto('subjects').values([
        { subjectName: 'Высшая Математика' },
        { subjectName: 'Операционные Системы' },
        { subjectName: 'Базы Данных' }
      ]).execute();
      subjects = await trx.selectFrom('subjects').selectAll().execute();
    }

    await trx.deleteFrom('user_main_menu_states').where('telegramId', '>=', 100000).execute();
    await trx.deleteFrom('sessions').where('telegramId', '>=', 100000).execute();
    await trx.deleteFrom('users').where('telegramId', '>=', 100000).execute();

    await trx.updateTable('process_config')
      .set({ currentStage: ProcessStage.REGISTRATION })
      .where('id', '=', 'global')
      .execute();

    for (let i = 0; i < count; i++) {
      const fakeTelegramId = 100000 + i;
      const fakeFio = generateFio();
      const isEditorCandidate = Math.random() > 0.75;

      await trx.insertInto('users').values({
        telegramId: fakeTelegramId,
        userName: fakeFio,
        registeredAt: new Date(Date.now() - i * 60000).toISOString(),
        student: 1,
        editor: 0,
        chiefEditor: 0
      }).execute();

      const shuffledSubjects = [...subjects].sort(() => 0.5 - Math.random());
      const selectedForPrep = shuffledSubjects.slice(0, Math.floor(Math.random() * 2) + 1);

      for (const sub of selectedForPrep) {
        await trx.insertInto('registrations_for_subjects').values({
          telegramId: fakeTelegramId,
          subjectId: sub.subjectId
        }).execute();
      }

      if (isEditorCandidate) {
        const targetSub = subjects[Math.floor(Math.random() * subjects.length)];
        await trx.insertInto('editor_requests').values({
          telegramId: fakeTelegramId,
          subjectId: targetSub.subjectId
        }).execute();
      }
    }
  });

  console.log(`✅ База данных успешно заполнена ${count} тестовыми пользователями.`);
}

