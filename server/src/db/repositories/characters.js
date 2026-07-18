const UPDATABLE = [
  'name',
  'class',
  'subclass',
  'level',
  'max_hp',
  'current_hp',
  'temp_hp',
  'max_hit_dice',
  'current_hit_dice',
  'notes',
];

export function createCharactersRepo(db) {
  const insert = db.prepare(`
    INSERT INTO characters
      (name, class, subclass, level, max_hp, current_hp, temp_hp, max_hit_dice, current_hit_dice, notes)
    VALUES
      (@name, @class, @subclass, @level, @max_hp, @current_hp, @temp_hp, @max_hit_dice, @current_hit_dice, @notes)
  `);
  const selectById = db.prepare('SELECT * FROM characters WHERE id = ?');
  const selectAll = db.prepare('SELECT * FROM characters ORDER BY name COLLATE NOCASE');
  const deleteById = db.prepare('DELETE FROM characters WHERE id = ?');

  return {
    create(data) {
      const row = {
        subclass: null,
        notes: '',
        current_hp: data.max_hp, // new characters start at full HP unless told otherwise
        temp_hp: 0,
        max_hit_dice: data.level, // hit dice pool = character level (PHB)
        ...data,
      };
      row.current_hit_dice ??= row.max_hit_dice; // start with a full pool unless told otherwise
      const info = insert.run(row);
      return selectById.get(info.lastInsertRowid);
    },

    getById(id) {
      return selectById.get(id) ?? null;
    },

    list() {
      return selectAll.all();
    },

    /** Partial update. Unknown keys are ignored (never interpolated into SQL). */
    update(id, patch) {
      const keys = Object.keys(patch).filter((k) => UPDATABLE.includes(k));
      if (keys.length === 0) return selectById.get(id) ?? null;
      const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
      const info = db
        .prepare(`UPDATE characters SET ${setClause} WHERE id = @id`)
        .run({ ...patch, id });
      return info.changes > 0 ? selectById.get(id) : null;
    },

    remove(id) {
      return deleteById.run(id).changes > 0;
    },
  };
}
