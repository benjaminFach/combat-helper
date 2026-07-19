/**
 * Combat HUD logic — pure functions over the character shape the API returns,
 * so Vitest can drive every conditional without mounting a component.
 *
 * Reminders are "easily forgotten abilities": each entry is { key, name, text }
 * plus an optional `toggle` ({ resourceId }) when the ability can be switched
 * Active (e.g. Twilight Sanctuary). Conditional entries appear and disappear
 * with live state — bloodied, hit dice remaining, uses left, active flags.
 *
 * De-ranking: a reminder backed by a resource with limited uses (max_value > 0)
 * that is out of charges (current_value === 0) is flagged `depleted`, sorted to
 * the bottom of the list (stable within each group), and carries its `reset`
 * trigger ({ tag, title } — e.g. LR / SR / Dawn) so the table can see when it
 * comes back. At-will abilities (max_value 0) never deplete.
 *
 * Configs are keyed by "subclass class" flavor (same matching trick as the
 * CharacterCard accents) rather than character names, so a renamed PC keeps
 * their reminders.
 */
import { resetLabel } from './categories.js';

/** Bloodied = strictly below half of max HP (5e definition). */
export function isBloodied(character) {
  return character.current_hp < character.max_hp / 2;
}

/** Current Healing Potion stock, linked to the Ledger's consumable counter. */
export function potionCount(character) {
  return findResource(character, 'Healing Potions')?.current_value ?? 0;
}

function findResource(character, name) {
  return character.resources?.find((r) => r.resource_name === name) ?? null;
}

const REMINDER_CONFIGS = [
  {
    match: /twilight/i,
    build(c) {
      const reminders = [
        {
          key: 'vigilant-blessing',
          name: 'Vigilant Blessing',
          text: 'Use this to grant someone advantage on initiative.',
          resource: findResource(c, 'Vigilant Blessing'), // at-will — never depletes
        },
      ];
      // Twilight Sanctuary rides on the Channel Divinity uses. Remind only
      // while it is NOT already running and there are uses left to spend.
      const cd = findResource(c, 'Channel Divinity (Twilight)');
      if (cd && !cd.is_active && cd.current_value > 0) {
        reminders.push({
          key: 'twilight-sanctuary',
          name: 'Twilight Sanctuary',
          text: `30ft aura: grant temp HP or end charm/fear on allies at each turn end. ${cd.current_value} Channel Divinity remaining.`,
          toggle: { resourceId: cd.id },
        });
      }
      reminders.push(reminder(c, 'divine-intervention', 'Divine Intervention'));
      return reminders;
    },
    /** Features currently switched on, for an "Active" chip with an off switch. */
    active(c) {
      const cd = findResource(c, 'Channel Divinity (Twilight)');
      return cd?.is_active
        ? [{ key: 'twilight-sanctuary', name: 'Twilight Sanctuary', resourceId: cd.id }]
        : [];
    },
  },
  {
    match: /tempest|storm/i,
    build(c) {
      const cd = findResource(c, 'Channel Divinity (Tempest)');
      return [
        {
          key: 'destructive-wrath',
          name: 'Destructive Wrath',
          text: cd?.description ?? 'Deal maximum damage when you roll Lightning or Thunder damage.',
          resource: cd, // spends Channel Divinity — depletes with it
        },
        reminder(c, 'wrath-of-the-storm', 'Wrath of the Storm'),
        reminder(c, 'divine-intervention', 'Divine Intervention'),
      ];
    },
  },
  {
    match: /lycan|blood hunter/i,
    build(c) {
      const reminders = [reminder(c, 'shift', 'Shift')];
      const dice = c.current_hit_dice;
      // Both magic items burn hit dice — no dice, no reminder. With dice in
      // hand they still carry their own daily charge, which can deplete.
      if (dice > 0) {
        const rune = findResource(c, 'Bloodshed Greatsword - Invoke Rune');
        reminders.push({
          key: 'bloodshed-greatsword',
          name: 'Bloodshed Greatsword - Invoke Rune',
          text: `${rune?.description ?? ''} ${dice} Hit Dice remaining.`.trim(),
          resource: rune,
        });
      }
      if (isBloodied(c) && dice > 0) {
        const plate = findResource(c, 'Bloodsmelt Plate Armor');
        reminders.push({
          key: 'bloodsmelt-plate',
          name: 'Bloodsmelt Plate Armor',
          text: `${plate?.description ?? ''} ${dice} Hit Dice remaining.`.trim(),
          resource: plate,
        });
      }
      reminders.push(reminder(c, 'crimson-rite', 'Crimson Rite'));
      return reminders;
    },
  },
  {
    match: /monk/i,
    build(c) {
      return [reminder(c, 'molten-shell', 'Molten Shell')];
    },
  },
  {
    match: /artificer/i,
    build(c) {
      return [
        {
          key: 'alert-initiative-swap',
          name: 'Alert - Initiative Swap',
          text: 'Swap your initiative with a willing ally.',
          resource: findResource(c, 'Alert - Initiative Swap'), // at-will — never depletes
        },
      ];
    },
  },
];

/** Unconditional reminder whose text is the resource's own rules description. */
function reminder(character, key, resourceName) {
  const resource = findResource(character, resourceName);
  return { key, name: resourceName, text: resource?.description ?? '', resource };
}

/**
 * Depleted = the backing resource tracks uses (max_value > 0) and has none
 * left. Resources without a row or with max 0 (at-will) never deplete.
 */
function isDepleted(resource) {
  return !!resource && resource.max_value > 0 && resource.current_value === 0;
}

/**
 * Everything the HUD card needs to render for one character:
 * {
 *   reminders: [{ key, name, text, toggle?, depleted, reset }],
 *   activeFeatures: [{ key, name, resourceId }],
 * }
 * `reset` is the resource's recharge trigger ({ tag, title }) and is only set
 * on depleted entries — that's when the table needs to know when it comes back.
 * Depleted reminders sort to the bottom; both groups keep their config order.
 */
export function getCombatReminders(character) {
  const flavor = `${character.subclass ?? ''} ${character.class}`;
  const config = REMINDER_CONFIGS.find((r) => r.match.test(flavor));
  if (!config) return { reminders: [], activeFeatures: [] };

  const built = config.build(character).map(({ resource, ...entry }) => {
    const depleted = isDepleted(resource);
    return {
      ...entry,
      depleted,
      reset: depleted && resetLabel(resource).tag ? resetLabel(resource) : null,
    };
  });

  return {
    reminders: [...built.filter((r) => !r.depleted), ...built.filter((r) => r.depleted)],
    activeFeatures: config.active?.(character) ?? [],
  };
}
