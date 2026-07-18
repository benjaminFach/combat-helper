<script setup>
import { computed } from 'vue';
import { updateCharacter, setResourceActive } from '../api.js';
import { isBloodied, potionCount, getCombatReminders } from '../combatReminders.js';

const props = defineProps({
  character: { type: Object, required: true },
});
const emit = defineEmits(['character-updated', 'resource-updated', 'resource-error']);

const bloodied = computed(() => isBloodied(props.character));
const potions = computed(() => potionCount(props.character));
const hud = computed(() => getCombatReminders(props.character));

/**
 * Mutations are optimistic: emit the new value to the parent BEFORE the
 * request, reconcile with the server row on success, roll back on failure.
 * Nothing is disabled while a request is in flight — a slow backend must not
 * lock the card (each control still disables at its own 0/max boundary).
 * `inflight` only stops a stale confirmation from overwriting newer clicks.
 */
let inflight = 0;

/** Adjust one character vital by delta, clamped to [0, max], then write through. */
async function adjustVital(field, delta, max) {
  const previous = props.character[field];
  const next = Math.max(0, Math.min(max, previous + delta));
  if (next === previous) return;
  emit('character-updated', { id: props.character.id, [field]: next }); // optimistic
  inflight += 1;
  try {
    const updated = await updateCharacter(props.character.id, { [field]: next });
    if (inflight === 1) emit('character-updated', updated);
  } catch (err) {
    emit('character-updated', { id: props.character.id, [field]: previous }); // rollback
    emit('resource-error', `${props.character.name}: ${err.message}`);
  } finally {
    inflight -= 1;
  }
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

    <!-- Status snapshot: HP / Temp / Hit Dice / Potions -->
    <div class="mt-2.5 flex flex-col gap-1.5 border-y border-edge py-2">
      <div class="flex flex-wrap items-center justify-between gap-1.5">
        <span class="text-xs uppercase tracking-[0.15em] text-faded">HP</span>
        <span class="flex items-center gap-1">
          <button type="button" data-testid="hp-dec-5" class="hud-btn" :disabled="character.current_hp === 0" aria-label="Lose 5 HP" @click="adjustVital('current_hp', -5, character.max_hp)">−5</button>
          <button type="button" data-testid="hp-dec-1" class="hud-btn" :disabled="character.current_hp === 0" aria-label="Lose 1 HP" @click="adjustVital('current_hp', -1, character.max_hp)">−1</button>
          <span class="mx-1 font-display text-lg tabular-nums leading-none" :class="bloodied ? 'text-blood' : ''">
            <span data-testid="hud-hp">{{ character.current_hp }}</span
            ><span class="text-sm text-faded">/{{ character.max_hp }}</span>
          </span>
          <button type="button" data-testid="hp-inc-1" class="hud-btn" :disabled="character.current_hp === character.max_hp" aria-label="Regain 1 HP" @click="adjustVital('current_hp', 1, character.max_hp)">+1</button>
          <button type="button" data-testid="hp-inc-5" class="hud-btn" :disabled="character.current_hp === character.max_hp" aria-label="Regain 5 HP" @click="adjustVital('current_hp', 5, character.max_hp)">+5</button>
        </span>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-1.5">
        <span class="text-xs uppercase tracking-[0.15em] text-faded">Temp HP</span>
        <span class="flex items-center gap-1">
          <button type="button" data-testid="temp-dec-1" class="hud-btn" :disabled="character.temp_hp === 0" aria-label="Lose 1 temp HP" @click="adjustVital('temp_hp', -1, 999)">−1</button>
          <span data-testid="hud-temp-hp" class="mx-1 min-w-[2ch] text-center font-display text-lg tabular-nums leading-none">{{ character.temp_hp }}</span>
          <button type="button" data-testid="temp-inc-1" class="hud-btn" aria-label="Gain 1 temp HP" @click="adjustVital('temp_hp', 1, 999)">+1</button>
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

      <div class="flex items-center justify-between gap-1.5">
        <span class="text-xs uppercase tracking-[0.15em] text-faded">Healing Potions</span>
        <span data-testid="hud-potions" class="font-display text-lg tabular-nums leading-none text-tonic">{{ potions }}</span>
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
        <li
          v-for="item in hud.reminders"
          :key="item.key"
          data-testid="reminder"
          :data-reminder="item.key"
          class="min-w-0"
        >
          <div class="flex flex-wrap items-center justify-between gap-x-2">
            <span class="text-sm leading-snug">{{ item.name }}</span>
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
          <p class="text-[11px] leading-snug text-faded/90">{{ item.text }}</p>
        </li>
      </ul>
    </section>
  </article>
</template>

<style scoped>
@reference "../style.css";
.hud-btn {
  @apply rounded border border-edge px-1.5 py-0.5 text-xs text-faded transition-colors duration-100
    hover:border-faded hover:text-parchment focus-visible:outline focus-visible:outline-2
    focus-visible:outline-parchment disabled:cursor-not-allowed disabled:opacity-40
    motion-reduce:transition-none;
}
</style>
