import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createDb, migrate } from '../src/db/connection.js';
import { createRepositories } from '../src/db/repositories/index.js';
import { createApp } from '../src/app.js';
import { seedTestParty } from './fixtures/seed.js';

let db;
let repos;
let party;
let app;

beforeEach(() => {
  db = migrate(createDb(':memory:'));
  repos = createRepositories(db);
  party = seedTestParty(repos);
  app = createApp(repos);
});

afterEach(() => {
  db.close();
});

describe('GET /api/characters', () => {
  it('returns all characters with nested resources and usage state', async () => {
    const res = await request(app).get('/api/characters');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toHaveLength(5);

    const [kit, lobos, malachai, orlin, uppy] = res.body; // NOCASE name order
    expect(kit.name).toBe('Kit Sofia');
    expect(lobos.name).toBe('Lobos');
    expect(malachai.name).toBe('Malachai');
    expect(orlin.name).toBe('Orlin');
    expect(uppy.name).toBe('Uppy Beauty');
    expect(uppy.resources).toHaveLength(15); // 5 slot rows + 9 features + potions
    expect(kit.resources).toHaveLength(12); // 5 slot rows + 6 features + potions
    expect(lobos.resources).toHaveLength(8); // 5 features + 2 dawn items + potions
    expect(malachai.resources).toHaveLength(4); // 3 features + potions
    expect(orlin.resources).toHaveLength(4); // 3 features + potions
  });

  it('serializes combat vitals — temp_hp, hit dice, and resource is_active flags', async () => {
    const res = await request(app).get('/api/characters');
    for (const c of res.body) {
      expect(c.temp_hp).toBe(0);
      expect(c.max_hit_dice).toBe(10); // level 10 party
      expect(c.current_hit_dice).toBe(10);
    }
    const uppy = res.body.find((c) => c.name === 'Uppy Beauty');
    const cd = uppy.resources.find((r) => r.label === 'Channel Divinity');
    expect(cd.is_active).toBe(false); // boolean, not a 0/1 integer
  });

  it('serializes joined definition fields — description, refresh_on, short_rest_gain', async () => {
    const res = await request(app).get('/api/characters');
    const kit = res.body.find((c) => c.name === 'Kit Sofia');
    const uppy = res.body.find((c) => c.name === 'Uppy Beauty');

    const wrath = kit.resources.find((r) => r.resource_name === 'Wrath of the Storm');
    expect(wrath.description).toBe(
      'Reaction when hit within 5ft; attacker makes DEX save or takes 2d8 Lightning/Thunder damage.'
    );
    expect(wrath.refresh_on).toBe('long_rest');
    expect(wrath.short_rest_gain).toBe(0);

    const kitCD = kit.resources.find((r) => r.label === 'Channel Divinity');
    expect(kitCD.description).toBe(
      'Destructive Wrath — Deal maximum damage when you roll Lightning or Thunder damage.'
    );
    expect(kitCD.short_rest_gain).toBe(1);

    const uppyCD = uppy.resources.find((r) => r.label === 'Channel Divinity');
    expect(uppyCD.description).toMatch(/^Choose one: Twilight Sanctuary/);
    expect(uppyCD.short_rest_gain).toBe(0);

    const boots = kit.resources.find((r) => r.resource_name === 'Winged Boots');
    expect(boots.refresh_on).toBe('dawn');
    expect(boots.description).toBe('Grant 30 feet of flying speed for 1 hour.');

    const potions = uppy.resources.find((r) => r.resource_name === 'Healing Potions');
    expect(potions.category).toBe('consumable');
    expect(potions.description).toBe('Drink or administer as a bonus action to regain 2d4 + 2 HP.');

    const lobos = res.body.find((c) => c.name === 'Lobos');
    const maledict = lobos.resources.find((r) => r.resource_name === 'Blood Maledict');
    expect(maledict.refresh_on).toBe('short_rest');
    expect(maledict.description).toMatch(/^Invoke a blood curse/);

    const rune = lobos.resources.find(
      (r) => r.resource_name === 'Bloodshed Greatsword - Invoke Rune'
    );
    expect(rune.refresh_on).toBe('dawn');
    expect(rune.description).toBe(
      'Spend hit dice after rolling an attack to add to the roll, or after rolling damage to add to the weapon damage.'
    );
  });

  it('assigns every character a combat role via their playbook', async () => {
    const res = await request(app).get('/api/characters');
    for (const c of res.body) {
      expect(c.playbook, `${c.name} has no playbook`).toBeTruthy();
      expect(c.playbook.role_name, `${c.name} has no role`).toBeTruthy();
      expect(c.playbook.role_text, `${c.name} has no role description`).toBeTruthy();
    }
  });

  it('covers the party composition with the expected role per character', async () => {
    // Party has one heavy frontliner (Lobos), a mobile striker (Malachai),
    // two clerics split into sustain vs burst, and a reaction-support
    // artificer — the roles must reflect that split, not generic class labels.
    const res = await request(app).get('/api/characters');
    const roles = Object.fromEntries(res.body.map((c) => [c.name, c.playbook.role_name]));
    expect(roles).toEqual({
      'Uppy Beauty': 'Anchor',
      'Kit Sofia': 'Artillery',
      Lobos: 'Front line',
      Malachai: 'Skirmisher',
      Orlin: 'Enabler',
    });
    // Five distinct roles — nobody's job overlaps into someone else's.
    expect(new Set(Object.values(roles)).size).toBe(5);
  });

  it('serializes the full playbook: default turn, ladder ordered by priority, signatures', async () => {
    const res = await request(app).get('/api/characters');
    const uppy = res.body.find((c) => c.name === 'Uppy Beauty');
    expect(uppy.playbook.default_action).toBeTruthy();
    expect(uppy.playbook.rules.map((r) => r.priority)).toEqual([1, 2, 3, 4]);
    expect(uppy.playbook.rules[0].resource_name).toBe('Channel Divinity (Twilight)');
    expect(uppy.playbook.signatures.length).toBeLessThanOrEqual(3);
    expect(uppy.playbook.signatures.length).toBeGreaterThan(0);
  });

  it('serializes full-caster slots with parsed metadata', async () => {
    const res = await request(app).get('/api/characters');
    const uppy = res.body.find((c) => c.name === 'Uppy Beauty');

    const slots = uppy.resources.filter((r) => r.resource_name === 'Spell Slot');
    expect(slots.map((s) => [s.label, s.current_value, s.max_value])).toEqual([
      ['Level 1', 4, 4],
      ['Level 2', 3, 3],
      ['Level 3', 3, 3],
      ['Level 4', 3, 3],
      ['Level 5', 2, 2],
    ]);
    expect(slots[0].refresh_on).toBe('long_rest');
    expect(slots[0].metadata).toEqual({ slot_level: 1 }); // object, not a JSON string
  });

  it('reflects live usage state, not just seeded defaults', async () => {
    repos.characterResources.spend(party.kit.wrathOfTheStorm.id, 2);
    const res = await request(app).get('/api/characters');
    const kit = res.body.find((c) => c.name === 'Kit Sofia');
    const wrath = kit.resources.find((r) => r.resource_name === 'Wrath of the Storm');
    expect(wrath.current_value).toBe(3);
  });
});

