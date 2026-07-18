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
