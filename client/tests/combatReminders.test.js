import { describe, it, expect } from 'vitest';
import { isBloodied, potionCount, getCombatReminders } from '../src/combatReminders.js';

/** Minimal character shape as GET /api/characters returns it. */
const character = (overrides = {}) => ({
  id: 1,
  name: 'Test',
  class: 'Fighter',
  subclass: null,
  level: 10,
  max_hp: 80,
  current_hp: 80,
  temp_hp: 0,
  max_hit_dice: 10,
  current_hit_dice: 10,
  resources: [],
  ...overrides,
});

const resource = (name, overrides = {}) => ({
  id: 100,
  resource_name: name,
  description: `${name} rules text.`,
  current_value: 1,
  max_value: 1,
  is_active: false,
  ...overrides,
});

const names = (c) => getCombatReminders(c).reminders.map((r) => r.name);

describe('isBloodied', () => {
  it('is strictly below half max HP', () => {
    expect(isBloodied(character({ max_hp: 63, current_hp: 32 }))).toBe(false); // 32 > 31.5
    expect(isBloodied(character({ max_hp: 63, current_hp: 31 }))).toBe(true);
    expect(isBloodied(character({ max_hp: 80, current_hp: 40 }))).toBe(false); // exactly half
    expect(isBloodied(character({ max_hp: 80, current_hp: 39 }))).toBe(true);
  });
});

describe('potionCount', () => {
  it('reads the Healing Potions consumable, defaulting to 0', () => {
    expect(potionCount(character())).toBe(0);
    expect(
      potionCount(character({ resources: [resource('Healing Potions', { current_value: 3 })] }))
    ).toBe(3);
  });
});

describe('Twilight Cleric (Uppy)', () => {
  const uppy = (cd = {}) =>
    character({
      class: 'Cleric',
      subclass: 'Twilight Domain',
      resources: [
        resource('Channel Divinity (Twilight)', { id: 7, current_value: 3, max_value: 3, ...cd }),
        resource('Divine Intervention'),
      ],
    });

  it('always reminds Vigilant Blessing (custom text) and Divine Intervention', () => {
    const { reminders } = getCombatReminders(uppy());
    expect(reminders.find((r) => r.name === 'Vigilant Blessing').text).toBe(
      'Use this to grant someone advantage on initiative.'
    );
    expect(names(uppy())).toContain('Divine Intervention');
  });

  it('shows Twilight Sanctuary only when NOT active and uses remain', () => {
    expect(names(uppy())).toContain('Twilight Sanctuary');
    expect(names(uppy({ is_active: true }))).not.toContain('Twilight Sanctuary');
    expect(names(uppy({ current_value: 0 }))).not.toContain('Twilight Sanctuary');
    expect(names(uppy({ is_active: true, current_value: 0 }))).not.toContain('Twilight Sanctuary');
  });

  it('exposes a toggle on the Sanctuary reminder and an active chip once running', () => {
    const idle = getCombatReminders(uppy());
    expect(idle.reminders.find((r) => r.name === 'Twilight Sanctuary').toggle).toEqual({
      resourceId: 7,
    });
    expect(idle.activeFeatures).toEqual([]);

    const running = getCombatReminders(uppy({ is_active: true }));
    expect(running.activeFeatures).toEqual([
      { key: 'twilight-sanctuary', name: 'Twilight Sanctuary', resourceId: 7 },
    ]);
  });
});

describe('Blood Hunter (Lobos)', () => {
  const lobos = (overrides = {}) =>
    character({
      class: 'Blood Hunter',
      subclass: 'Order of the Lycan',
      max_hp: 83,
      current_hp: 83,
      resources: [
        resource('Shift'),
        resource('Bloodshed Greatsword - Invoke Rune'),
        resource('Bloodsmelt Plate Armor'),
        resource('Crimson Rite'),
      ],
      ...overrides,
    });

  it('always reminds Shift and Crimson Rite', () => {
    expect(names(lobos())).toEqual(
      expect.arrayContaining(['Shift', 'Crimson Rite'])
    );
    expect(names(lobos({ current_hit_dice: 0, current_hp: 10 }))).toEqual(
      expect.arrayContaining(['Shift', 'Crimson Rite'])
    );
  });

  it('shows Invoke Rune only with hit dice left, including the count', () => {
    const { reminders } = getCombatReminders(lobos({ current_hit_dice: 6 }));
    const rune = reminders.find((r) => r.name === 'Bloodshed Greatsword - Invoke Rune');
    expect(rune.text).toMatch(/6 Hit Dice remaining/);
    expect(names(lobos({ current_hit_dice: 0 }))).not.toContain(
      'Bloodshed Greatsword - Invoke Rune'
    );
  });

  it('shows Bloodsmelt Plate only when bloodied AND hit dice remain', () => {
    expect(names(lobos())).not.toContain('Bloodsmelt Plate Armor'); // full HP
    expect(names(lobos({ current_hp: 41 }))).toContain('Bloodsmelt Plate Armor'); // 41 < 41.5
    expect(names(lobos({ current_hp: 42 }))).not.toContain('Bloodsmelt Plate Armor');
    expect(names(lobos({ current_hp: 41, current_hit_dice: 0 }))).not.toContain(
      'Bloodsmelt Plate Armor'
    );

    const { reminders } = getCombatReminders(lobos({ current_hp: 20, current_hit_dice: 3 }));
    expect(reminders.find((r) => r.name === 'Bloodsmelt Plate Armor').text).toMatch(
      /3 Hit Dice remaining/
    );
  });
});

