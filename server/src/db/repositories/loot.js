import { DENOMINATIONS } from './currency.js';

const UPDATABLE = ['name', 'description', 'character_id', 'value_gp', 'quantity'];

/**
 * Party treasury: loot and currency entries, each optionally held by one
 * character (character_id NULL = held by the party at large). Deleting a
 * character returns their loot to the party pool (ON DELETE SET NULL) rather
 * than destroying it.
 *
 * value_gp is the UNIT price; a line's total worth is value_gp * quantity.
 * Selling is transactional: quantity (or the whole row) leaves the table and
 * the sale proceeds land in party_currency in the same commit.
 */

/**
 * Validate the writable fields present in `data`. The schema CHECKs repeat
 * these rules, but SQLite would happily store 2.5 in an INTEGER column, so
 * integers must be enforced here; explicit messages beat constraint errors.
 */
function assertValidFields(data, { requireAll = false } = {}) {
  const has = (k) => requireAll || data[k] !== undefined;
  if (has('name') && (typeof data.name !== 'string' || data.name.trim() === '')) {
    throw new Error('name must be a non-blank string');
  }
  if (has('description') && (typeof data.description !== 'string' || data.description.trim() === '')) {
    throw new Error('description must be a non-blank string');
  }
  if (has('value_gp') && data.value_gp !== undefined && (!Number.isInteger(data.value_gp) || data.value_gp < 0)) {
    throw new Error(`value_gp must be a non-negative integer, got ${JSON.stringify(data.value_gp)}`);
  }
  if (has('quantity') && data.quantity !== undefined && (!Number.isInteger(data.quantity) || data.quantity < 1)) {
    throw new Error(`quantity must be a positive integer, got ${JSON.stringify(data.quantity)}`);
  }
  if (
    data.character_id !== undefined &&
    data.character_id !== null &&
    !Number.isInteger(data.character_id)
  ) {
    throw new Error(`character_id must be an integer or null, got ${JSON.stringify(data.character_id)}`);
  }
}

export function createLootRepo(db) {
  const insert = db.prepare(`
    INSERT INTO loot (name, description, character_id, value_gp, quantity)
    VALUES (@name, @description, @character_id, @value_gp, @quantity)
  `);
  // character_name is joined in so the client never needs a second lookup.
  const selectById = db.prepare(`
    SELECT l.*, c.name AS character_name
    FROM loot l
    LEFT JOIN characters c ON c.id = l.character_id
    WHERE l.id = ?
  `);
  const selectAll = db.prepare(`
    SELECT l.*, c.name AS character_name
    FROM loot l
    LEFT JOIN characters c ON c.id = l.character_id
    ORDER BY l.name COLLATE NOCASE, l.id
  `);
  const deleteById = db.prepare('DELETE FROM loot WHERE id = ?');
  const setQuantity = db.prepare('UPDATE loot SET quantity = @quantity WHERE id = @id');
  const selectCurrency = db.prepare('SELECT * FROM party_currency WHERE id = 1');

  function insertOne(data) {
    assertValidFields(data, { requireAll: true });
    const row = { character_id: null, value_gp: 0, quantity: 1, ...data };
    const info = insert.run(row);
    return selectById.get(info.lastInsertRowid);
  }

  // All-or-nothing bulk insert: one bad row rolls the whole batch back.
  const createManyTx = db.transaction((items) => items.map(insertOne));

  /**
   * Sell part or all of a line item and bank the proceeds atomically.
   * `proceeds` maps denominations to whole coin amounts for the WHOLE sale
   * (never multiplied by quantity) — a single sale can pay out in several
   * coins at once, e.g. { gold: 1, silver: 5, copper: 20 }. Selling the full
   * quantity deletes the row.
   * Returns { loot: row|null, currency, sold: { quantity, proceeds } }.
   */
  const sellTx = db.transaction((id, { quantity, proceeds }) => {
    const row = selectById.get(id);
    if (!row) throw new Error(`loot ${id} not found`);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error(`quantity must be a positive integer, got ${JSON.stringify(quantity)}`);
    }
    if (quantity > row.quantity) {
      throw new Error(
        `Insufficient quantity of ${row.name}: have ${row.quantity}, tried to sell ${quantity}`
      );
    }
    if (proceeds === null || typeof proceeds !== 'object' || Array.isArray(proceeds)) {
      throw new Error(`proceeds must be an object of denomination amounts, got ${JSON.stringify(proceeds)}`);
    }
    for (const [denomination, amount] of Object.entries(proceeds)) {
      if (!DENOMINATIONS.includes(denomination)) {
        throw new Error(
          `Unknown denomination: ${JSON.stringify(denomination)}. Expected one of ${DENOMINATIONS.join(', ')}.`
        );
      }
      if (!Number.isInteger(amount) || amount < 0) {
        throw new Error(`${denomination} must be a non-negative integer, got ${JSON.stringify(amount)}`);
      }
    }

    if (quantity === row.quantity) {
      deleteById.run(id);
    } else {
      setQuantity.run({ id, quantity: row.quantity - quantity });
    }
    const paid = Object.entries(proceeds).filter(([, amount]) => amount > 0);
    if (paid.length > 0) {
      const setClause = paid.map(([d]) => `${d} = ${d} + @${d}`).join(', ');
      db.prepare(`UPDATE party_currency SET ${setClause} WHERE id = 1`).run(
        Object.fromEntries(paid)
      );
    }

    const { id: _one, ...currency } = selectCurrency.get();
    return {
      loot: selectById.get(id) ?? null,
      currency,
      sold: { quantity, proceeds },
    };
  });

  return {
    create(data) {
      return insertOne(data);
    },

    /** Insert a batch transactionally. Returns the created rows in order. */
    createMany(items) {
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('createMany expects a non-empty array of loot items');
      }
      return createManyTx(items);
    },

    getById(id) {
      return selectById.get(id) ?? null;
    },

    list() {
      return selectAll.all();
    },

    /** Partial update. Unknown keys are ignored (never interpolated into SQL). */
    update(id, patch) {
      if (!selectById.get(id)) throw new Error(`loot ${id} not found`);
      assertValidFields(patch);
      const keys = Object.keys(patch).filter((k) => UPDATABLE.includes(k));
      if (keys.length === 0) return selectById.get(id);
      const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE loot SET ${setClause} WHERE id = @id`).run({ ...patch, id });
      return selectById.get(id);
    },

    sell(id, sale) {
      return sellTx(id, sale ?? {});
    },

    remove(id) {
      return deleteById.run(id).changes > 0;
    },
  };
}
