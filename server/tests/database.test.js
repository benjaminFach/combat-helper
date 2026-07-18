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

describe('migrations', () => {
  it('creates all three tables', () => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all()
      .map((r) => r.name)
      .sort();
    expect(tables).toEqual(['character_resources', 'characters', 'resource_definitions']);
  });

  it('is idempotent (safe to run twice)', () => {
    expect(() => migrate(db)).not.toThrow();
  });

  it('has foreign key enforcement enabled', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('characters CRUD', () => {
  it('seeds the full party of five', () => {
    const all = repos.characters.list();
    expect(all).toHaveLength(5);
    // NOCASE name order
    expect(all.map((c) => c.name)).toEqual([
      'Kit Sofia',
      'Lobos',
      'Malachai',
      'Orlin',
      'Uppy Beauty',
    ]);
    expect(all.map((c) => c.class)).toEqual([
      'Cleric',
      'Blood Hunter',
      'Monk',
      'Artificer',
      'Cleric',
    ]);
    expect(all.map((c) => c.subclass)).toEqual([
      'Tempest Domain',
      'Order of the Lycan',
      null,
      null,
      'Twilight Domain',
    ]);
    expect(all.every((c) => c.level === 10)).toBe(true);
  });

  it('creates with full-HP default and reads back', () => {
    const c = repos.characters.create({ name: 'Grum', class: 'Barbarian', level: 3, max_hp: 32 });
    expect(c.current_hp).toBe(32);
    expect(repos.characters.getById(c.id)).toEqual(c);
  });

  it('defaults combat vitals: temp_hp 0, hit dice pool = level, fully rested', () => {
    const c = repos.characters.create({ name: 'Grum', class: 'Barbarian', level: 3, max_hp: 32 });
    expect(c.temp_hp).toBe(0);
    expect(c.max_hit_dice).toBe(3);
    expect(c.current_hit_dice).toBe(3);
  });

  it('updates temp_hp and current_hit_dice independently of HP', () => {
    const updated = repos.characters.update(party.lobos.character.id, {
      temp_hp: 8,
      current_hit_dice: 6,
    });
    expect(updated.temp_hp).toBe(8);
    expect(updated.current_hit_dice).toBe(6);
    expect(updated.current_hp).toBe(83); // untouched
  });

  it('applies partial updates and ignores unknown keys', () => {
    const updated = repos.characters.update(party.uppy.character.id, {
      current_hp: 41,
      hacker_field: 'DROP TABLE characters', // must be ignored, not interpolated
    });
    expect(updated.current_hp).toBe(41);
    expect(updated.name).toBe('Uppy Beauty');
  });

  it('rejects out-of-range values via CHECK constraints', () => {
    expect(() =>
      repos.characters.create({ name: 'Bad', class: 'Wizard', level: 21, max_hp: 10 })
    ).toThrow();
    expect(() =>
      repos.characters.update(party.uppy.character.id, { current_hp: 9999 })
    ).toThrow();
    expect(() => repos.characters.update(party.uppy.character.id, { temp_hp: -1 })).toThrow();
    expect(() =>
      repos.characters.update(party.uppy.character.id, { current_hit_dice: 11 }) // max is 10
    ).toThrow();
    expect(() =>
      repos.characters.update(party.uppy.character.id, { current_hit_dice: -1 })
    ).toThrow();
  });

  it('deletes and reports missing rows as null/false', () => {
    expect(repos.characters.remove(party.uppy.character.id)).toBe(true);
    expect(repos.characters.getById(party.uppy.character.id)).toBeNull();
    expect(repos.characters.remove(9999)).toBe(false);
  });
});

describe('resource definitions', () => {
  it('enforces unique names', () => {
    expect(() => repos.resourceDefinitions.create({ name: 'Spell Slot' })).toThrow();
  });

  it('rejects invalid category, refresh_on, and short_rest_gain values', () => {
    expect(() =>
      repos.resourceDefinitions.create({ name: 'Weird', category: 'nonsense' })
    ).toThrow();
    expect(() =>
      repos.resourceDefinitions.create({ name: 'Weird', refresh_on: 'blue_moon' })
    ).toThrow();
    expect(() =>
      repos.resourceDefinitions.create({ name: 'Weird', short_rest_gain: -1 })
    ).toThrow();
  });

  it('looks up by name and stores descriptions', () => {
    const wrath = repos.resourceDefinitions.getByName('Wrath of the Storm');
    expect(wrath.category).toBe('class_feature');
    expect(wrath.description).toBe(
      'Reaction when hit within 5ft; attacker makes DEX save or takes 2d8 Lightning/Thunder damage.'
    );
  });

  it('defaults short_rest_gain to 0 and stores it when given', () => {
    expect(party.definitions.wrathOfTheStorm.short_rest_gain).toBe(0);
    expect(party.definitions.channelDivinityTempest.short_rest_gain).toBe(1);
  });
});

describe('character resources — seeding fidelity', () => {
  it('models level 10 full-caster spell slots as separate labeled rows', () => {
    for (const who of [party.uppy, party.kit]) {
      const slots = repos.characterResources
        .listForCharacter(who.character.id)
        .filter((r) => r.resource_name === 'Spell Slot');
      expect(slots.map((s) => [s.label, s.max_value, s.metadata.slot_level])).toEqual([
        ['Level 1', 4, 1],
        ['Level 2', 3, 2],
        ['Level 3', 3, 3],
        ['Level 4', 3, 4],
        ['Level 5', 2, 5],
      ]);
    }
  });

  it('gives each cleric their own Channel Divinity variant behind a shared display label', () => {
    expect(party.uppy.channelDivinity.label).toBe('Channel Divinity');
    expect(party.kit.channelDivinity.label).toBe('Channel Divinity');
    expect(party.uppy.channelDivinity.definition_id).not.toBe(
      party.kit.channelDivinity.definition_id
    );
    expect(party.uppy.channelDivinity.max_value).toBe(3);
    expect(party.kit.channelDivinity.max_value).toBe(3);
  });

  it('models Vigilant Blessing as an at-will resource (max_value 0)', () => {
    const vb = repos.characterResources.getById(party.uppy.vigilantBlessing.id);
    expect(vb.max_value).toBe(0);
    expect(vb.current_value).toBe(0);
  });

  it('seeds Healing Potions for everyone as a manual consumable counter', () => {
    // The clerics start with 3 in stock; the other three start empty.
    const stock = [
      [party.uppy.potions, 3],
      [party.kit.potions, 3],
      [party.lobos.potions, 0],
      [party.malachai.potions, 0],
      [party.orlin.potions, 0],
    ];
    for (const [potions, expected] of stock) {
      const row = repos.characterResources.getById(potions.id);
      expect(row.current_value).toBe(expected);
      expect(row.max_value).toBe(10);
    }
    const def = repos.resourceDefinitions.getByName('Healing Potions');
    expect(def.category).toBe('consumable');
    expect(def.refresh_on).toBe('manual');
  });

  it("models Lobos's Blood Hunter features as short-rest resources", () => {
    const rows = repos.characterResources.listForCharacter(party.lobos.character.id);
    const byName = (name) => rows.find((r) => r.resource_name === name);

    expect(byName('Blood Maledict').max_value).toBe(2);
    expect(byName('Blood Maledict').refresh_on).toBe('short_rest');
    expect(byName('Hybrid Transformation').max_value).toBe(1);
    expect(byName('Hybrid Transformation').refresh_on).toBe('short_rest');
    expect(byName('Brand of Castigation').max_value).toBe(1);
    expect(byName('Brand of Castigation').refresh_on).toBe('short_rest');
    expect(byName('Shift').max_value).toBe(4);
    expect(byName('Shift').refresh_on).toBe('long_rest');
  });

  it('seeds every level 10 character with a full 10/10 hit dice pool and no temp HP', () => {
    for (const c of repos.characters.list()) {
      expect(c.max_hit_dice).toBe(10);
      expect(c.current_hit_dice).toBe(10);
      expect(c.temp_hp).toBe(0);
    }
  });

  it("models Lobos's Crimson Rite as an at-will manual class feature", () => {
    const rite = repos.characterResources
      .listForCharacter(party.lobos.character.id)
      .find((r) => r.resource_name === 'Crimson Rite');
    expect(rite.max_value).toBe(0); // at-will — the cost is HP, not uses
    expect(rite.category).toBe('class_feature');
    expect(rite.refresh_on).toBe('manual');
  });

  it("models Orlin's Alert feat initiative swap as an at-will reminder", () => {
    const alert = repos.characterResources
      .listForCharacter(party.orlin.character.id)
      .find((r) => r.resource_name === 'Alert - Initiative Swap');
    expect(alert.max_value).toBe(0);
    expect(alert.description).toBe('Swap your initiative with a willing ally.');
    expect(alert.refresh_on).toBe('manual');
  });

  it('seeds every resource with is_active off', () => {
    for (const c of repos.characters.list()) {
      for (const r of repos.characterResources.listForCharacter(c.id)) {
        expect(r.is_active).toBe(false);
      }
    }
  });

  it("models Lobos's magic items as dawn-recharge resources", () => {
    const rows = repos.characterResources.listForCharacter(party.lobos.character.id);
    const sword = rows.find((r) => r.resource_name === 'Bloodshed Greatsword - Invoke Rune');
    const plate = rows.find((r) => r.resource_name === 'Bloodsmelt Plate Armor');
    expect(sword.max_value).toBe(1);
    expect(sword.refresh_on).toBe('dawn');
    expect(plate.max_value).toBe(1);
    expect(plate.refresh_on).toBe('dawn');
  });

  it('shares one Luck Point definition between Malachai and Orlin', () => {
    expect(party.malachai.luckPoint.definition_id).toBe(party.orlin.luckPoint.definition_id);
    expect(party.malachai.luckPoint.max_value).toBe(5);
    expect(party.orlin.luckPoint.max_value).toBe(5);
    const def = repos.resourceDefinitions.getByName('Luck Point');
    expect(def.refresh_on).toBe('long_rest');
  });

  it('joins definition info — description, refresh_on, short_rest_gain — when listing', () => {
    const rows = repos.characterResources.listForCharacter(party.kit.character.id);
    const cd = rows.find((r) => r.label === 'Channel Divinity');
    expect(cd.resource_name).toBe('Channel Divinity (Tempest)');
    expect(cd.refresh_on).toBe('long_rest');
    expect(cd.short_rest_gain).toBe(1);
    expect(cd.description).toBe(
      'Destructive Wrath — Deal maximum damage when you roll Lightning or Thunder damage.'
    );

    const boots = rows.find((r) => r.resource_name === 'Winged Boots');
    expect(boots.refresh_on).toBe('dawn');
    expect(boots.description).toBe('Grant 30 feet of flying speed for 1 hour.');
  });

  it('enforces uniqueness of (character, definition, label)', () => {
    expect(() =>
      repos.characterResources.assign({
        character_id: party.uppy.character.id,
        definition_id: party.definitions.spellSlot.id,
        label: 'Level 1',
        max_value: 4,
      })
    ).toThrow();
  });
});

describe('spend / restore mechanics', () => {
  it('spends and restores a consumable counter (Healing Potions)', () => {
    const id = party.uppy.potions.id;
    expect(repos.characterResources.spend(id, 1).current_value).toBe(2);
    expect(repos.characterResources.restore(id, 2).current_value).toBe(4);
  });

  it('refuses to overspend, leaving state untouched', () => {
    const id = party.kit.wrathOfTheStorm.id; // max 5
    repos.characterResources.spend(id, 4);
    expect(() => repos.characterResources.spend(id, 3)).toThrow(/Insufficient/);
    expect(repos.characterResources.getById(id).current_value).toBe(1);
  });

  it('rejects non-positive and fractional amounts', () => {
    const id = party.uppy.stepsOfNight.id;
    expect(() => repos.characterResources.spend(id, 0)).toThrow(/positive integer/);
    expect(() => repos.characterResources.spend(id, -2)).toThrow(/positive integer/);
    expect(() => repos.characterResources.spend(id, 1.5)).toThrow(/positive integer/);
  });

  it('restore clamps at max_value', () => {
    const id = party.kit.slots[0].id; // Level 1 slots, max 4
    repos.characterResources.spend(id, 1);
    const after = repos.characterResources.restore(id, 10);
    expect(after.current_value).toBe(4);
  });

  it('setCurrent rejects values outside [0, max] via CHECK constraint', () => {
    const id = party.uppy.divineIntervention.id; // max 1
    expect(() => repos.characterResources.setCurrent(id, 5)).toThrow();
    expect(() => repos.characterResources.setCurrent(id, -1)).toThrow();
  });

  it('setMax clamps current_value down when capacity shrinks', () => {
    const shrunk = repos.characterResources.setMax(party.kit.wrathOfTheStorm.id, 2);
    expect(shrunk.max_value).toBe(2);
    expect(shrunk.current_value).toBe(2);
  });
});

describe('active toggles (Twilight Sanctuary and friends)', () => {
  it('flips is_active on and off, hydrated as a boolean', () => {
    const id = party.uppy.channelDivinity.id;
    expect(repos.characterResources.setActive(id, true).is_active).toBe(true);
    expect(repos.characterResources.getById(id).is_active).toBe(true);
    expect(repos.characterResources.setActive(id, false).is_active).toBe(false);
  });

  it('is orthogonal to uses: activating does not spend, spending does not deactivate', () => {
    const id = party.uppy.channelDivinity.id;
    repos.characterResources.setActive(id, true);
    expect(repos.characterResources.getById(id).current_value).toBe(3);
    const spent = repos.characterResources.spend(id, 1);
    expect(spent.is_active).toBe(true);
    expect(spent.current_value).toBe(2);
  });

  it('rejects non-boolean values and unknown resources', () => {
    const id = party.uppy.channelDivinity.id;
    expect(() => repos.characterResources.setActive(id, 1)).toThrow(/boolean/);
    expect(() => repos.characterResources.setActive(id, 'on')).toThrow(/boolean/);
    expect(() => repos.characterResources.setActive(9999, true)).toThrow(/not found/);
  });
});

describe('rests', () => {
  it("short rest regains 1 Channel Divinity use for Kit (short_rest_gain), clamped at max", () => {
    const id = party.kit.channelDivinity.id;
    repos.characterResources.spend(id, 3); // all spent

    repos.characterResources.applyRest(party.kit.character.id, 'short_rest');
    expect(repos.characterResources.getById(id).current_value).toBe(1);

    repos.characterResources.applyRest(party.kit.character.id, 'short_rest');
    repos.characterResources.applyRest(party.kit.character.id, 'short_rest');
    repos.characterResources.applyRest(party.kit.character.id, 'short_rest');
    expect(repos.characterResources.getById(id).current_value).toBe(3); // never above max
  });

  it("short rest does NOT touch Uppy's Channel Divinity (long rest only) or spell slots", () => {
    repos.characterResources.spend(party.uppy.channelDivinity.id, 2);
    repos.characterResources.spend(party.uppy.slots[4].id, 2); // both L5 slots

    repos.characterResources.applyRest(party.uppy.character.id, 'short_rest');

    expect(repos.characterResources.getById(party.uppy.channelDivinity.id).current_value).toBe(1);
    expect(repos.characterResources.getById(party.uppy.slots[4].id).current_value).toBe(0);
  });

  it('long rest restores everything except dawn items and manual consumables', () => {
    repos.characterResources.spend(party.kit.channelDivinity.id, 3);
    repos.characterResources.spend(party.kit.slots[1].id, 3);
    repos.characterResources.spend(party.kit.wingedBoots.id, 2); // dawn: recharges 1d4 at sunrise, by hand
    repos.characterResources.spend(party.kit.potions.id, 1); // manual: potions don't grow back

    repos.characterResources.applyRest(party.kit.character.id, 'long_rest');

    expect(repos.characterResources.getById(party.kit.channelDivinity.id).current_value).toBe(3);
    expect(repos.characterResources.getById(party.kit.slots[1].id).current_value).toBe(3);
    expect(repos.characterResources.getById(party.kit.wingedBoots.id).current_value).toBe(2);
    expect(repos.characterResources.getById(party.kit.potions.id).current_value).toBe(2);
  });

  it("short rest fully refreshes Lobos's Blood Hunter features but not Shift or dawn items", () => {
    repos.characterResources.spend(party.lobos.bloodMaledict.id, 2);
    repos.characterResources.spend(party.lobos.hybridTransformation.id, 1);
    repos.characterResources.spend(party.lobos.shift.id, 2); // long_rest
    repos.characterResources.spend(party.lobos.bloodshedGreatsword.id, 1); // dawn

    repos.characterResources.applyRest(party.lobos.character.id, 'short_rest');

    expect(repos.characterResources.getById(party.lobos.bloodMaledict.id).current_value).toBe(2);
    expect(
      repos.characterResources.getById(party.lobos.hybridTransformation.id).current_value
    ).toBe(1);
    expect(repos.characterResources.getById(party.lobos.shift.id).current_value).toBe(2);
    expect(
      repos.characterResources.getById(party.lobos.bloodshedGreatsword.id).current_value
    ).toBe(0);
  });

  it("long rest refreshes Lobos's short-rest features too, sparing dawn items", () => {
    repos.characterResources.spend(party.lobos.brandOfCastigation.id, 1); // short_rest
    repos.characterResources.spend(party.lobos.shift.id, 4); // long_rest
    repos.characterResources.spend(party.lobos.bloodsmeltPlate.id, 1); // dawn

    repos.characterResources.applyRest(party.lobos.character.id, 'long_rest');

    expect(
      repos.characterResources.getById(party.lobos.brandOfCastigation.id).current_value
    ).toBe(1);
    expect(repos.characterResources.getById(party.lobos.shift.id).current_value).toBe(4);
    expect(repos.characterResources.getById(party.lobos.bloodsmeltPlate.id).current_value).toBe(0);
  });

  it('rests are a no-op for at-will resources (max_value 0)', () => {
    const id = party.uppy.vigilantBlessing.id;
    repos.characterResources.applyRest(party.uppy.character.id, 'long_rest');
    const vb = repos.characterResources.getById(id);
    expect(vb.current_value).toBe(0);
    expect(vb.max_value).toBe(0);
  });

  it("only affects the specified character's resources", () => {
    repos.characterResources.spend(party.uppy.slots[0].id, 2);
    repos.characterResources.spend(party.kit.channelDivinity.id, 1);

    repos.characterResources.applyRest(party.kit.character.id, 'long_rest');

    expect(repos.characterResources.getById(party.uppy.slots[0].id).current_value).toBe(2);
    expect(repos.characterResources.getById(party.kit.channelDivinity.id).current_value).toBe(3);
  });

  it('rejects unknown rest types', () => {
    expect(() =>
      repos.characterResources.applyRest(party.uppy.character.id, 'coffee_break')
    ).toThrow(/Unknown rest type/);
  });
});

describe('referential integrity', () => {
  it('cascades resource deletion when a character is removed', () => {
    repos.characters.remove(party.uppy.character.id);
    expect(repos.characterResources.listForCharacter(party.uppy.character.id)).toEqual([]);
    // Kit untouched
    expect(
      repos.characterResources.listForCharacter(party.kit.character.id).length
    ).toBeGreaterThan(0);
  });

  it('rejects assignments to nonexistent characters or definitions', () => {
    expect(() =>
      repos.characterResources.assign({
        character_id: 9999,
        definition_id: party.definitions.spellSlot.id,
        max_value: 1,
      })
    ).toThrow();
    expect(() =>
      repos.characterResources.assign({
        character_id: party.uppy.character.id,
        definition_id: 9999,
        max_value: 1,
      })
    ).toThrow();
  });
});
