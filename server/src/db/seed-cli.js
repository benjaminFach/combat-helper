/**
 * Rebuild the local database from scratch and seed the real party.
 * Destructive by design — party.db is a local cache of table state, and
 * `npm run seed` is the way to reset it between campaigns/iterations.
 *
 * PARTY_DB overrides the file name (used by Playwright for an isolated
 * throwaway db, e.g. PARTY_DB=party.e2e.db).
 */
import { existsSync, rmSync } from 'node:fs';
import { createDb, defaultDbPath, migrate } from './connection.js';
import { createRepositories } from './repositories/index.js';
import { seedParty } from './seed.js';

const file = process.env.PARTY_DB ?? defaultDbPath();

for (const suffix of ['', '-wal', '-shm']) {
  const path = `${file}${suffix}`;
  if (existsSync(path)) rmSync(path);
}

const db = migrate(createDb(file));
const repos = createRepositories(db);
seedParty(repos);

const roster = repos.characters
  .list()
  .map((c) => `${c.name} (${repos.characterResources.listForCharacter(c.id).length} resources)`)
  .join(', ');
console.log(`Seeded ${file}: ${roster}.`);
db.close();
