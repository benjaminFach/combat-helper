/**
 * Combat HUD logic — pure functions over the character shape the API returns,
 * so Vitest can drive every conditional without mounting a component.
 *
 * Reminders are "easily forgotten abilities": each entry is { key, name, text }
 * plus an optional `toggle` ({ resourceId }) when the ability can be switched
 * Active (e.g. Twilight Sanctuary). Conditional entries appear and disappear
 * with live state — bloodied, hit dice remaining, uses left, active flags.
 *
 * Configs are keyed by "subclass class" flavor (same matching trick as the
 * CharacterCard accents) rather than character names, so a renamed PC keeps
 * their reminders.
 */

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
      // Both magic items burn hit dice — no dice, no reminder.
      if (dice > 0) {
        reminders.push({
          key: 'bloodshed-greatsword',
          name: 'Bloodshed Greatsword - Invoke Rune',
          text: `${findResource(c, 'Bloodshed Greatsword - Invoke Rune')?.description ?? ''} ${dice} Hit Dice remaining.`.trim(),
        });
      }
      if (isBloodied(c) && dice > 0) {
        reminders.push({
          key: 'bloodsmelt-plate',
          name: 'Bloodsmelt Plate Armor',
          text: `${findResource(c, 'Bloodsmelt Plate Armor')?.description ?? ''} ${dice} Hit Dice remaining.`.trim(),
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
    build() {
      return [
        {
          key: 'alert-initiative-swap',
          name: 'Alert - Initiative Swap',
          text: 'Swap your initiative with a willing ally.',
        },
      ];
    },
  },
];

/** Unconditional reminder whose text is the resource's own rules description. */
function reminder(character, key, resourceName) {
  return { key, name: resourceName, text: findResource(character, resourceName)?.description ?? '' };
}

/**
 * Everything the HUD card needs to render for one character:
 * { reminders: [{ key, name, text, toggle? }], activeFeatures: [{ key, name, resourceId }] }
 */
export function getCombatReminders(character) {
  const flavor = `${character.subclass ?? ''} ${character.class}`;
  const config = REMINDER_CONFIGS.find((r) => r.match.test(flavor));
  if (!config) return { reminders: [], activeFeatures: [] };
  return {
    reminders: config.build(character),
    activeFeatures: config.active?.(character) ?? [],
  };
}
