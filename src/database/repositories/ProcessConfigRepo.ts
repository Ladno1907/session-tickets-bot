import type { Transaction, Insertable, Updateable, Selectable } from 'kysely';
import { BaseRepository, type DbOrTrx } from './BaseRepository.js';
import type { ProcessConfigTable, DatabaseSchema } from '../../types/database.js';
import { ProcessStage } from '../../types/entities.js';

type InsertableConfig = Insertable<ProcessConfigTable>;
type UpdateableConfig = Updateable<ProcessConfigTable>;
type SelectableConfig = Selectable<ProcessConfigTable>;

/**
 * Репозиторий глобальной конфигурации этапов и дедлайнов (`process_config`).
 */
export class ProcessConfigRepository extends BaseRepository {
  constructor(db?: DbOrTrx) {
    super(db);
  }

  withTransaction(trx: Transaction<DatabaseSchema>): ProcessConfigRepository {
    return new ProcessConfigRepository(trx);
  }

  // =========================================================================
  // ЧТЕНИЕ ДАННЫХ (SELECT)
  // =========================================================================

  /**
   * Получить глобальную конфигурацию процесса (`id = 'global'`).
   */
  async findGlobalConfig(): Promise<SelectableConfig | null> {
    return (
      (await this.db
        .selectFrom('process_config')
        .selectAll()
        .where('id', '=', 'global')
        .executeTakeFirst()) ?? null
    );
  }

  // =========================================================================
  // ЗАПИСЬ И ОБНОВЛЕНИЕ (INSERT / UPDATE)
  // =========================================================================

  /**
   * Инициализировать конфигурацию по умолчанию (стадия `PREPARATION`), если она отсутствует.
   */
  async insertDefaultIfNotExists(): Promise<SelectableConfig> {
    let existingConfig = await this.findGlobalConfig();
    if (!existingConfig) {
      console.log('ProcessConfigRepository: Конфигурация не найдена, вставляем дефолтную.');
      const defaultConfig: InsertableConfig = {
        id: 'global',
        currentStage: ProcessStage.PREPARATION,
        registrationEnd: undefined,
        distributionEnd: undefined,
        ticketingEnd: undefined,
      };
      await this.insert(defaultConfig);
      existingConfig = await this.findGlobalConfig();
      if (!existingConfig) {
        throw new Error('ProcessConfigRepository: Не удалось получить только что вставленную конфигурацию.');
      }
    } else {
      console.log('ProcessConfigRepository: Дефолтная конфигурация уже существует.');
    }
    return existingConfig;
  }

  /**
   * Вставить запись конфигурации процесса.
   */
  async insert(data: InsertableConfig): Promise<void> {
    await this.db
      .insertInto('process_config')
      .values(data)
      .execute();
  }

  /**
   * Обновить поля глобальной конфигурации (текущую стадию или дедлайны).
   */
  async update(patch: UpdateableConfig): Promise<void> {
    await this.db
      .updateTable('process_config')
      .set(patch)
      .where('id', '=', 'global')
      .execute();
  }

  // =========================================================================
  // УДАЛЕНИЕ (DELETE)
  // =========================================================================

  /**
   * Удалить глобальную конфигурацию процесса.
   */
  async remove(): Promise<void> {
    await this.db
      .deleteFrom('process_config')
      .where('id', '=', 'global')
      .execute();
  }
}

export const processConfigRepository = new ProcessConfigRepository();

