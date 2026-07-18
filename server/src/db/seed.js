/**
 * The real party. Single source of truth for seeded data: the CLI seeder
 * populates party.db from this, and the Vitest fixture runs it against
 * ':memory:' so tests exercise exactly what the table sees at the table.
 *
 * Uppy Beauty — Level 10 Twilight Cleric (Aasimar):
 *   - Full-caster slots 4/3/3/3/2, Channel Divinity x3
 *   - Twilight features (Eyes/Steps of Night, Vigilant Blessing at-will)
 *   - Aasimar traits (Healing Hands, Celestial Revelation) + innate spells
 *
 * Kit Sofia — Level 10 Tempest Cleric (Elf):
 *   - Full-caster slots 4/3/3/3/2
 *   - Channel Divinity x3 with partial recovery: +1 use on a short rest
 *   - Wrath of the Storm x5, lineage/feat spells, Winged Boots (1d4 @ dawn)
 *
 * Lobos — Level 10 Blood Hunter (Order of the Lycan):
 *   - Short-rest features (Blood Maledict x2, Hybrid Transformation, Brand of Castigation)
 *   - Crimson Rite (at-will, costs HP), Shift x4 (racial, long rest)
 *   - Two dawn-recharge magic items that burn hit dice
 *
 * Malachai — Level 10 Monk:
 *   - Primordial Attunement (Pass Without Trace), Molten Shell, Luck Points x5
 *
 * Orlin — Level 10 Artificer:
 *   - Flash of Genius x5, Luck Points x5, Alert feat (2024) initiative swap
 *
 * Everyone carries Healing Potions — a consumable counter, never auto-refreshed.
 * The clerics start with 3 in stock; the other three start empty.
 *
 * Hit dice: every character is level 10, so characters.create() defaults each
 * to a full 10/10 hit dice pool (max_hit_dice = level).
 */
