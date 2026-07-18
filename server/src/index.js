import { createDb, migrate } from './db/connection.js';
import { createRepositories } from './db/repositories/index.js';
import { createApp } from './app.js';

const PORT = process.env.PORT ?? 3001;

// PARTY_DB lets e2e runs point at a throwaway file instead of the real ledger.
const db = migrate(createDb(process.env.PARTY_DB ?? 'party.db'));
const app = createApp(createRepositories(db));

app.listen(PORT, () => {
  console.log(`Party tracker API listening on http://localhost:${PORT}`);
});
