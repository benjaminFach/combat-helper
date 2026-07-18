# Architecture Specification: D&D Local Resource Tracker

## Component Breakdown
1. **SQLite Database (`better-sqlite3`)**
   - Synchronous, blazing fast reads/writes.
   - Single local file (`party.db`) ignored in `.gitignore`.
2. **Node/Express Controller**
   - Extremely thin layer. Maps HTTP requests directly to SQLite queries.
3. **Vue 3 Frontend**
   - Reactive state management. 
   - Uses a flat grid/flex layout with Tailwind CSS to display 5 "Character Cards".
   - Cards dynamically render internal rows based on what resources are linked to the character in the database.

## Data Flow
- User clicks an empty checkbox `[ ]` for a Spell Slot on the UI.
- Vue instantly updates the UI to `[X]` (Optimistic UI update) and fires a `PATCH /api/characters/:id/resources/:res_id` request to the Express server.
- Express executes the `UPDATE` query on SQLite.
- If the server returns an error, Vue rolls back the checkbox state.
