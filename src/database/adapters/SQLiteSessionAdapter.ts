import { StorageAdapter } from 'grammy'; 
import { SessionRepository } from '../repositories/SessionRepo.js';

export class SQLiteSessionAdapter<T> implements StorageAdapter<T> {
  constructor(private sessionRepository: SessionRepository = new SessionRepository()) {}

  async read(key: string): Promise<T | undefined> {
    const telegramId = parseInt(key, 10);
    
    if (isNaN(telegramId)) {
      console.error(`SQLiteSessionAdapter: Invalid key format (not a number): ${key}`);
      return undefined;
    }

    try {
      const result = await this.sessionRepository.findById(telegramId);
      if (result && result.sessionData !== null) {
        return JSON.parse(result.sessionData) as T;
      }
      return undefined;
    } catch (error) {
      console.error(`SQLiteSessionAdapter: Error reading session for key ${key}:`, error);
      return undefined;
    }
  }

  async write(key: string, value: T): Promise<void> {
    const telegramId = parseInt(key, 10);
    if (isNaN(telegramId)) {
      console.error(`SQLiteSessionAdapter: Invalid key format (not a number) for write: ${key}`);
      throw new Error(`Invalid key format: ${key}`);
    }

    try {
      const stringifiedValue = JSON.stringify(value);
      await this.sessionRepository.upsert(telegramId, stringifiedValue);
    } catch (error) {
      console.error(`SQLiteSessionAdapter: Error writing session for key ${key}:`, error);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const telegramId = parseInt(key, 10);
    if (isNaN(telegramId)) {
      console.error(`SQLiteSessionAdapter: Invalid key format (not a number) for delete: ${key}`);
      return;
    }

    try {
      await this.sessionRepository.deleteById(telegramId);
    } catch (error) {
      console.error(`SQLiteSessionAdapter: Error deleting session for key ${key}:`, error);
    }
  }
}

export const sqliteSessionAdapter = new SQLiteSessionAdapter();