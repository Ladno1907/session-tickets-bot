import { db } from './client.js';

export async function inspectDatabase(): Promise<void> {
  console.log('\n🔍 === ИНСПЕКТОР БАЗЫ ДАННЫХ SQLITE ===');

  const config = await db.selectFrom('process_config').selectAll().execute();
  console.log('\n⚙️ ТЕКУЩАЯ СТАДИЯ ПРОЦЕССА:');
  console.table(config);

  const subjects = await db.selectFrom('subjects').selectAll().execute();
  console.log('\n📚 СПИСОК ПРЕДМЕТОВ:');
  console.table(subjects);

  const totalUsers = await db.selectFrom('users').selectAll().execute();
  console.log(`\n👥 ВСЕГО ПОЛЬЗОВАТЕЛЕЙ В СИСТЕМЕ: ${totalUsers.length}`);
  
  const sampleUsers = await db.selectFrom('users')
    .select(['telegramId', 'userName', 'student', 'editor', 'chiefEditor'])
    .limit(10)
    .execute();
  console.log('📋 Первые 10 пользователей (для примера):');
  console.table(sampleUsers);

  const assignedTickets = await db.selectFrom('tickets')
    .innerJoin('subjects', 'subjects.subjectId', 'tickets.subjectId')
    .select(['tickets.ticketNumber', 'subjects.subjectName', 'tickets.studentId', 'tickets.editorId', 'tickets.status'])
    .where('tickets.studentId', 'is not', null)
    .limit(15)
    .execute();

  if (assignedTickets.length > 0) {
    console.log('\n🎫 ПРИМЕР РАСПРЕДЕЛЕНИЯ БИЛЕТОВ (Первые 15 записей):');
    console.table(assignedTickets);
  } else {
    console.log('\n⚪ Билеты пока никому не распределены (идет этап регистрации).');
  }
}

