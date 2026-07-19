<script setup>
import { computed } from 'vue';
import { updateCharacter, setResourceActive } from '../api.js';
import { isBloodied, getCombatReminders } from '../combatReminders.js';

const props = defineProps({
  character: { type: Object, required: true },
});
const emit = defineEmits(['character-updated', 'resource-updated', 'resource-error']);

const bloodied = computed(() => isBloodied(props.character));
const hud = computed(() => getCombatReminders(props.character));

/** Consumables (Healing Potions...) — the same rows the Ledger's ± edits. */
const consumables = computed(() =>
  props.character.resources.filter((r) => r.category === 'consumable')
);

/**
 * Mutations are optimistic: emit the new value to the parent BEFORE the
 * request, reconcile with the server row on success, roll back on failure.
 * Nothing is disabled while a request is in flight — a slow backend must not
 * lock the card (each control still disables at its own 0/max boundary).
 * `inflight` only stops a stale confirmation from overwriting newer clicks.
 */
let inflight = 0;

/** Write one vital through to the server, optimistically. */
async function setVital(field, value) {
  const previous = props.character[field];
  if (value === previous) return;
  emit('character-updated', { id: props.character.id, [field]: value }); // optimistic
  inflight += 1;
  try {
    const updated = await updateCharacter(props.character.id, { [field]: value });
    if (inflight === 1) emit('character-updated', updated);
  } catch (err) {
    emit('character-updated', { id: props.character.id, [field]: previous }); // rollback
    emit('resource-error', `${props.character.name}: ${err.message}`);
  } finally {
    inflight -= 1;
  }
}

/** Adjust one character vital by delta, clamped to [0, max] (hit dice steppers). */
function adjustVital(field, delta, max) {
  return setVital(field, Math.max(0, Math.min(max, props.character[field] + delta)));
}

/**
 * The HP line is directly editable; these rules mirror the database CHECKs
 * (current BETWEEN 0 AND max, max > 0, temp >= 0) so bad edits are rejected
 * with a readable message before a request is ever made.
 */
const VITAL_RULES = {
  current_hp: (c, n) =>
    n < 0 || n > c.max_hp ? `current HP must be between 0 and ${c.max_hp}` : null,
  max_hp: (c, n) =>
    n < 1
      ? 'max HP must be at least 1'
      : n < c.current_hp
        ? `max HP cannot be below current HP (${c.current_hp}) — lower current HP first`
        : null,
  temp_hp: (_c, n) => (n < 0 ? 'temp HP cannot be negative' : null),
};

/** Commit an edited HP field: validate, then write through — or revert. */
function commitVital(field, event) {
  const raw = event.target.value.trim();
  const value = Number(raw);
  const message =
    raw === '' || !Number.isInteger(value)
      ? `${field.replace('_', ' ')} must be a whole number`
      : VITAL_RULES[field](props.character, value);
  if (message) {
    emit('resource-error', `${props.character.name}: ${message}`);
    // The prop never changed, so Vue won't re-patch the input — reset by hand.
    event.target.value = String(props.character[field]);
    return;
  }
  setVital(field, value);
}

/** Flip a toggleable feature (Twilight Sanctuary) on or off. */
async function setActive(resourceId, active) {
  const row = props.character.resources.find((r) => r.id === resourceId);
  if (row) emit('resource-updated', { ...row, is_active: active }); // optimistic
  try {
    emit('resource-updated', await setResourceActive(resourceId, active));
  } catch (err) {
    if (row) emit('resource-updated', { ...row, is_active: !active }); // rollback
    emit('resource-error', `${props.character.name}: ${err.message}`);
  }
}
</script>

