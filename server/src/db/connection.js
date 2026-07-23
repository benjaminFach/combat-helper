import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { SCHEMA } from './schema.js';

/**
 * Default location for the local db file — deliberately outside the repo
 * directory. Dev environments where the repo itself lives on a 9p/drvfs bind
 * mount (e.g. WSL2's bridge to a Windows drive) make WAL mode catastrophically
 * slow: every write transaction needs mmap'd shared-memory locking, and each
 * lock/unlock round-trips through the 9p protocol to the host, turning a
 * single-row UPDATE into a multi-second (sometimes 20s+) stall. A path under
 * the user's home directory sits on the native filesystem instead. Still a
 * single local file per the Zero-Cloud directive — just not inside the repo.
 */
export function defaultDbPath(filename = 'party.db') {
  return join(homedir(), '.local', 'share', 'combat-helper', filename);
}

/**
 * Create a SQLite connection. Pass ':memory:' in tests; defaults to a local
 * party.db file (see defaultDbPath) for the running app. Creates the parent
 * directory first since better-sqlite3 won't.
 */
export function createDb(filename = defaultDbPath()) {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  db.pragma('journal_mode = WAL'); // no-op for :memory:, faster for the file db
  db.pragma('synchronous = NORMAL'); // safe with WAL: fsyncs at checkpoints, not every commit
  db.pragma('foreign_keys = ON');  // OFF by default in SQLite; required for CASCADE
  return db;
}

/** Apply the schema. Idempotent — safe to call on every startup. */
export function migrate(db) {
  db.exec(SCHEMA);
  return db;
}
