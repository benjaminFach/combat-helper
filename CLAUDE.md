# System Instructions & Project Constraints

## Core Identity
Expert full-stack engineering. Clean, maintainable, modular code. Strict TDD.

## Technology Stack
- **Frontend:** Vue 3 (Composition API, `<script setup>`), Vite, Tailwind CSS.
- **Backend:** Node.js, Express.
- **Database:** `better-sqlite3` (strictly local `party.db` file). By default this
  file lives under the user's home directory (`defaultDbPath()` in
  `server/src/db/connection.js`), not inside the repo — WAL mode's per-write
  locking is catastrophically slow on 9p/drvfs bind mounts (e.g. a repo
  checked out under WSL2's bridge to a Windows drive), so the db intentionally
  lives outside the repo tree. `PARTY_DB` overrides the path (used by e2e runs).
- **Testing:** Vitest (frontend components and backend logic).

## Architectural Directives
1. **Zero-Cloud / Local-Only:** localhost only. No auth, CORS constraints, or external API calls.
2. **Single-Screen UI:** Single-page dashboard fitting 5 complex characters on 1080p. No deep routing/pagination.
3. **Monorepo Structure:** `/client` (Vue), `/server` (Express + SQLite), root `package.json` with concurrent startup scripts.

## Development Methodology (Strict TDD)
- Vitest suites against an in-memory database (`:memory:`) before finalizing data access methods.
- Seed tests with complex, real-world D&D mechanics (e.g., Level 10 Artificer with mixed spell slots and infusions; Paladin with a large Lay on Hands pool).
- Step-by-step: complete and get approval for each layer (Schema -> API -> UI) before the next.
