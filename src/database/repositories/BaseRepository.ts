import type { Kysely, Transaction } from 'kysely';
import type { DatabaseSchema } from '../../types/database.js';
import { db as defaultDb } from '../client.js';

export type DbOrTrx = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

export abstract class BaseRepository {
  constructor(public db: DbOrTrx = defaultDb) {}

  abstract withTransaction(trx: Transaction<DatabaseSchema>): BaseRepository;
}
