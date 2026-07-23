/** Which refresh_on kinds each rest type restores. Long rests include short-rest resources (PHB). */
const REST_REFRESH = {
  short_rest: ['short_rest'],
  long_rest: ['short_rest', 'long_rest'],
};

/** metadata is JSON TEXT and is_active is a 0/1 integer; hydrate both on the way out. */
function hydrate(row) {
  if (!row) return null;
  return { ...row, metadata: JSON.parse(row.metadata || '{}'), is_active: row.is_active === 1 };
}

export function createCharacterResourcesRepo(db) {
  const insert = db.prepare(`
    INSERT INTO character_resources
      (character_id, definition_id, label, max_value, current_value, sort_order, metadata)
    VALUES
      (@character_id, @definition_id, @label, @max_value, @current_value, @sort_order, @metadata)
  `);
  const selectById = db.prepare('SELECT * FROM character_resources WHERE id = ?');
  const selectForCharacter = db.prepare(`
    SELECT cr.*,
           rd.name            AS resource_name,
           rd.category        AS category,
           rd.refresh_on      AS refresh_on,
           rd.description     AS description,
           rd.short_rest_gain AS short_rest_gain
    FROM character_resources cr
    JOIN resource_definitions rd ON rd.id = cr.definition_id
    WHERE cr.character_id = ?
    ORDER BY cr.sort_order, cr.id
  `);
  const setCurrentStmt = db.prepare(
    'UPDATE character_resources SET current_value = @value WHERE id = @id'
  );
  const setActiveStmt = db.prepare(
    'UPDATE character_resources SET is_active = @active WHERE id = @id'
  );
  const setMaxStmt = db.prepare(`
    UPDATE character_resources
    SET max_value = @value,
        current_value = MIN(current_value, @value)
    WHERE id = @id
  `);
  const deleteById = db.prepare('DELETE FROM character_resources WHERE id = ?');

  function getOrThrow(id) {
    const row = selectById.get(id);
    if (!row) throw new Error(`character_resource ${id} not found`);
    return row;
  }

  function assertPositiveInteger(amount) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`amount must be a positive integer, got ${amount}`);
    }
  }

  const spendTx = db.transaction((id, amount) => {
    const row = getOrThrow(id);
    if (row.current_value < amount) {
      throw new Error(
        `Insufficient resource ${id}: have ${row.current_value}, tried to spend ${amount}`
      );
    }
    setCurrentStmt.run({ id, value: row.current_value - amount });
    return hydrate(selectById.get(id));
  });

  const restoreTx = db.transaction((id, amount) => {
    const row = getOrThrow(id);
    const value = Math.min(row.max_value, row.current_value + amount); // clamp, never overfill
    setCurrentStmt.run({ id, value });
    return hydrate(selectById.get(id));
  });

  /**
   * Partial recovery on short rests: long-rest resources with short_rest_gain > 0
   * (e.g. Tempest Channel Divinity regains 1 use) tick up by that amount, clamped
   * at max. Long rests already refill these fully, so this only runs for short rests.
   */
  const partialShortRestSql = (scoped) => `
    UPDATE character_resources
    SET current_value = MIN(max_value, current_value + (
      SELECT short_rest_gain FROM resource_definitions WHERE id = definition_id
    ))
    WHERE current_value < max_value
      ${scoped ? 'AND character_id = ?' : ''}
      AND definition_id IN (
        SELECT id FROM resource_definitions
        WHERE short_rest_gain > 0 AND refresh_on = 'long_rest'
      )
  `;

  const applyRestTx = db.transaction((characterId, restType) => {
    const kinds = REST_REFRESH[restType];
    if (!kinds) throw new Error(`Unknown rest type: ${restType}`);
    const placeholders = kinds.map(() => '?').join(', ');
    db.prepare(`
      UPDATE character_resources
      SET current_value = max_value
      WHERE character_id = ?
        AND definition_id IN (
          SELECT id FROM resource_definitions WHERE refresh_on IN (${placeholders})
        )
    `).run(characterId, ...kinds);
    if (restType === 'short_rest') {
      db.prepare(partialShortRestSql(true)).run(characterId);
    }
    if (restType === 'long_rest') {
      // A long rest heals to full and clears temporary hit points (PHB).
      db.prepare('UPDATE characters SET current_hp = max_hp, temp_hp = 0 WHERE id = ?').run(
        characterId
      );
    }
    return selectForCharacter.all(characterId).map(hydrate);
  });

  const applyRestAllTx = db.transaction((restType) => {
    const kinds = REST_REFRESH[restType];
    if (!kinds) throw new Error(`Unknown rest type: ${restType}`);
    const placeholders = kinds.map(() => '?').join(', ');
    const info = db.prepare(`
      UPDATE character_resources
      SET current_value = max_value
      WHERE definition_id IN (
        SELECT id FROM resource_definitions WHERE refresh_on IN (${placeholders})
      )
    `).run(...kinds);
    let partial = 0;
    if (restType === 'short_rest') {
      partial = db.prepare(partialShortRestSql(false)).run().changes;
    }
    if (restType === 'long_rest') {
      // A long rest heals the whole party to full and clears temp HP (PHB).
      db.prepare('UPDATE characters SET current_hp = max_hp, temp_hp = 0').run();
    }
    return info.changes + partial; // number of resource rows refreshed
  });

  return {
    /** Attach a resource to a character. current_value defaults to max_value (fully charged). */
    assign(data) {
      const row = {
        label: null,
        sort_order: 0,
        current_value: data.max_value,
        ...data,
        metadata: JSON.stringify(data.metadata ?? {}),
      };
      const info = insert.run(row);
      return hydrate(selectById.get(info.lastInsertRowid));
    },

    getById(id) {
      return hydrate(selectById.get(id));
    },

    /** All resources for a character, joined with their definitions. */
    listForCharacter(characterId) {
      return selectForCharacter.all(characterId).map(hydrate);
    },

    /** Absolute set — CHECK constraint rejects values outside [0, max_value]. */
    setCurrent(id, value) {
      getOrThrow(id);
      setCurrentStmt.run({ id, value });
      return hydrate(selectById.get(id));
    },

    /** Toggle a feature on/off (e.g. Twilight Sanctuary is currently running). */
    setActive(id, active) {
      if (typeof active !== 'boolean') {
        throw new Error(`active must be a boolean, got ${JSON.stringify(active)}`);
      }
      getOrThrow(id);
      setActiveStmt.run({ id, active: active ? 1 : 0 });
      return hydrate(selectById.get(id));
    },

    /** Change capacity; current_value is clamped down if it would exceed the new max. */
    setMax(id, value) {
      getOrThrow(id);
      setMaxStmt.run({ id, value });
      return hydrate(selectById.get(id));
    },

    /** Deduct usage (e.g. cast a spell, spend Lay on Hands HP). Throws if insufficient. */
    spend(id, amount = 1) {
      assertPositiveInteger(amount);
      return spendTx(id, amount);
    },

    /** Regain usage, clamped at max_value. */
    restore(id, amount = 1) {
      assertPositiveInteger(amount);
      return restoreTx(id, amount);
    },

    /** Refill everything the given rest type refreshes for one character. */
    applyRest(characterId, restType) {
      return applyRestTx(characterId, restType);
    },

    /** Party-wide rest: refill matching resources for every character. */
    applyRestAll(restType) {
      return applyRestAllTx(restType);
    },

    remove(id) {
      return deleteById.run(id).changes > 0;
    },
  };
}
