export function createPlaybooksRepo(db) {
  const selectByCharacter = db.prepare(
    'SELECT * FROM character_playbooks WHERE character_id = ?'
  );
  const deleteByCharacter = db.prepare(
    'DELETE FROM character_playbooks WHERE character_id = ?'
  );
  const insertPlaybook = db.prepare(`
    INSERT INTO character_playbooks
      (character_id, role_name, role_text, default_action, default_bonus, default_move)
    VALUES
      (@character_id, @role_name, @role_text, @default_action, @default_bonus, @default_move)
  `);
  const insertRule = db.prepare(`
    INSERT INTO playbook_rules (playbook_id, priority, condition_text, action_text, resource_name)
    VALUES (@playbook_id, @priority, @condition_text, @action_text, @resource_name)
  `);
  const insertSignature = db.prepare(`
    INSERT INTO playbook_signatures (playbook_id, slot, name, why_text)
    VALUES (@playbook_id, @slot, @name, @why_text)
  `);
  const selectRules = db.prepare(
    'SELECT * FROM playbook_rules WHERE playbook_id = ? ORDER BY priority'
  );
  const selectSignatures = db.prepare(
    'SELECT * FROM playbook_signatures WHERE playbook_id = ? ORDER BY slot'
  );

  // Curated content is small and hand-authored, so upsert is a transactional
  // full replace: cascade-delete the old playbook, insert the new one whole.
  const upsert = db.transaction((characterId, data) => {
    deleteByCharacter.run(characterId);
    const info = insertPlaybook.run({
      character_id: characterId,
      role_name: data.role_name,
      role_text: data.role_text,
      default_action: data.default_action,
      default_bonus: data.default_bonus ?? '',
      default_move: data.default_move ?? '',
    });
    const playbookId = info.lastInsertRowid;
    for (const rule of data.rules ?? []) {
      insertRule.run({ playbook_id: playbookId, resource_name: null, ...rule });
    }
    for (const sig of data.signatures ?? []) {
      insertSignature.run({ playbook_id: playbookId, ...sig });
    }
    return playbookId;
  });

  return {
    upsertForCharacter(characterId, data) {
      upsert(characterId, data);
      return this.getByCharacterId(characterId);
    },

    getByCharacterId(characterId) {
      const playbook = selectByCharacter.get(characterId);
      if (!playbook) return null;
      return {
        ...playbook,
        rules: selectRules.all(playbook.id),
        signatures: selectSignatures.all(playbook.id),
      };
    },
  };
}
