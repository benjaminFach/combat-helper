# Party Tracker — D&D Combat Helper

A local-only, single-screen dashboard for tracking your D&D party's resources during combat: spell slots, Lay on Hands pools, infusions, healing potions, hit points, and anything else that gets spent and restored at the table.

Everything runs on `localhost` against a local SQLite file. No accounts, no cloud, no network required.

## Tech Stack

- **Frontend:** Vue 3 (Composition API, `<script setup>`), Vite, Tailwind CSS
- **Backend:** Node.js, Express (thin controller layer over the database)
- **Database:** [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — a single local `party.db` file
- **Testing:** Vitest (unit/component), Supertest (API), Playwright (end-to-end)

## Project Structure

```
├── client/          # Vue 3 frontend (Vite + Tailwind)
│   ├── src/
│   │   └── components/   # CharacterCard, CombatHudCard, ResourceRow, ManagementPanel
│   └── tests/
├── server/          # Express API + SQLite
│   ├── src/
│   │   ├── app.js        # Express app and routes
│   │   └── db/           # Connection, schema, seed, repositories
│   └── tests/
├── e2e/             # Playwright end-to-end specs
└── package.json     # npm workspaces root with concurrent startup scripts
```

## Getting Started

Requires Node.js 18+.

```bash
# Install dependencies for all workspaces
npm install

# Seed the database with a sample party
npm run seed

# Start the API server (port 3001) and Vite dev server (port 5173) together
npm run dev
```

Then open http://localhost:5173. The Vite dev server proxies `/api` requests to the Express server, so no CORS configuration is needed.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run server and client concurrently |
| `npm run seed` | Seed `party.db` with sample characters and resources |
| `npm test` | Run server and client Vitest suites |
| `npm run test:e2e` | Run Playwright end-to-end tests |

## API Overview

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/characters` | Fetch the party with their linked resources |
| `PATCH` | `/api/characters/:id` | Update a character (e.g. hit points) |
| `POST` | `/api/resources/:id/usage` | Spend or restore a resource use |
| `POST` | `/api/rests` | Apply a short or long rest to the party |

The UI updates optimistically: a click marks the resource spent immediately, fires the request, and rolls back if the server reports an error.

## Development Notes

- **Strict TDD:** data-access and API layers are developed test-first against an in-memory SQLite database (`:memory:`).
- **Single-screen constraint:** the dashboard is designed to fit five characters on a 1080p display with no routing or pagination.
- **Local-only:** the database lives at `server/party.db` and is ignored by git; delete it and re-run `npm run seed` to reset.