export function seedParty(repos) {
  const { characters, resourceDefinitions, characterResources, playbooks } = repos;

  // --- Resource definitions (shared vocabulary) ---
  // The two Channel Divinity variants differ in description and reset
  // behavior, and names are UNIQUE — so each gets its own definition and the
  // character row carries label 'Channel Divinity' for clean display.
  const defs = {
    spellSlot: resourceDefinitions.create({
      name: 'Spell Slot',
      category: 'spell_slot',
      refresh_on: 'long_rest',
      description: 'Expended to cast leveled spells.',
    }),
    channelDivinityTwilight: resourceDefinitions.create({
      name: 'Channel Divinity (Twilight)',
      category: 'class_feature',
      refresh_on: 'long_rest',
      description:
        'Choose one: Twilight Sanctuary (30ft aura, grant temp HP or cleanse charm/fear at turn end); Divine Spark (2d8 + WIS healing, or CON save for 2d8 + WIS Necrotic/Radiant damage); or Turn Undead (WIS save or frightened/incapacitated for 1 min).',
    }),
    channelDivinityTempest: resourceDefinitions.create({
      name: 'Channel Divinity (Tempest)',
      category: 'class_feature',
      refresh_on: 'long_rest',
      short_rest_gain: 1, // regain 1 use on a short rest, all on a long rest
      description: 'Destructive Wrath — Deal maximum damage when you roll Lightning or Thunder damage.',
    }),
    eyesOfNight: resourceDefinitions.create({
      name: 'Eyes of Night',
      category: 'class_feature',
      refresh_on: 'long_rest',
      description: 'Share 300ft darkvision with up to 4 creatures within 10ft for 1 hour.',
    }),
    stepsOfNight: resourceDefinitions.create({
      name: 'Steps of Night',
      category: 'class_feature',
      refresh_on: 'long_rest',
      description:
        'Bonus action in dim light/darkness to gain flying speed equal to walking speed for 1 min.',
    }),
    vigilantBlessing: resourceDefinitions.create({
      name: 'Vigilant Blessing',
      category: 'class_feature',
      refresh_on: 'manual',
      description: 'Action to touch a creature and give them advantage on their next initiative roll.',
    }),
    divineIntervention: resourceDefinitions.create({
      name: 'Divine Intervention',
      category: 'class_feature',
      refresh_on: 'long_rest',
      description: 'Magic action to cast a pre-determined level 5 spell without expending a spell slot.',
    }),
    healingHands: resourceDefinitions.create({
      name: 'Healing Hands',
      category: 'other',
      refresh_on: 'long_rest',
      description: 'Touch a creature to heal 4d4 HP.',
    }),
    celestialRevelation: resourceDefinitions.create({
      name: 'Celestial Revelation',
      category: 'other',
      refresh_on: 'long_rest',
      description:
        'Bonus action to sprout wings, emit a fear aura, or emit a radiant damage aura for 1 minute.',
    }),
    causeFear: resourceDefinitions.create({
      name: 'Cause Fear',
      category: 'other',
      refresh_on: 'long_rest',
      description: 'Target makes a Wisdom save or becomes Frightened for up to 1 minute.',
    }),
    invisibility: resourceDefinitions.create({
      name: 'Invisibility',
      category: 'other',
      refresh_on: 'long_rest',
      description: 'Become invisible for up to 1 hour (Concentration).',
    }),
    wrathOfTheStorm: resourceDefinitions.create({
      name: 'Wrath of the Storm',
      category: 'class_feature',
      refresh_on: 'long_rest',
      description:
        'Reaction when hit within 5ft; attacker makes DEX save or takes 2d8 Lightning/Thunder damage.',
    }),
    mistyStep: resourceDefinitions.create({
      name: 'Elven Lineage: Misty Step',
      category: 'other',
      refresh_on: 'long_rest',
      description: 'Cast Misty Step without expending a spell slot.',
    }),
    witchBolt: resourceDefinitions.create({
      name: 'Mage Initiate: Witch Bolt',
      category: 'other',
      refresh_on: 'long_rest',
      description: 'Cast Witch Bolt without expending a spell slot.',
    }),
    wingedBoots: resourceDefinitions.create({
      name: 'Winged Boots',
      category: 'other',
      refresh_on: 'dawn', // regains 1d4 charges at dawn — restored by hand, never by rest buttons
      description: 'Grant 30 feet of flying speed for 1 hour.',
    }),
    healingPotion: resourceDefinitions.create({
      name: 'Healing Potions',
      category: 'consumable',
      refresh_on: 'manual',
      description: 'Drink or administer as a bonus action to regain 2d4 + 2 HP.',
    }),
    bloodMaledict: resourceDefinitions.create({
      name: 'Blood Maledict',
      category: 'class_feature',
      refresh_on: 'short_rest',
      description:
        'Invoke a blood curse. Can amplify for effects: (1) Disadvantage on STR/DEX checks and 1d8 damage if target multi-attacks. (2) Marked: add 1d6 rite damage to attacks. (3) Reaction to force a target within 30ft to attack another target.',
    }),
    hybridTransformation: resourceDefinitions.create({
      name: 'Hybrid Transformation',
      category: 'class_feature',
      refresh_on: 'short_rest',
      description:
        'Gain advantage on STR checks/saves; resistance to bludgeoning, piercing, slashing; +1 AC if not in heavy armor; unarmed strikes with rite deal 1d6 damage. Note: Must roll to maintain control if below half HP.',
    }),
    brandOfCastigation: resourceDefinitions.create({
      name: 'Brand of Castigation',
      category: 'class_feature',
      refresh_on: 'short_rest',
      description:
        'Brand a target damaged by your active rite. If they damage you or an ally within 5ft, they take 2 psychic damage.',
    }),
    crimsonRite: resourceDefinitions.create({
      name: 'Crimson Rite',
      category: 'class_feature',
      refresh_on: 'manual', // at-will — the cost is HP, not uses
      description:
        'Bonus action: imbue one weapon with an elemental rite. Take damage equal to one roll of your hemocraft die (d6); the weapon deals an extra 1d6 rite damage until your next rest.',
    }),
    shift: resourceDefinitions.create({
      name: 'Shift',
      category: 'other',
      refresh_on: 'long_rest',
      description:
        'Gain 8 temp HP. Unarmed strikes do 1d6 + 4 piercing damage. Can use Longtooth Strike as a bonus action.',
    }),
    bloodshedGreatsword: resourceDefinitions.create({
      name: 'Bloodshed Greatsword - Invoke Rune',
      category: 'other',
      refresh_on: 'dawn',
      description:
        'Spend hit dice after rolling an attack to add to the roll, or after rolling damage to add to the weapon damage.',
    }),
    bloodsmeltPlate: resourceDefinitions.create({
      name: 'Bloodsmelt Plate Armor',
      category: 'other',
      refresh_on: 'dawn',
      description:
        'Action to spend up to 3 hit dice to gain temp HP equal to roll + CON mod. While you have this temp HP, attackers within 15ft take 1d6 + CON mod damage.',
    }),
    passWithoutTrace: resourceDefinitions.create({
      name: 'Primordial Attunement - Pass Without Trace',
      category: 'other',
      refresh_on: 'long_rest',
      description: 'Cast Pass Without Trace without using a spell slot.',
    }),
    moltenShell: resourceDefinitions.create({
      name: 'Molten Shell',
      category: 'other',
      refresh_on: 'long_rest',
      description:
        'Gain temp HP after a long rest. Deal 5 fire damage to attackers who hit you with a melee attack while you have this temp HP.',
    }),
    luckPoint: resourceDefinitions.create({
      name: 'Luck Point',
      category: 'other',
      refresh_on: 'long_rest',
      description:
        "Expend a point to gain advantage on a roll, or impose disadvantage on an enemy's attack.",
    }),
    alertInitiativeSwap: resourceDefinitions.create({
      name: 'Alert - Initiative Swap',
      category: 'other',
      refresh_on: 'manual', // 2024 (5.5e) Alert feat — no uses to track
      description: 'Swap your initiative with a willing ally.',
    }),
    flashOfGenius: resourceDefinitions.create({
      name: 'Flash of Genius',
      category: 'class_feature',
      refresh_on: 'long_rest',
      description:
        "Reaction to add +5 (INT mod) to an ally's saving throw and optionally teleport them 15 feet.",
    }),
  };

  // --- Characters ---
  const uppyCharacter = characters.create({
    name: 'Uppy Beauty',
    class: 'Cleric',
    subclass: 'Twilight Domain',
    level: 10,
    max_hp: 63,
    notes: 'Aasimar. 300ft darkvision; Twilight Sanctuary anchors the party.',
  });

  const kitCharacter = characters.create({
    name: 'Kit Sofia',
    class: 'Cleric',
    subclass: 'Tempest Domain',
    level: 10,
    max_hp: 73,
    notes: 'Elf. Destructive Wrath maximizes Lightning/Thunder damage.',
  });

  const lobosCharacter = characters.create({
    name: 'Lobos',
    class: 'Blood Hunter',
    subclass: 'Order of the Lycan',
    level: 10,
    max_hp: 83,
    notes: 'Shifter. Must roll to keep control of Hybrid Transformation below half HP.',
  });

  const malachaiCharacter = characters.create({
    name: 'Malachai',
    class: 'Monk',
    level: 10,
    max_hp: 69,
    notes: 'Genasi. Molten Shell temp HP burns melee attackers for 5 fire damage.',
  });

  const orlinCharacter = characters.create({
    name: 'Orlin',
    class: 'Artificer',
    level: 10,
    max_hp: 68,
    notes: "Flash of Genius reaction (+5 INT) rescues allies' saving throws.",
  });

  /** Level 10 full-caster slots: 4 / 3 / 3 / 3 / 2. */
  const assignSlots = (characterId) =>
    [4, 3, 3, 3, 2].map((max, i) =>
      characterResources.assign({
        character_id: characterId,
        definition_id: defs.spellSlot.id,
        label: `Level ${i + 1}`,
        max_value: max,
        sort_order: i,
        metadata: { slot_level: i + 1 },
      })
    );

  /** Features get sort_order after the slots so each category group reads in seed order. */
  const assignFeatures = (characterId, rows) =>
    rows.map(([def, max_value, extra = {}], i) =>
      characterResources.assign({
        character_id: characterId,
        definition_id: def.id,
        max_value,
        sort_order: 10 + i,
        ...extra,
      })
    );

  const uppySlots = assignSlots(uppyCharacter.id);
  const [
    uppyCD,
    uppyEyes,
    uppySteps,
    uppyVigilant,
    uppyDI,
    uppyHealingHands,
    uppyCelestial,
    uppyCauseFear,
    uppyInvisibility,
    uppyPotions,
  ] = assignFeatures(uppyCharacter.id, [
    [defs.channelDivinityTwilight, 3, { label: 'Channel Divinity' }],
    [defs.eyesOfNight, 1],
    [defs.stepsOfNight, 4],
    [defs.vigilantBlessing, 0], // max 0 = at-will, nothing to spend
    [defs.divineIntervention, 1],
    [defs.healingHands, 1],
    [defs.celestialRevelation, 1],
    [defs.causeFear, 1],
    [defs.invisibility, 1],
    [defs.healingPotion, 10, { current_value: 3 }],
  ]);

  const kitSlots = assignSlots(kitCharacter.id);
  const [kitCD, kitWrath, kitDI, kitMistyStep, kitWitchBolt, kitBoots, kitPotions] =
    assignFeatures(kitCharacter.id, [
      [defs.channelDivinityTempest, 3, { label: 'Channel Divinity' }],
      [defs.wrathOfTheStorm, 5],
      [defs.divineIntervention, 1],
      [defs.mistyStep, 1],
      [defs.witchBolt, 1],
      [defs.wingedBoots, 4],
      [defs.healingPotion, 10, { current_value: 3 }],
    ]);

  const [
    lobosMaledict,
    lobosHybrid,
    lobosBrand,
    lobosCrimsonRite,
    lobosShift,
    lobosGreatsword,
    lobosPlate,
    lobosPotions,
  ] = assignFeatures(lobosCharacter.id, [
    [defs.bloodMaledict, 2],
    [defs.hybridTransformation, 1],
    [defs.brandOfCastigation, 1],
    [defs.crimsonRite, 0], // max 0 = at-will, nothing to spend
    [defs.shift, 4],
    [defs.bloodshedGreatsword, 1],
    [defs.bloodsmeltPlate, 1],
    [defs.healingPotion, 10, { current_value: 0 }],
  ]);

  const [malachaiPWT, malachaiMoltenShell, malachaiLuck, malachaiPotions] = assignFeatures(
    malachaiCharacter.id,
    [
      [defs.passWithoutTrace, 1],
      [defs.moltenShell, 1],
      [defs.luckPoint, 5],
      [defs.healingPotion, 10, { current_value: 0 }],
    ]
  );

  const [orlinFlash, orlinLuck, orlinAlert, orlinPotions] = assignFeatures(orlinCharacter.id, [
    [defs.flashOfGenius, 5],
    [defs.luckPoint, 5],
    [defs.alertInitiativeSwap, 0], // max 0 = at-will, nothing to spend
    [defs.healingPotion, 10, { current_value: 0 }],
  ]);

  // --- Playbooks (decision-support content) ---
  // One card of judgment per character: role, a default turn that is always
  // correct enough, a short if/then ladder read top-down (first match wins),
  // and a 3-ability shortlist. resource_name ties a rule to an owned resource
  // so the UI can dim it when the tank is empty.
  playbooks.upsertForCharacter(uppyCharacter.id, {
    role_name: 'Anchor',
    role_text:
      "You keep the party standing — your aura and concentration are the plan. Damage is not your job.",
    default_action: "Sacred Flame the party's focused target",
    default_bonus: 'Healing Word an injured ally if anyone is below half',
    default_move: 'Stay central so everyone is inside your 30ft Sanctuary aura',
    rules: [
      {
        priority: 1,
        condition_text: 'Hard fight starting and Sanctuary is off',
        action_text: 'Channel Divinity: Twilight Sanctuary — party-wide temp HP every round',
        resource_name: 'Channel Divinity (Twilight)',
      },
      {
        priority: 2,
        condition_text: 'Ally down',
        action_text: 'Healing Word from range — never spend your action walking over',
      },
      {
        priority: 3,
        condition_text: 'Boss or thick melee',
        action_text: 'Cast Spirit Guardians, stand next to the enemy, and hold concentration',
      },
      {
        priority: 4,
        condition_text: 'Before initiative, ambush likely',
        action_text: 'Vigilant Blessing: give Lobos advantage on initiative',
        resource_name: 'Vigilant Blessing',
      },
    ],
    signatures: [
      {
        slot: 1,
        name: 'Twilight Sanctuary',
        why_text: 'Temp HP for the whole party every round — opens every hard fight',
      },
      {
        slot: 2,
        name: 'Spirit Guardians',
        why_text: 'Your best sustained damage; cast once, hug enemies, keep concentration',
      },
      {
        slot: 3,
        name: 'Healing Word',
        why_text: 'Bonus-action pickup from 60ft — the only mid-fight heal worth an ally turn',
      },
    ],
  });

  playbooks.upsertForCharacter(kitCharacter.id, {
    role_name: 'Artillery',
    role_text:
      'You are burst damage — one huge maximized lightning strike per fight, then support.',
    default_action: 'Toll the Dead the focused target',
    default_bonus: 'Healing Word an injured ally if anyone is below half',
    default_move: 'Hold mid-range; melee attackers eat your Wrath of the Storm reaction',
    rules: [
      {
        priority: 1,
        condition_text: '3+ enemies clustered',
        action_text: 'Upcast Shatter + Channel Divinity: Destructive Wrath for maximum damage',
        resource_name: 'Channel Divinity (Tempest)',
      },
      {
        priority: 2,
        condition_text: 'Ally down',
        action_text: 'Healing Word from range (bonus action)',
      },
      {
        priority: 3,
        condition_text: 'Boss fight',
        action_text: 'Call Lightning, then re-strike every turn for one action',
      },
      {
        priority: 4,
        condition_text: 'Hit by a melee attack',
        action_text: 'Reaction: Wrath of the Storm — lightning back at the attacker',
        resource_name: 'Wrath of the Storm',
      },
    ],
    signatures: [
      {
        slot: 1,
        name: 'Shatter (upcast)',
        why_text: 'Pair with Destructive Wrath for maximized burst — your signature move',
      },
      {
        slot: 2,
        name: 'Call Lightning',
        why_text: 'Boss killer — one cast, then damage every single turn',
      },
      {
        slot: 3,
        name: 'Healing Word',
        why_text: 'Bonus-action pickup from range; keeps your action free to attack',
      },
    ],
  });

  playbooks.upsertForCharacter(lobosCharacter.id, {
    role_name: 'Front line',
    role_text:
      'You are the wall — pin the biggest threat and keep it hitting you instead of the casters.',
    default_action: 'Attack twice with the Bloodshed Greatsword, Crimson Rite lit',
    default_bonus: '—',
    default_move: 'Engage the strongest enemy; stay between it and the back line',
    rules: [
      {
        priority: 1,
        condition_text: 'Real fight starting',
        action_text: 'Bonus action: Hybrid Transformation, then light Crimson Rite',
        resource_name: 'Hybrid Transformation',
      },
      {
        priority: 2,
        condition_text: 'Bloodied with hit dice left',
        action_text: 'Activate Bloodsmelt Plate for temp HP',
        resource_name: 'Bloodsmelt Plate Armor',
      },
      {
        priority: 3,
        condition_text: 'Enemy caster or skirmisher slipping away',
        action_text: "Brand of Castigation on your next hit — it can't hide or teleport off",
        resource_name: 'Brand of Castigation',
      },
      {
        priority: 4,
        condition_text: 'Enemy leaning on attack rolls',
        action_text: 'Blood Maledict to curse their rolls',
        resource_name: 'Blood Maledict',
      },
    ],
    signatures: [
      {
        slot: 1,
        name: 'Crimson Rite',
        why_text: 'Free extra damage on every hit — it should be lit in every real fight',
      },
      {
        slot: 2,
        name: 'Hybrid Transformation',
        why_text: 'Your power switch; below half HP you must roll to stay in control',
      },
      {
        slot: 3,
        name: 'Bloodshed Greatsword rune',
        why_text: 'Burn a hit die for burst when a kill matters now',
      },
    ],
  });

  playbooks.upsertForCharacter(malachaiCharacter.id, {
    role_name: 'Skirmisher',
    role_text:
      'You hunt the back line — dash past the front and shut down casters and archers.',
    default_action: 'Attack twice',
    default_bonus: 'Flurry of Blows on the same target',
    default_move: 'Full speed to the most dangerous back-line enemy',
    rules: [
      {
        priority: 1,
        condition_text: 'Dangerous enemy about to act',
        action_text:
          'Stunning Strike your first hit (once per turn in 2024 rules) — even on a save they slow down and your next hit has advantage',
      },
      {
        priority: 2,
        condition_text: 'Swarmed in melee',
        action_text: 'Molten Shell — temp HP that burns everyone who hits you',
        resource_name: 'Molten Shell',
      },
      {
        priority: 3,
        condition_text: 'Crucial attack or save just failed',
        action_text: 'Spend a Luck Point to reroll',
        resource_name: 'Luck Point',
      },
      {
        priority: 4,
        condition_text: 'Party needs to reposition unseen',
        action_text: 'Primordial Attunement: Pass Without Trace',
        resource_name: 'Primordial Attunement - Pass Without Trace',
      },
    ],
    signatures: [
      {
        slot: 1,
        name: 'Stunning Strike',
        why_text:
          'Your fight-ender — a stunned boss loses its turn; once per turn, so lead with it',
      },
      {
        slot: 2,
        name: 'Flurry of Blows',
        why_text: 'Default bonus action whenever you attacked this turn',
      },
      {
        slot: 3,
        name: 'Molten Shell',
        why_text: 'Turns being surrounded into damage — pop it when enemies commit to you',
      },
    ],
  });

  playbooks.upsertForCharacter(orlinCharacter.id, {
    role_name: 'Enabler',
    role_text:
      'You win fights with reactions and setup — Flash of Genius saves allies; your damage is a bonus.',
    default_action: 'Attack the focused target',
    default_bonus: '—',
    default_move: 'Hold mid-range with line of sight to allies for Flash of Genius',
    rules: [
      {
        priority: 1,
        condition_text: 'Ally within 30ft about to fail a save',
        action_text: 'Reaction: Flash of Genius (+5, optionally teleport them 15ft)',
        resource_name: 'Flash of Genius',
      },
      {
        priority: 2,
        condition_text: 'Initiative just rolled, a key ally rolled low',
        action_text: 'Alert: swap initiative with them',
        resource_name: 'Alert - Initiative Swap',
      },
      {
        priority: 3,
        condition_text: "Ally down and you're closest",
        action_text: 'Pour a Healing Potion',
        resource_name: 'Healing Potions',
      },
      {
        priority: 4,
        condition_text: 'Crucial attack or save just failed',
        action_text: 'Spend a Luck Point to reroll',
        resource_name: 'Luck Point',
      },
    ],
    signatures: [
      {
        slot: 1,
        name: 'Flash of Genius',
        why_text: "The party's save insurance — hold your reaction for it every round",
      },
      {
        slot: 2,
        name: 'Alert initiative swap',
        why_text: 'Hand your high roll to whoever needs to act first — free, every fight',
      },
      {
        slot: 3,
        name: 'Luck Point',
        why_text: 'Five rerolls a day — spend them, they vanish at the long rest',
      },
    ],
  });

  return {
    definitions: defs,
    uppy: {
      character: uppyCharacter,
      slots: uppySlots,
      channelDivinity: uppyCD,
      eyesOfNight: uppyEyes,
      stepsOfNight: uppySteps,
      vigilantBlessing: uppyVigilant,
      divineIntervention: uppyDI,
      healingHands: uppyHealingHands,
      celestialRevelation: uppyCelestial,
      causeFear: uppyCauseFear,
      invisibility: uppyInvisibility,
      potions: uppyPotions,
    },
    kit: {
      character: kitCharacter,
      slots: kitSlots,
      channelDivinity: kitCD,
      wrathOfTheStorm: kitWrath,
      divineIntervention: kitDI,
      mistyStep: kitMistyStep,
      witchBolt: kitWitchBolt,
      wingedBoots: kitBoots,
      potions: kitPotions,
    },
    lobos: {
      character: lobosCharacter,
      bloodMaledict: lobosMaledict,
      hybridTransformation: lobosHybrid,
      brandOfCastigation: lobosBrand,
      crimsonRite: lobosCrimsonRite,
      shift: lobosShift,
      bloodshedGreatsword: lobosGreatsword,
      bloodsmeltPlate: lobosPlate,
      potions: lobosPotions,
    },
    malachai: {
      character: malachaiCharacter,
      passWithoutTrace: malachaiPWT,
      moltenShell: malachaiMoltenShell,
      luckPoint: malachaiLuck,
      potions: malachaiPotions,
    },
    orlin: {
      character: orlinCharacter,
      flashOfGenius: orlinFlash,
      luckPoint: orlinLuck,
      alertInitiativeSwap: orlinAlert,
      potions: orlinPotions,
    },
  };
}
