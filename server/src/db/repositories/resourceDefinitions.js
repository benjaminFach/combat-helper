const UPDATABLE = ['name', 'category', 'refresh_on', 'description', 'short_rest_gain'];

export function createResourceDefinitionsRepo(db) {
  const insert = db.prepare(`
    INSERT INTO resource_definitions (name, category, refresh_on, description, short_rest_gain)
    VALUES (@name, @category, @refresh_on, @description, @short_rest_gain)
  `);
  const selectById = db.prepare('SELECT * FROM resource_definitions WHERE id = ?');
  const selectByName = db.prepare('SELECT * FROM resource_definitions WHERE name = ?');
  const selectAll = db.prepare('SELECT * FROM resource_definitions ORDER BY name COLLATE NOCASE');
  const deleteById = db.prepare('DELETE FROM resource_definitions WHERE id = ?');

  return {
    create(data) {
      const row = { category: 'other', refresh_on: 'long_rest', description: '', short_rest_gain: 0, ...data };
      const info = insert.run(row);
      return selectById.get(info.lastInsertRowid);
    },

    getById(id) {
      return selectById.get(id) ?? null;
    },

    getByName(name) {
      return selectByName.get(name) ?? null;
    },

    list() {
      return selectAll.all();
    },

    update(id, patch) {
      const keys = Object.keys(patch).filter((k) => UPDATABLE.includes(k));
      if (keys.length === 0) return selectById.get(id) ?? null;
      const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
      const info = db
        .prepare(`UPDATE resource_definitions SET ${setClause} WHERE id = @id`)
        .run({ ...patch, id });
      return info.changes > 0 ? selectById.get(id) : null;
    },

    remove(id) {
      return deleteById.run(id).changes > 0;
    },
  };
}