describe('the rest of the party', () => {
  it('Tempest Cleric: Destructive Wrath, Wrath of the Storm, Divine Intervention', () => {
    const kit = character({
      class: 'Cleric',
      subclass: 'Tempest Domain',
      resources: [
        resource('Channel Divinity (Tempest)', {
          description: 'Destructive Wrath — Deal maximum damage when you roll Lightning or Thunder damage.',
        }),
        resource('Wrath of the Storm'),
        resource('Divine Intervention'),
      ],
    });
    expect(names(kit)).toEqual(['Destructive Wrath', 'Wrath of the Storm', 'Divine Intervention']);
  });

  it('Monk: Molten Shell', () => {
    const malachai = character({ class: 'Monk', resources: [resource('Molten Shell')] });
    expect(names(malachai)).toEqual(['Molten Shell']);
  });

  it('Artificer: Alert - Initiative Swap with the feat text', () => {
    const orlin = character({ class: 'Artificer' });
    const { reminders } = getCombatReminders(orlin);
    expect(reminders).toEqual([
      expect.objectContaining({
        name: 'Alert - Initiative Swap',
        text: 'Swap your initiative with a willing ally.',
      }),
    ]);
  });

  it('unknown classes get no reminders instead of crashing', () => {
    expect(getCombatReminders(character({ class: 'Bard' }))).toEqual({
      reminders: [],
      activeFeatures: [],
    });
  });
});

