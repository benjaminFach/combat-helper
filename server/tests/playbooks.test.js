import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, migrate } from '../src/db/connection.js';
import { createRepositories } from '../src/db/repositories/index.js';
import { seedTestParty } from './fixtures/seed.js';

let db;
let repos;
let party;

beforeEach(() => {
  db = migrate(createDb(':memory:'));
  repos = createRepositories(db);
  party = seedTestParty(repos);
});

afterEach(() => {
  db.close();
});

/** Minimal valid playbook payload for constraint tests. */
const barePlaybook = {
  role_name: 'Striker',
  role_text: 'Hit things.',
  default_action: 'Attack the focused target',
};

describe('playbook schema constraints', () => {
  it('creates the three playbook tables', () => {
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'playbook%' OR name = 'character_playbooks'`
      )
      .all()
      .map((r) => r.name)
      .sort();
    expect(tables).toEqual(['character_playbooks', 'playbook_rules', 'playbook_signatures']);
  });

  it('allows only one playbook per character', () => {
    const insert = db.prepare(`
      INSERT INTO character_playbooks (character_id, role_name, role_text, default_action)
      VALUES (@character_id, @role_name, @role_text, @default_action)
    `);
    const c = repos.characters.create({ name: 'Grum', class: 'Barbarian', level: 3, max_hp: 32 });
    insert.run({ character_id: c.id, ...barePlaybook });
    expect(() => insert.run({ character_id: c.id, ...barePlaybook })).toThrow(/UNIQUE/);
  });

  it('caps the decision ladder at 4 rules, enforced by the database', () => {
    const c = repos.characters.create({ name: 'Grum', class: 'Barbarian', level: 3, max_hp: 32 });
    const pb = db
      .prepare(
        `INSERT INTO character_playbooks (character_id, role_name, role_text, default_action)
         VALUES (@character_id, @role_name, @role_text, @default_action)`
      )
      .run({ character_id: c.id, ...barePlaybook });
    const insertRule = db.prepare(`
      INSERT INTO playbook_rules (playbook_id, priority, condition_text, action_text)
      VALUES (?, ?, 'when', 'then')
    `);
    for (let p = 1; p <= 4; p += 1) insertRule.run(pb.lastInsertRowid, p);
    // 5th rule: priority 5 violates the CHECK, reusing 1-4 violates UNIQUE.
    expect(() => insertRule.run(pb.lastInsertRowid, 5)).toThrow(/CHECK/);
    expect(() => insertRule.run(pb.lastInsertRowid, 4)).toThrow(/UNIQUE/);
  });

  it('caps signatures at 3, enforced by the database', () => {
    const c = repos.characters.create({ name: 'Grum', class: 'Barbarian', level: 3, max_hp: 32 });
    const pb = db
      .prepare(
        `INSERT INTO character_playbooks (character_id, role_name, role_text, default_action)
         VALUES (@character_id, @role_name, @role_text, @default_action)`
      )
      .run({ character_id: c.id, ...barePlaybook });
    const insertSig = db.prepare(`
      INSERT INTO playbook_signatures (playbook_id, slot, name, why_text)
      VALUES (?, ?, 'Fireball', 'because')
    `);
    for (let s = 1; s <= 3; s += 1) insertSig.run(pb.lastInsertRowid, s);
    expect(() => insertSig.run(pb.lastInsertRowid, 4)).toThrow(/CHECK/);
    expect(() => insertSig.run(pb.lastInsertRowid, 3)).toThrow(/UNIQUE/);
  });

  it('cascades: deleting a character removes playbook, rules, and signatures', () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM playbook_rules').get().n;
    expect(before).toBeGreaterThan(0);
    repos.characters.remove(party.uppy.character.id);
    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM character_playbooks WHERE character_id = ?')
        .get(party.uppy.character.id).n
    ).toBe(0);
    const orphanRules = db
      .prepare(
        `SELECT COUNT(*) AS n FROM playbook_rules r
         LEFT JOIN character_playbooks p ON p.id = r.playbook_id
         WHERE p.id IS NULL`
      )
      .get().n;
    expect(orphanRules).toBe(0);
  });
});

describe('playbooks repository', () => {
  it('upserts and reads back an assembled playbook, rules by priority, signatures by slot', () => {
    const c = repos.characters.create({ name: 'Grum', class: 'Barbarian', level: 3, max_hp: 32 });
    repos.playbooks.upsertForCharacter(c.id, {
      role_name: 'Wall',
      role_text: 'Stand in front.',
      default_action: 'Reckless Attack the focused target',
      default_bonus: 'Rage if not raging',
      default_move: 'Stay between enemies and the casters',
      rules: [
        { priority: 2, condition_text: 'Ally down', action_text: 'Stand over them' },
        { priority: 1, condition_text: 'Fight starts', action_text: 'Rage' },
      ],
      signatures: [
        { slot: 2, name: 'Reckless Attack', why_text: 'Advantage every turn' },
        { slot: 1, name: 'Rage', why_text: 'Halves the damage you take' },
      ],
    });

    const pb = repos.playbooks.getByCharacterId(c.id);
    expect(pb.role_name).toBe('Wall');
    expect(pb.default_bonus).toBe('Rage if not raging');
    expect(pb.rules.map((r) => r.condition_text)).toEqual(['Fight starts', 'Ally down']);
    expect(pb.signatures.map((s) => s.name)).toEqual(['Rage', 'Reckless Attack']);
  });

  it('upsert replaces existing content instead of accumulating', () => {
    const c = repos.characters.create({ name: 'Grum', class: 'Barbarian', level: 3, max_hp: 32 });
    const payload = {
      ...barePlaybook,
      rules: [{ priority: 1, condition_text: 'a', action_text: 'b' }],
      signatures: [{ slot: 1, name: 'Rage', why_text: 'x' }],
    };
    repos.playbooks.upsertForCharacter(c.id, payload);
    repos.playbooks.upsertForCharacter(c.id, {
      ...payload,
      role_name: 'Revised',
      rules: [{ priority: 1, condition_text: 'new', action_text: 'rule' }],
    });

    const pb = repos.playbooks.getByCharacterId(c.id);
    expect(pb.role_name).toBe('Revised');
    expect(pb.rules).toHaveLength(1);
    expect(pb.rules[0].condition_text).toBe('new');
    expect(pb.signatures).toHaveLength(1);
  });

  it('returns null for a character without a playbook', () => {
    const c = repos.characters.create({ name: 'Grum', class: 'Barbarian', level: 3, max_hp: 32 });
    expect(repos.playbooks.getByCharacterId(c.id)).toBeNull();
  });

  it('rules may name a gating resource via resource_name', () => {
    const pb = repos.playbooks.getByCharacterId(party.uppy.character.id);
    const gated = pb.rules.filter((r) => r.resource_name);
    expect(gated.length).toBeGreaterThan(0);
  });
});

describe('seeded playbooks', () => {
  it('gives every party member a playbook with role and default turn', () => {
    for (const member of ['uppy', 'kit', 'lobos', 'malachai', 'orlin']) {
      const pb = repos.playbooks.getByCharacterId(party[member].character.id);
      expect(pb, `${member} playbook`).not.toBeNull();
      expect(pb.role_name).toBeTruthy();
      expect(pb.role_text).toBeTruthy();
      expect(pb.default_action).toBeTruthy();
    }
  });

  it('respects the brutal-brevity limits: ≤4 rules, 1–3 signatures', () => {
    for (const member of ['uppy', 'kit', 'lobos', 'malachai', 'orlin']) {
      const pb = repos.playbooks.getByCharacterId(party[member].character.id);
      expect(pb.rules.length, `${member} rules`).toBeLessThanOrEqual(4);
      expect(pb.rules.length, `${member} rules`).toBeGreaterThan(0);
      expect(pb.signatures.length, `${member} signatures`).toBeLessThanOrEqual(3);
      expect(pb.signatures.length, `${member} signatures`).toBeGreaterThan(0);
    }
  });

  it('only gates rules on resources the character actually owns', () => {
    const owned = db.prepare(`
      SELECT COUNT(*) AS n
      FROM character_resources cr
      JOIN resource_definitions rd ON rd.id = cr.definition_id
      WHERE cr.character_id = ? AND rd.name = ?
    `);
    for (const member of ['uppy', 'kit', 'lobos', 'malachai', 'orlin']) {
      const pb = repos.playbooks.getByCharacterId(party[member].character.id);
      for (const rule of pb.rules) {
        if (!rule.resource_name) continue;
        expect(
          owned.get(party[member].character.id, rule.resource_name).n,
          `${member}: "${rule.resource_name}" must be an owned resource`
        ).toBe(1);
      }
    }
  });

  it("anchors Uppy's ladder on Twilight Sanctuary", () => {
    const pb = repos.playbooks.getByCharacterId(party.uppy.character.id);
    const sanctuaryRule = pb.rules.find((r) => /sanctuary/i.test(r.action_text));
    expect(sanctuaryRule).toBeTruthy();
    expect(sanctuaryRule.resource_name).toBe('Channel Divinity (Twilight)');
  });
});
