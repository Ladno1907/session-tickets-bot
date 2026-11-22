import { sql } from 'kysely';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { db } from './client.js';

export async function migrate(): Promise<void> {
  await mkdir(dirname(config.db.path), { recursive: true });

  await db.schema
    .createTable('sessions')
    .ifNotExists()
    .addColumn('telegram_id', 'integer', (col) => col.primaryKey())
    .addColumn('session_data', 'text')
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .createTable('process_config')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey().check(sql`id = 'global'`))
    .addColumn('current_stage', 'text', (col) =>
      col.notNull().check(sql`current_stage IN ('preparation', 'registration', 'distribution', 'ticketing', 'finished')`).defaultTo('preparation')
    )
    .addColumn('registration_end', 'text')
    .addColumn('distribution_end', 'text')
    .addColumn('ticketing_end', 'text')
    .execute();

  await db.schema
    .createTable('subjects')
    .ifNotExists()
    .addColumn('subject_id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('subject_name', 'text', (col) => col.notNull().unique())
    .execute();

  await db.schema
    .createTable('users')
    .ifNotExists()
    .addColumn('telegram_id', 'integer', (col) => col.primaryKey())
    .addColumn('user_name', 'text', (col) => col.notNull())
    .addColumn('registered_at', 'text', (col) => col.notNull())
    .addColumn('student', 'integer', (col) => col.notNull().defaultTo(0).check(sql`student IN (0, 1)`))
    .addColumn('editor', 'integer', (col) => col.notNull().defaultTo(0).check(sql`editor IN (0, 1)`))
    .addColumn('chief_editor', 'integer', (col) => col.notNull().defaultTo(0).check(sql`chief_editor IN (0, 1)`))
    .execute();

  await db.schema
    .createTable('registrations_for_subjects')
    .ifNotExists()
    .addColumn('telegram_id', 'integer', (col) =>
      col.notNull().references('users.telegram_id').onDelete('cascade')
    )
    .addColumn('subject_id', 'integer', (col) =>
      col.notNull().references('subjects.subject_id').onDelete('cascade')
    )
    .addPrimaryKeyConstraint('pk_registrations_for_subjects', ['telegram_id', 'subject_id'])
    .execute();

  await db.schema
    .createTable('editors_for_subjects')
    .ifNotExists()
    .addColumn('telegram_id', 'integer', (col) =>
      col.notNull().references('users.telegram_id').onDelete('cascade')
    )
    .addColumn('subject_id', 'integer', (col) =>
      col.notNull().references('subjects.subject_id').onDelete('cascade')
    )
    .addPrimaryKeyConstraint('pk_edits_for_subjects', ['telegram_id', 'subject_id'])
    .execute();

  await db.schema
    .createTable('editor_requests')
    .ifNotExists()
    .addColumn('telegram_id', 'integer', (col) =>
      col.notNull().references('users.telegram_id').onDelete('cascade')
    )
    .addColumn('subject_id', 'integer', (col) =>
      col.notNull().references('subjects.subject_id').onDelete('cascade')
    )
    .addPrimaryKeyConstraint('pk_editor_requests', ['telegram_id', 'subject_id'])
    .execute();

  await db.schema
    .createTable('tickets')
    .ifNotExists()
    .addColumn('ticket_id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('subject_id', 'integer', (col) =>
      col.notNull().references('subjects.subject_id').onDelete('cascade')
    )
    .addColumn('ticket_number', 'integer', (col) => col.notNull())
    .addColumn('question', 'text', (col) => col.notNull())
    .addColumn('student_id', 'integer', (col) =>
      col.references('users.telegram_id').onDelete('set null')
    )
    .addColumn('editor_id', 'integer', (col) =>
      col.references('users.telegram_id').onDelete('set null')
    )
    .addColumn('student_comment', 'text')
    .addColumn('editor_comment', 'text')
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) =>
      col.check(sql`status IN ('in_progress', 'on_check', 'approved', 'on_rework')`)
    )
    .addColumn('file_version', 'integer')
    .addColumn('file_extension', 'text')
    .execute();

  await db.schema
    .createTable('user_main_menu_states')
    .ifNotExists()
    .addColumn('telegram_id', 'integer', (col) => col.primaryKey())
    .addColumn('message_id', 'integer', (col) => col.notNull())
    .addColumn('last_updated', 'text', (col) => col.notNull())
    .execute();

  await sql`PRAGMA foreign_keys = ON`.execute(db);

  console.log('Миграции выполнены успешно.');
}