<template>
  <article
    data-testid="hud-card"
    class="flex min-w-0 flex-col rounded-lg border border-edge bg-card p-3 shadow-[0_1px_8px_rgba(0,0,0,0.35)]"
    :aria-label="`${character.name} combat status`"
  >
    <!-- Combat role: the one sentence that survives week-to-week amnesia -->
    <div
      v-if="character.playbook"
      data-testid="role-banner"
      class="-mx-3 -mt-3 mb-2 rounded-t-lg border-b border-arcane/40 bg-arcane/10 px-3 py-1.5"
    >
      <span class="text-[10px] font-semibold uppercase tracking-[0.15em] text-arcane">{{
        character.playbook.role_name
      }}</span>
      <p class="text-[11px] leading-snug text-faded">{{ character.playbook.role_text }}</p>
    </div>

    <!-- Header: who + bloodied state at a glance -->
    <header class="flex items-baseline justify-between gap-2">
      <h2 class="min-w-0 break-words font-display text-xl leading-tight">{{ character.name }}</h2>
      <span
        v-if="bloodied"
        data-testid="bloodied"
        class="shrink-0 rounded-full border border-blood bg-blood/15 px-2 py-px text-[10px] font-semibold uppercase tracking-[0.15em] text-blood"
        >Bloodied</span
      >
    </header>
    <p class="mt-0.5 text-xs text-faded">
      <template v-if="character.subclass">{{ character.subclass }} · </template>{{ character.class }}
    </p>

    <!-- Status snapshot: one editable HP line (current / max + temp), hit dice -->
    <div class="mt-2.5 flex flex-col gap-1.5 border-y border-edge py-2">
      <div class="flex flex-wrap items-center justify-between gap-1.5">
        <span class="text-xs uppercase tracking-[0.15em] text-faded">HP</span>
        <span class="flex items-center gap-0.5 font-display text-lg tabular-nums leading-none">
          <input
            data-testid="hud-hp"
            :value="character.current_hp"
            type="number"
            inputmode="numeric"
            class="vital-input w-12 text-right"
            :class="bloodied ? 'text-blood' : ''"
            aria-label="Current HP"
            @change="commitVital('current_hp', $event)"
          />
          <span class="text-sm text-faded">/</span>
          <input
            data-testid="hud-max-hp"
            :value="character.max_hp"
            type="number"
            inputmode="numeric"
            class="vital-input w-12"
            aria-label="Max HP"
            @change="commitVital('max_hp', $event)"
          />
          <span class="ml-1 text-sm text-faded">+</span>
          <input
            data-testid="hud-temp-hp"
            :value="character.temp_hp"
            type="number"
            inputmode="numeric"
            class="vital-input w-10 text-tonic"
            aria-label="Temporary HP"
            @change="commitVital('temp_hp', $event)"
          />
          <span class="text-[9px] uppercase tracking-[0.12em] text-faded">temp</span>
        </span>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-1.5">
        <span class="text-xs uppercase tracking-[0.15em] text-faded">Hit Dice</span>
        <span class="flex items-center gap-1">
          <button type="button" data-testid="hd-dec-1" class="hud-btn" :disabled="character.current_hit_dice === 0" aria-label="Spend 1 hit die" @click="adjustVital('current_hit_dice', -1, character.max_hit_dice)">−1</button>
          <span class="mx-1 font-display text-lg tabular-nums leading-none">
            <span data-testid="hud-hit-dice">{{ character.current_hit_dice }}</span
            ><span class="text-sm text-faded">/{{ character.max_hit_dice }}</span>
          </span>
          <button type="button" data-testid="hd-inc-1" class="hud-btn" :disabled="character.current_hit_dice === character.max_hit_dice" aria-label="Regain 1 hit die" @click="adjustVital('current_hit_dice', 1, character.max_hit_dice)">+1</button>
        </span>
      </div>
    </div>

    <!-- Features currently running (toggled Active) -->
    <div v-if="hud.activeFeatures.length" class="mt-2 flex flex-wrap gap-1.5">
      <span
        v-for="feature in hud.activeFeatures"
        :key="feature.key"
        data-testid="active-feature"
        :data-feature="feature.key"
        class="flex items-center gap-1.5 rounded-full border border-arcane/60 bg-arcane/10 px-2 py-0.5 text-xs text-arcane"
      >
        {{ feature.name }} — Active
        <button
          type="button"
          :data-testid="`deactivate-${feature.key}`"
          class="rounded border border-arcane/40 px-1 text-[10px] uppercase tracking-wide hover:border-arcane"
         
          @click="setActive(feature.resourceId, false)"
        >
          End
        </button>
      </span>
    </div>

    <!-- Easily forgotten abilities, conditioned on live state -->
    <section class="mt-2.5 min-w-0">
      <div class="mb-1 flex items-center gap-2">
        <h3 class="shrink-0 text-[10px] font-semibold uppercase tracking-[0.15em] text-ember">Reminders</h3>
        <div class="h-px min-w-0 flex-1 bg-edge" />
      </div>
      <ul class="flex flex-col gap-1.5">
        <!-- Depleted entries sort last (see combatReminders.js) and read as
             struck-through/dimmed with a Spent chip + their recharge trigger. -->
        <li
          v-for="item in hud.reminders"
          :key="item.key"
          data-testid="reminder"
          :data-reminder="item.key"
          :data-depleted="item.depleted"
          class="min-w-0"
          :class="item.depleted ? 'opacity-60' : ''"
        >
          <div class="flex flex-wrap items-center justify-between gap-x-2">
            <span
              class="text-sm leading-snug"
              :class="item.depleted ? 'text-faded line-through decoration-faded/70' : ''"
              >{{ item.name }}</span
            >
            <span v-if="item.depleted" class="flex shrink-0 items-center gap-1">
              <span
                data-testid="reminder-depleted"
                class="rounded-full border border-blood/40 bg-blood/10 px-1.5 py-px text-[9px] uppercase leading-tight tracking-[0.12em] text-blood/90"
                title="No uses remaining"
                >Spent</span
              >
              <span
                v-if="item.reset"
                data-testid="reminder-reset"
                class="rounded-full border border-edge/80 bg-ink/40 px-1.5 py-px text-[9px] uppercase leading-tight tracking-[0.12em] text-faded"
                :title="item.reset.title"
                >{{ item.reset.tag }}</span
              >
            </span>
            <button
              v-if="item.toggle"
              type="button"
              :data-testid="`activate-${item.key}`"
              class="hud-btn uppercase tracking-wide"
              @click="setActive(item.toggle.resourceId, true)"
            >
              Activate
            </button>
          </div>
          <p class="text-[11px] leading-snug" :class="item.depleted ? 'text-faded/60' : 'text-faded/90'">
            {{ item.text }}
          </p>
        </li>
      </ul>
    </section>

    <!-- Consumables: stock counts shared 1:1 with the Ledger's ± counters -->
    <section v-if="consumables.length" data-testid="hud-consumables" class="mt-2.5 min-w-0">
      <div class="mb-1 flex items-center gap-2">
        <h3 class="shrink-0 text-[10px] font-semibold uppercase tracking-[0.15em] text-tonic">Consumables</h3>
        <div class="h-px min-w-0 flex-1 bg-edge" />
      </div>
      <ul class="flex flex-col gap-1">
        <li
          v-for="item in consumables"
          :key="item.id"
          data-testid="hud-consumable"
          :data-consumable="item.resource_name"
          class="flex items-center justify-between gap-2"
        >
          <span class="text-sm leading-snug">{{ item.label ?? item.resource_name }}</span>
          <span data-testid="consumable-count" class="font-display text-lg tabular-nums leading-none text-tonic">
            {{ item.current_value }}
          </span>
        </li>
      </ul>
    </section>
  </article>
</template>

<style scoped>
@reference "../style.css";
/* Editable vitals read as plain numbers until touched; no spinner chrome. */
.vital-input {
  @apply rounded border border-transparent bg-transparent px-0.5 text-center font-display
    tabular-nums transition-colors duration-100 [appearance:textfield] hover:border-edge
    focus-visible:border-faded focus-visible:outline-none motion-reduce:transition-none
    [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none;
}
.hud-btn {
  @apply rounded border border-edge px-1.5 py-0.5 text-xs text-faded transition-colors duration-100
    hover:border-faded hover:text-parchment focus-visible:outline focus-visible:outline-2
    focus-visible:outline-parchment disabled:cursor-not-allowed disabled:opacity-40
    motion-reduce:transition-none;
}
</style>
