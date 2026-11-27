import type { Transaction, Insertable, Updateable, Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { CheckpointsTable, DatabaseSchema } from '../../types/database.js';

type InsertableCheckpoint = Omit<Insertable<CheckpointsTable>, 'checkpointId'>;
type UpdateableCheckpoint = Omit<Updateable<CheckpointsTable>, 'checkpointId'>;
type SelectableCheckpoint = Selectable<CheckpointsTable>;

/**
 * Репозиторий промежуточных дедлайнов (`checkpoints`).
 */
export class CheckpointRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): CheckpointRepository {
    return new CheckpointRepository(trx);
  }

  /**
   * Возвращает все промежуточные дедлайны, отсортированные по возрастанию даты.
   */
  async findAllSorted(): Promise<SelectableCheckpoint[]> {
    return this.db
      .selectFrom('checkpoints')
      .selectAll()
      .orderBy('deadlineAt', 'asc')
      .execute();
  }

  async findById(checkpointId: number): Promise<SelectableCheckpoint | null> {
    return (
      (await this.db
        .selectFrom('checkpoints')
        .selectAll()
        .where('checkpointId', '=', checkpointId)
        .executeTakeFirst()) ?? null
    );
  }

  async insert(data: InsertableCheckpoint): Promise<void> {
    await this.db
      .insertInto('checkpoints')
      .values(data)
      .execute();
  }

  async update(checkpointId: number, patch: UpdateableCheckpoint): Promise<void> {
    await this.db
      .updateTable('checkpoints')
      .set(patch)
      .where('checkpointId', '=', checkpointId)
      .execute();
  }

  async remove(checkpointId: number): Promise<void> {
    await this.db
      .deleteFrom('checkpoints')
      .where('checkpointId', '=', checkpointId)
      .execute();
  }
}

export const checkpointRepository = new CheckpointRepository();