describe('POST /api/resources/:id/usage', () => {
  it('increments and decrements a consumable counter (Healing Potions)', async () => {
    const id = party.uppy.potions.id; // seeded at 3
    const dec = await request(app).post(`/api/resources/${id}/usage`).send({ action: 'spend' });
    expect(dec.status).toBe(200);
    expect(dec.body.current_value).toBe(2);

    const inc = await request(app).post(`/api/resources/${id}/usage`).send({ action: 'restore' });
    expect(inc.status).toBe(200);
    expect(inc.body.current_value).toBe(3);
  });

  it('defaults amount to 1', async () => {
    const res = await request(app)
      .post(`/api/resources/${party.uppy.divineIntervention.id}/usage`)
      .send({ action: 'spend' });
    expect(res.status).toBe(200);
    expect(res.body.current_value).toBe(0);
  });

  it('restores with clamping at max_value', async () => {
    const slotId = party.uppy.slots[0].id; // max 4
    await request(app).post(`/api/resources/${slotId}/usage`).send({ action: 'spend', amount: 1 });
    const res = await request(app)
      .post(`/api/resources/${slotId}/usage`)
      .send({ action: 'restore', amount: 10 });
    expect(res.status).toBe(200);
    expect(res.body.current_value).toBe(4);
  });

  it('sets an absolute value', async () => {
    const res = await request(app)
      .post(`/api/resources/${party.kit.wrathOfTheStorm.id}/usage`)
      .send({ action: 'set', value: 2 });
    expect(res.status).toBe(200);
    expect(res.body.current_value).toBe(2);
  });

  it('returns 409 on overspend and leaves state untouched', async () => {
    const id = party.uppy.potions.id; // seeded at 3
    const res = await request(app)
      .post(`/api/resources/${id}/usage`)
      .send({ action: 'spend', amount: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Insufficient/);
    expect(repos.characterResources.getById(id).current_value).toBe(3);
  });

  it('returns 400 for invalid amounts, values, and unknown actions', async () => {
    const id = party.kit.wrathOfTheStorm.id;
    const cases = [
      { action: 'spend', amount: -2 },
      { action: 'spend', amount: 1.5 },
      { action: 'set', value: 'lots' },
      { action: 'set', value: 99 }, // violates CHECK (current <= max)
      { action: 'incinerate' },
    ];
    for (const body of cases) {
      const res = await request(app).post(`/api/resources/${id}/usage`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBeTruthy();
    }
    expect(repos.characterResources.getById(id).current_value).toBe(5); // untouched
  });

  it('returns 404 for a nonexistent resource', async () => {
    const res = await request(app)
      .post('/api/resources/9999/usage')
      .send({ action: 'spend', amount: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/);
  });

  it("toggles a feature's is_active flag (Twilight Sanctuary running)", async () => {
    const id = party.uppy.channelDivinity.id;
    const on = await request(app)
      .post(`/api/resources/${id}/usage`)
      .send({ action: 'set_active', active: true });
    expect(on.status).toBe(200);
    expect(on.body.is_active).toBe(true);

    const off = await request(app)
      .post(`/api/resources/${id}/usage`)
      .send({ action: 'set_active', active: false });
    expect(off.status).toBe(200);
    expect(off.body.is_active).toBe(false);
  });

  it('returns 400 when set_active is given a non-boolean', async () => {
    const res = await request(app)
      .post(`/api/resources/${party.uppy.channelDivinity.id}/usage`)
      .send({ action: 'set_active', active: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/);
  });
});

describe('PATCH /api/characters/:id', () => {
  it('updates HP, temp HP, and hit dice in one call', async () => {
    const res = await request(app)
      .patch(`/api/characters/${party.lobos.character.id}`)
      .send({ current_hp: 30, temp_hp: 8, current_hit_dice: 4 });
    expect(res.status).toBe(200);
    expect(res.body.current_hp).toBe(30);
    expect(res.body.temp_hp).toBe(8);
    expect(res.body.current_hit_dice).toBe(4);
    expect(res.body.name).toBe('Lobos'); // rest of the row untouched
  });

  it('returns 400 when a CHECK constraint rejects the patch, leaving state untouched', async () => {
    const id = party.uppy.character.id;
    for (const patch of [
      { current_hp: 9999 }, // above max_hp
      { current_hp: -1 },
      { temp_hp: -3 },
      { current_hit_dice: 11 }, // above max_hit_dice
    ]) {
      const res = await request(app).patch(`/api/characters/${id}`).send(patch);
      expect(res.status, JSON.stringify(patch)).toBe(400);
      expect(res.body.error).toBeTruthy();
    }
    const uppy = repos.characters.getById(id);
    expect(uppy.current_hp).toBe(63);
    expect(uppy.temp_hp).toBe(0);
    expect(uppy.current_hit_dice).toBe(10);
  });

  it('returns 404 for a nonexistent character', async () => {
    const res = await request(app).patch('/api/characters/9999').send({ current_hp: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/);
  });
});

describe('POST /api/rests', () => {
  it('long rest refreshes rest-bound resources for ALL characters, sparing dawn/manual ones', async () => {
    repos.characterResources.spend(party.uppy.slots[1].id, 3); // long_rest
    repos.characterResources.spend(party.uppy.healingHands.id, 1); // long_rest
    repos.characterResources.spend(party.uppy.potions.id, 2); // manual — must survive
    repos.characterResources.spend(party.kit.channelDivinity.id, 3); // long_rest w/ SR gain
    repos.characterResources.spend(party.kit.wingedBoots.id, 3); // dawn — must survive
    repos.characterResources.spend(party.lobos.bloodMaledict.id, 2); // short_rest — refreshed too
    repos.characterResources.spend(party.lobos.bloodshedGreatsword.id, 1); // dawn — must survive

    const res = await request(app).post('/api/rests').send({ type: 'long_rest' });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('long_rest');

    const uppy = res.body.characters.find((c) => c.name === 'Uppy Beauty');
    const kit = res.body.characters.find((c) => c.name === 'Kit Sofia');
    const lobos = res.body.characters.find((c) => c.name === 'Lobos');
    const find = (c, name) => c.resources.find((r) => r.resource_name === name);

    expect(find(uppy, 'Spell Slot').current_value).toBe(4);
    expect(find(uppy, 'Healing Hands').current_value).toBe(1);
    expect(find(uppy, 'Healing Potions').current_value).toBe(1); // manual: untouched
    expect(find(kit, 'Channel Divinity (Tempest)').current_value).toBe(3);
    expect(find(kit, 'Winged Boots').current_value).toBe(1); // dawn: untouched
    expect(find(lobos, 'Blood Maledict').current_value).toBe(2); // short_rest: refreshed
    expect(find(lobos, 'Bloodshed Greatsword - Invoke Rune').current_value).toBe(0); // dawn: untouched
  });

  it("short rest refreshes Lobos's features and Kit's Channel Divinity, nothing else", async () => {
    repos.characterResources.spend(party.kit.channelDivinity.id, 3);
    repos.characterResources.spend(party.uppy.channelDivinity.id, 2);
    repos.characterResources.spend(party.kit.slots[2].id, 2);
    repos.characterResources.spend(party.lobos.hybridTransformation.id, 1);

    const res = await request(app).post('/api/rests').send({ type: 'short_rest' });
    expect(res.status).toBe(200);
    // Lobos's 3 short_rest rows + Kit's Channel Divinity partial gain
    expect(res.body.refreshed).toBe(4);

    const kit = res.body.characters.find((c) => c.name === 'Kit Sofia');
    const uppy = res.body.characters.find((c) => c.name === 'Uppy Beauty');
    const lobos = res.body.characters.find((c) => c.name === 'Lobos');
    expect(kit.resources.find((r) => r.label === 'Channel Divinity').current_value).toBe(1);
    expect(uppy.resources.find((r) => r.label === 'Channel Divinity').current_value).toBe(1);
    expect(kit.resources.find((r) => r.label === 'Level 3').current_value).toBe(1);
    expect(
      lobos.resources.find((r) => r.resource_name === 'Hybrid Transformation').current_value
    ).toBe(1);
  });

  it('reports how many resource rows were refreshed on a long rest', async () => {
    const res = await request(app).post('/api/rests').send({ type: 'long_rest' });
    // 41 rows total, minus manual (Vigilant Blessing + 5x Healing Potions) and
    // dawn (Winged Boots, Bloodshed Greatsword, Bloodsmelt Plate Armor) = 32
    expect(res.body.refreshed).toBe(32);
  });

  it('returns 400 for unknown rest types', async () => {
    for (const body of [{ type: 'coffee_break' }, {}]) {
      const res = await request(app).post('/api/rests').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Unknown rest type/);
    }
  });
});

describe('GET /api/loot', () => {
  it('returns the seeded treasury with holder names joined', async () => {
    const res = await request(app).get('/api/loot');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toHaveLength(15);

    const bag = res.body.find((l) => l.name === 'Bag of Holding');
    expect(bag).toMatchObject({
      description: 'Holds 500 lbs in an extradimensional space.',
      character_name: 'Orlin',
      value_gp: 4000,
    });

    const pouch = res.body.find((l) => l.name === 'Gold Pouch');
    expect(pouch.character_id).toBeNull();
    expect(pouch.character_name).toBeNull();
  });
});

describe('POST /api/loot', () => {
  it('creates a single item with 201 and defaults applied', async () => {
    const res = await request(app)
      .post('/api/loot')
      .send({ name: 'Suspicious Rock', description: 'It hums.' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Suspicious Rock',
      description: 'It hums.',
      character_id: null,
      character_name: null,
      value_gp: 0,
      quantity: 1,
    });
  });

  it('creates a batch transactionally from an array body', async () => {
    const res = await request(app)
      .post('/api/loot')
      .send([
        { name: 'Ruby', description: 'Deep red.', value_gp: 500, character_id: party.uppy.character.id },
        { name: 'Sapphire', description: 'Sea blue.', value_gp: 300, quantity: 4 },
      ]);
    expect(res.status).toBe(201);
    expect(res.body.map((l) => l.name)).toEqual(['Ruby', 'Sapphire']);
    expect(res.body[0].character_name).toBe('Uppy Beauty');
    expect((await request(app).get('/api/loot')).body).toHaveLength(17);
  });

  it('rejects a batch containing one bad row without inserting any of it', async () => {
    const res = await request(app)
      .post('/api/loot')
      .send([{ name: 'Fine', description: 'ok' }, { name: '  ', description: 'ok' }]);
    expect(res.status).toBe(400);
    expect((await request(app).get('/api/loot')).body).toHaveLength(15);
  });

  it('returns 400 for blank names, negative values, unknown holders, and empty arrays', async () => {
    for (const body of [
      { name: '   ', description: 'ok' },
      { name: 'No Description' },
      { name: 'Blank Description', description: '   ' },
      {},
      { name: 'Debt', description: 'ok', value_gp: -1 },
      { name: 'Debt', description: 'ok', value_gp: 1.5 },
      { name: 'None', description: 'ok', quantity: 0 },
      { name: 'None', description: 'ok', quantity: -2 },
      { name: 'Ghost', description: 'ok', character_id: 9999 },
      [],
    ]) {
      const res = await request(app).post('/api/loot').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBeTruthy();
    }
  });
});

describe('PATCH /api/loot/:id', () => {
  it('revalues and reassigns an item', async () => {
    const pouch = party.loot.find((l) => l.name === 'Gold Pouch');
    const res = await request(app)
      .patch(`/api/loot/${pouch.id}`)
      .send({ value_gp: 999, character_id: party.kit.character.id });
    expect(res.status).toBe(200);
    expect(res.body.value_gp).toBe(999);
    expect(res.body.character_name).toBe('Kit Sofia');
  });

  it('returns 404 for unknown ids and 400 for CHECK violations', async () => {
    expect((await request(app).patch('/api/loot/9999').send({ value_gp: 1 })).status).toBe(404);
    const pouch = party.loot.find((l) => l.name === 'Gold Pouch');
    const bad = await request(app).patch(`/api/loot/${pouch.id}`).send({ value_gp: -10 });
    expect(bad.status).toBe(400);
  });
});

describe('DELETE /api/loot/:id', () => {
  it('removes an item with 204 and 404s on a second attempt', async () => {
    const idol = party.loot.find((l) => l.name === 'Obsidian Idol');
    expect((await request(app).delete(`/api/loot/${idol.id}`)).status).toBe(204);
    expect((await request(app).get('/api/loot')).body).toHaveLength(14);
    expect((await request(app).delete(`/api/loot/${idol.id}`)).status).toBe(404);
  });
});

describe('GET/PUT /api/currency', () => {
  it('returns the seeded purse in all five denominations', async () => {
    const res = await request(app).get('/api/currency');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ platinum: 12, gold: 447, electrum: 0, silver: 210, copper: 89 });
  });

  it('PUT sets a subset absolutely and returns the full purse', async () => {
    const res = await request(app).put('/api/currency').send({ gold: 500, copper: 0 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ platinum: 12, gold: 500, electrum: 0, silver: 210, copper: 0 });
  });

  it('PUT can zero the purse but never lets a denomination go negative', async () => {
    const zeroed = await request(app)
      .put('/api/currency')
      .send({ platinum: 0, gold: 0, electrum: 0, silver: 0, copper: 0 });
    expect(zeroed.status).toBe(200);
    expect(Object.values(zeroed.body).every((v) => v === 0)).toBe(true);

    const negative = await request(app).put('/api/currency').send({ copper: -1 });
    expect(negative.status).toBe(400);
    expect(negative.body.error).toMatch(/copper/);
    // A mixed payload with one negative value is rejected atomically.
    const mixed = await request(app).put('/api/currency').send({ gold: 999, silver: -5 });
    expect(mixed.status).toBe(400);
    expect((await request(app).get('/api/currency')).body).toEqual({
      platinum: 0,
      gold: 0,
      electrum: 0,
      silver: 0,
      copper: 0,
    });
  });

  it('PUT rejects unknown denominations and invalid amounts', async () => {
    for (const body of [{ eternium: 5 }, { gold: -1 }, { gold: 1.5 }, {}]) {
      const res = await request(app).put('/api/currency').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBeTruthy();
    }
    expect((await request(app).get('/api/currency')).body.gold).toBe(447); // untouched
  });
});

describe('POST /api/loot/:id/sell', () => {
  const alchemists = () => party.loot.find((l) => l.name === "Alchemist's Fire");

  it('partial sale: quantity drops, purse grows by the flat proceeds', async () => {
    const res = await request(app)
      .post(`/api/loot/${alchemists().id}/sell`)
      .send({ quantity: 2, proceeds: { gold: 80 } });
    expect(res.status).toBe(200);
    expect(res.body.loot.quantity).toBe(1);
    expect(res.body.currency.gold).toBe(527); // 447 + 80, NOT 447 + 2x80
    expect(res.body.sold).toEqual({ quantity: 2, proceeds: { gold: 80 } });
  });

  it('a single sale can pay out across several denominations', async () => {
    const res = await request(app)
      .post(`/api/loot/${alchemists().id}/sell`)
      .send({ quantity: 2, proceeds: { gold: 1, silver: 5, copper: 20 } });
    expect(res.status).toBe(200);
    expect(res.body.currency).toEqual({
      platinum: 12,
      gold: 448,
      electrum: 0,
      silver: 215,
      copper: 109,
    });
  });

  it('full sale removes the line item and reports loot: null', async () => {
    const res = await request(app)
      .post(`/api/loot/${alchemists().id}/sell`)
      .send({ quantity: 3, proceeds: { platinum: 120 } });
    expect(res.status).toBe(200);
    expect(res.body.loot).toBeNull();
    expect(res.body.currency.platinum).toBe(132);
    expect((await request(app).get('/api/loot')).body).toHaveLength(14);
  });

  it('overselling is a 409 that moves neither goods nor coin', async () => {
    const res = await request(app)
      .post(`/api/loot/${alchemists().id}/sell`)
      .send({ quantity: 5, proceeds: { gold: 500 } });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Insufficient quantity/);
    expect(repos.loot.getById(alchemists().id).quantity).toBe(3);
    expect((await request(app).get('/api/currency')).body.gold).toBe(447);
  });

  it('returns 400 for invalid quantity/proceeds and 404 for unknown loot', async () => {
    const { id } = alchemists();
    for (const body of [
      { quantity: 0, proceeds: { gold: 10 } },
      { quantity: -1, proceeds: { gold: 10 } },
      { quantity: 1, proceeds: { gold: -10 } },
      { quantity: 1, proceeds: { gold: 1.5 } },
      { quantity: 1, proceeds: { eternium: 10 } },
      { quantity: 1, proceeds: { gold: 5, silver: -1 } }, // one bad entry poisons the sale
      { quantity: 1, proceeds: [10] },
      { quantity: 1 },
      {},
    ]) {
      const res = await request(app).post(`/api/loot/${id}/sell`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    // Nothing moved for any of them.
    expect(repos.loot.getById(id).quantity).toBe(3);
    expect((await request(app).get('/api/currency')).body).toMatchObject({ gold: 447, silver: 210 });
    const missing = await request(app)
      .post('/api/loot/9999/sell')
      .send({ quantity: 1, proceeds: { gold: 10 } });
    expect(missing.status).toBe(404);
  });
});
