/**
 * Category presentation metadata. Class strings are full literals so
 * Tailwind's scanner can see them (dynamic class construction is invisible to JIT).
 */
export const CATEGORY_ORDER = ['spell_slot', 'class_feature', 'pool', 'consumable', 'other'];

export const CATEGORY_META = {
  spell_slot: {
    label: 'Spellcasting',
    text: 'text-arcane',
    pipOn: 'bg-arcane/90 border-arcane',
    bar: 'bg-arcane',
  },
  class_feature: {
    label: 'Class features',
    text: 'text-ember',
    pipOn: 'bg-ember/90 border-ember',
    bar: 'bg-ember',
  },
  pool: {
    label: 'Pools',
    text: 'text-vitality',
    pipOn: 'bg-vitality/90 border-vitality',
    bar: 'bg-vitality',
  },
  consumable: {
    label: 'Consumables',
    text: 'text-tonic',
    pipOn: 'bg-tonic/90 border-tonic',
    bar: 'bg-tonic',
  },
  other: {
    label: 'Traits & items',
    text: 'text-faded',
    pipOn: 'bg-faded/90 border-faded',
    bar: 'bg-faded',
  },
};

const RESET_META = {
  short_rest: { tag: 'SR', title: 'Resets on a short rest' },
  long_rest: { tag: 'LR', title: 'Resets on a long rest' },
  dawn: { tag: 'Dawn', title: 'Recharges at dawn' },
  // manual: no pill — an em-dash chip next to counter buttons reads as a stray control
  manual: { tag: '', title: '' },
};

/**
 * Human-readable reset condition for a resource row (definition fields come
 * joined onto the row). short_rest_gain marks partial recovery: a long-rest
 * resource that also regains N uses on a short rest.
 */
export function resetLabel(resource) {
  const meta = RESET_META[resource.refresh_on] ?? { tag: '', title: '' };
  if (resource.refresh_on === 'long_rest' && resource.short_rest_gain > 0) {
    return {
      tag: `SR +${resource.short_rest_gain} · LR`,
      title: `Regain ${resource.short_rest_gain} on a short rest, all on a long rest`,
    };
  }
  return meta;
}
