import Database from 'better-sqlite3';
import { SCHEMA } from './schema.js';

/**
 * Create a SQLite connection. Pass ':memory:' in tests; defaults to the
 * local party.db file for the running app.
 */
export function createDb(filename = 'party.db') {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL'); // no-op for :memory:, faster for the file db
  db.pragma('foreign_keys = ON');  // OFF by default in SQLite; required for CASCADE
  return db;
}

/** Apply the schema. Idempotent — safe to call on every startup. */
export function migrate(db) {
  db.exec(SCHEMA);
  return db;
}