describe('de-ranking depleted reminders', () => {
  /** Tempest Cleric with three limited-use reminders and real reset triggers. */
  const kit = ({ cd = {}, wrath = {}, di = {} } = {}) =>
    character({
      class: 'Cleric',
      subclass: 'Tempest Domain',
      resources: [
        resource('Channel Divinity (Tempest)', {
          id: 201,
          current_value: 3,
          max_value: 3,
          refresh_on: 'long_rest',
          short_rest_gain: 1,
          ...cd,
        }),
        resource('Wrath of the Storm', {
          id: 202,
          current_value: 5,
          max_value: 5,
          refresh_on: 'long_rest',
          short_rest_gain: 0,
          ...wrath,
        }),
        resource('Divine Intervention', {
          id: 203,
          refresh_on: 'long_rest',
          short_rest_gain: 0,
          ...di,
        }),
      ],
    });

  const byKey = (c) => getCombatReminders(c).reminders.map((r) => r.key);
  const find = (c, key) => getCombatReminders(c).reminders.find((r) => r.key === key);

  it('flags nothing on a fully charged character', () => {
    const { reminders } = getCombatReminders(kit());
    expect(reminders.every((r) => r.depleted === false)).toBe(true);
    expect(reminders.every((r) => r.reset === null)).toBe(true);
    expect(byKey(kit())).toEqual(['destructive-wrath', 'wrath-of-the-storm', 'divine-intervention']);
  });

  it('moves an out-of-charges reminder to the bottom, flagged with its reset trigger', () => {
    const spent = kit({ wrath: { current_value: 0 } });
    expect(byKey(spent)).toEqual(['destructive-wrath', 'divine-intervention', 'wrath-of-the-storm']);
    const wrath = find(spent, 'wrath-of-the-storm');
    expect(wrath.depleted).toBe(true);
    expect(wrath.reset).toEqual({ tag: 'LR', title: 'Resets on a long rest' });
    // The others are untouched.
    expect(find(spent, 'destructive-wrath').depleted).toBe(false);
    expect(find(spent, 'divine-intervention').reset).toBeNull();
  });

  it('partial-recovery resources carry their combined reset tag (SR +1 · LR)', () => {
    const spent = kit({ cd: { current_value: 0 } });
    const wrath = find(spent, 'destructive-wrath'); // rides on Channel Divinity
    expect(wrath.depleted).toBe(true);
    expect(wrath.reset.tag).toBe('SR +1 · LR');
  });

  it('recharging clears the flag and restores the original order', () => {
    const spent = kit({ wrath: { current_value: 0 } });
    expect(find(spent, 'wrath-of-the-storm').depleted).toBe(true);

    const recharged = kit({ wrath: { current_value: 5 } });
    expect(find(recharged, 'wrath-of-the-storm').depleted).toBe(false);
    expect(find(recharged, 'wrath-of-the-storm').reset).toBeNull();
    expect(byKey(recharged)).toEqual([
      'destructive-wrath',
      'wrath-of-the-storm',
      'divine-intervention',
    ]);
  });

  it('a single regained use is enough to re-rank (0 -> 1)', () => {
    const oneUse = kit({ wrath: { current_value: 1 } });
    expect(find(oneUse, 'wrath-of-the-storm').depleted).toBe(false);
    expect(byKey(oneUse)).toEqual(['destructive-wrath', 'wrath-of-the-storm', 'divine-intervention']);
  });

  it('multiple depleted reminders all sink, keeping their relative order', () => {
    const spent = kit({ cd: { current_value: 0 }, wrath: { current_value: 0 } });
    expect(byKey(spent)).toEqual(['divine-intervention', 'destructive-wrath', 'wrath-of-the-storm']);
    expect(find(spent, 'destructive-wrath').depleted).toBe(true);
    expect(find(spent, 'wrath-of-the-storm').depleted).toBe(true);
    expect(find(spent, 'divine-intervention').depleted).toBe(false);
  });

  it('at-will abilities (max_value 0) never deplete', () => {
    const orlin = character({
      class: 'Artificer',
      resources: [
        resource('Alert - Initiative Swap', { max_value: 0, current_value: 0, refresh_on: 'manual' }),
      ],
    });
    const alert = find(orlin, 'alert-initiative-swap');
    expect(alert.depleted).toBe(false);
    expect(alert.reset).toBeNull();

    const uppy = character({
      class: 'Cleric',
      subclass: 'Twilight Domain',
      resources: [
        resource('Vigilant Blessing', { max_value: 0, current_value: 0, refresh_on: 'manual' }),
      ],
    });
    expect(find(uppy, 'vigilant-blessing').depleted).toBe(false);
  });

  it('dawn-recharge items deplete with a Dawn tag while their hit-dice gate is open (Lobos)', () => {
    const lobos = (hp) =>
      character({
        class: 'Blood Hunter',
        subclass: 'Order of the Lycan',
        max_hp: 83,
        current_hp: hp,
        resources: [
          resource('Shift', { id: 301, max_value: 4, current_value: 4, refresh_on: 'long_rest' }),
          resource('Bloodshed Greatsword - Invoke Rune', {
            id: 302,
            max_value: 1,
            current_value: 0,
            refresh_on: 'dawn',
          }),
          resource('Bloodsmelt Plate Armor', {
            id: 303,
            max_value: 1,
            current_value: 0,
            refresh_on: 'dawn',
          }),
          resource('Crimson Rite', { id: 304, max_value: 0, current_value: 0, refresh_on: 'manual' }),
        ],
      });

    // Full HP: rune shows (10 hit dice) but its daily charge is gone.
    const healthy = lobos(83);
    expect(byKey(healthy)).toEqual(['shift', 'crimson-rite', 'bloodshed-greatsword']);
    expect(find(healthy, 'bloodshed-greatsword').depleted).toBe(true);
    expect(find(healthy, 'bloodshed-greatsword').reset).toEqual({
      tag: 'Dawn',
      title: 'Recharges at dawn',
    });

    // Bloodied: the plate joins in, also depleted, after the rune.
    const bloodied = lobos(20);
    expect(byKey(bloodied)).toEqual([
      'shift',
      'crimson-rite',
      'bloodshed-greatsword',
      'bloodsmelt-plate',
    ]);
    expect(find(bloodied, 'bloodsmelt-plate').depleted).toBe(true);

    // The hit-dice hide rule still wins over de-ranking: no dice, no reminder.
    const noDice = { ...lobos(20), current_hit_dice: 0 };
    expect(byKey(noDice)).toEqual(['shift', 'crimson-rite']);
  });

  it("Uppy's Divine Intervention sinks below Sanctuary and Vigilant Blessing when spent", () => {
    const uppy = character({
      class: 'Cleric',
      subclass: 'Twilight Domain',
      resources: [
        resource('Vigilant Blessing', { id: 401, max_value: 0, current_value: 0, refresh_on: 'manual' }),
        resource('Channel Divinity (Twilight)', { id: 402, max_value: 3, current_value: 3, refresh_on: 'long_rest' }),
        resource('Divine Intervention', { id: 403, max_value: 1, current_value: 0, refresh_on: 'long_rest' }),
      ],
    });
    expect(byKey(uppy)).toEqual(['vigilant-blessing', 'twilight-sanctuary', 'divine-intervention']);
    expect(find(uppy, 'divine-intervention').depleted).toBe(true);
    expect(find(uppy, 'divine-intervention').reset.tag).toBe('LR');
    expect(find(uppy, 'twilight-sanctuary').depleted).toBe(false);
  });
});
