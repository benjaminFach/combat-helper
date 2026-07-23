import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * E2E runs against a fully isolated stack on its own ports (3101/5273) and a
 * throwaway database (re-seeded on every run) — it never touches the real
 * party.db or collides with `npm run dev` on 3001/5173.
 *
 * The throwaway db lives under the OS temp dir rather than in the repo: this
 * repo often sits on a 9p/drvfs bind mount, where SQLite's WAL-mode locking
 * is drastically slower than on a native filesystem (see connection.js's
 * defaultDbPath doc comment) — same fix applied here so e2e writes aren't
 * paying that tax either.
 */
const E2E_DB = join(tmpdir(), 'combat-helper-e2e', 'party.e2e.db');
const SERVER_PORT = 3101;
const CLIENT_PORT = 5273;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false, // tests share one seeded db; keep them sequential
  workers: 1, // ...including across spec files — several of them mutate the same rows
  // This repo often runs on a 9p/drvfs mount where Vite's cold transforms can
  // stall for tens of seconds; give tests headroom and absorb one-off stalls.
  timeout: 60_000,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run seed --workspace server && npm run dev --workspace server',
      url: `http://localhost:${SERVER_PORT}/api/characters`,
      env: { PARTY_DB: E2E_DB, PORT: String(SERVER_PORT) },
      reuseExistingServer: false,
      timeout: 120_000, // 9p/drvfs mounts cold-start node slowly; 30s flakes
    },
    {
      command: `npm run dev --workspace client -- --port ${CLIENT_PORT} --strictPort`,
      url: `http://localhost:${CLIENT_PORT}`,
      env: { API_PORT: String(SERVER_PORT) },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
