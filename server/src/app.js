import express from 'express';

/**
 * Map repository/database errors to HTTP statuses:
 * - "not found"            -> 404
 * - "Insufficient ..."     -> 409 (valid request, but the resource can't cover it)
 * - everything else        -> 400 (bad input, CHECK/UNIQUE constraint violations)
 */
function errorStatus(err) {
  if (/not found/i.test(err.message)) return 404;
  if (/^Insufficient/.test(err.message)) return 409;
  return 400;
}

/**
 * Build the Express app around a repositories bundle.
 * Tests inject repos backed by ':memory:'; production injects party.db.
 */
export function createApp(repos) {
  const app = express();
  app.use(express.json());

  const withResources = (character) => ({
    ...character,
    resources: repos.characterResources.listForCharacter(character.id),
    playbook: repos.playbooks.getByCharacterId(character.id),
  });

  /** GET /api/characters — every character with nested resources + usage state. */
  app.get('/api/characters', (_req, res) => {
    res.json(repos.characters.list().map(withResources));
  });

  /**
   * PATCH /api/characters/:id — partial update of a character's own state
   * (combat vitals: current_hp, temp_hp, current_hit_dice, ...).
   * Unknown keys are ignored by the repo; CHECK violations surface as 400.
   * Returns the updated character row.
   */
  app.patch('/api/characters/:id', (req, res, next) => {
    const id = Number(req.params.id);
    try {
      if (!repos.characters.getById(id)) throw new Error(`character ${id} not found`);
      res.json(repos.characters.update(id, req.body ?? {}));
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/resources/:id/usage — mutate one resource's usage count.
   * Body: { action: 'spend' | 'restore', amount?: int }  (amount defaults to 1)
   *   or  { action: 'set', value: int }
   *   or  { action: 'set_active', active: bool }  (toggleable features, e.g. Twilight Sanctuary)
   * Returns the updated resource row.
   */
  app.post('/api/resources/:id/usage', (req, res, next) => {
    const id = Number(req.params.id);
    const { action, amount, value, active } = req.body ?? {};
    try {
      let resource;
      if (action === 'spend') {
        resource = repos.characterResources.spend(id, amount ?? 1);
      } else if (action === 'restore') {
        resource = repos.characterResources.restore(id, amount ?? 1);
      } else if (action === 'set') {
        if (!Number.isInteger(value)) {
          throw new Error(`value must be an integer, got ${JSON.stringify(value)}`);
        }
        resource = repos.characterResources.setCurrent(id, value);
      } else if (action === 'set_active') {
        resource = repos.characterResources.setActive(id, active);
      } else {
        throw new Error(`Unknown action: ${JSON.stringify(action)}. Expected 'spend', 'restore', 'set', or 'set_active'.`);
      }
      res.json(resource);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/rests — party-wide reset trigger.
   * Body: { type: 'short_rest' | 'long_rest' }
   * Long rests also refresh short-rest resources; 'manual' resources are never touched.
   * Returns the full refreshed party state so the dashboard can re-render in one round trip.
   */
  app.post('/api/rests', (req, res, next) => {
    const { type } = req.body ?? {};
    try {
      const refreshed = repos.characterResources.applyRestAll(type);
      res.json({
        type,
        refreshed,
        characters: repos.characters.list().map(withResources),
      });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/loot — the whole treasury, holder names joined in. */
  app.get('/api/loot', (_req, res) => {
    res.json(repos.loot.list());
  });

  /**
   * POST /api/loot — add loot. Body: one item or an array of items
   * ({ name, description?, character_id?, value_gp? }). Arrays insert
   * transactionally: one bad row rejects the whole batch.
   * Returns the created row(s) with 201.
   */
  app.post('/api/loot', (req, res, next) => {
    const body = req.body ?? {};
    try {
      const created = Array.isArray(body) ? repos.loot.createMany(body) : repos.loot.create(body);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  /** PATCH /api/loot/:id — partial update (rename, revalue, change holder). */
  app.patch('/api/loot/:id', (req, res, next) => {
    try {
      res.json(repos.loot.update(Number(req.params.id), req.body ?? {}));
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/loot/:id — remove an entry (spent, sold, or lost). */
  app.delete('/api/loot/:id', (req, res, next) => {
    try {
      if (!repos.loot.remove(Number(req.params.id))) {
        throw new Error(`loot ${req.params.id} not found`);
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/loot/:id/sell — sell part or all of a line item, atomically.
   * Body: { quantity: int >= 1, proceeds: { [platinum|gold|electrum|silver|copper]: int >= 0 } }
   * `proceeds` is the WHOLE sale price (not per-unit) and may mix several
   * denominations in one sale. Selling the full quantity removes the row.
   * Overselling is a 409 (Insufficient quantity).
   * Returns { loot: row|null, currency, sold }.
   */
  app.post('/api/loot/:id/sell', (req, res, next) => {
    try {
      res.json(repos.loot.sell(Number(req.params.id), req.body ?? {}));
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/currency — the party purse in all five denominations. */
  app.get('/api/currency', (_req, res) => {
    res.json(repos.currency.get());
  });

  /**
   * PUT /api/currency — absolute set of any subset of denominations
   * (DM corrections, session-zero setup). Returns the full purse.
   */
  app.put('/api/currency', (req, res, next) => {
    try {
      res.json(repos.currency.set(req.body ?? {}));
    } catch (err) {
      next(err);
    }
  });

  // Central error handler — the 4-arg signature is required by Express.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(errorStatus(err)).json({ error: err.message });
  });

  return app;
}
