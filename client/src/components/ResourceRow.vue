<script setup>
import { ref, computed, watch } from 'vue';
import { updateUsage } from '../api.js';
import { CATEGORY_META, resetLabel } from '../categories.js';

const props = defineProps({
  resource: { type: Object, required: true },
});
const emit = defineEmits(['updated', 'error']);

/**
 * Local optimistic copy of current_value. The prop stays the source of truth:
 * whenever the parent's state changes (e.g. after a global rest), we resync.
 */
const current = ref(props.resource.current_value);
watch(
  () => props.resource.current_value,
  (v) => (current.value = v)
);

/**
 * In-flight request count. Controls are never locked while requests run —
 * the optimistic value is already correct, and disabling every box for a
 * whole round trip reads as a lockout on a slow backend. The counter only
 * guards reconciliation: a confirmation that lands while a NEWER request is
 * still out is stale and must not overwrite the newer optimistic value.
 */
let inflight = 0;

const meta = computed(() => CATEGORY_META[props.resource.category] ?? CATEGORY_META.other);
const displayName = computed(() => props.resource.label ?? props.resource.resource_name);
const reset = computed(() => resetLabel(props.resource));

/**
 * Rendering modes, most specific first:
 * - at-will:  max_value 0 — nothing to spend, the row is a reference card
 * - counter:  consumables count up/down with ± steppers, no visible cap
 * - pips:     small counts render as toggle boxes
 * - pool:     big numeric pools get a meter with ±1/±5
 */
const isAtWill = computed(() => props.resource.max_value === 0);
const isCounter = computed(() => !isAtWill.value && props.resource.category === 'consumable');
const isPips = computed(() => !isAtWill.value && !isCounter.value && props.resource.max_value <= 10);
const isBigPool = computed(() => props.resource.max_value >= 20);
const percent = computed(() =>
  props.resource.max_value === 0 ? 0 : Math.round((current.value / props.resource.max_value) * 100)
);

/**
 * Descriptions live on one truncated line so five dense cards still fit a
 * single 1080p screen; clicking the line (or hovering for the native tooltip)
 * reveals the full rules text mid-combat.
 */
const expanded = ref(false);

/**
 * Optimistic update: mutate the local value AND emit it to the parent FIRST,
 * then fire the request. Emitting up front keeps App-level state in sync with
 * what the user sees, so the value survives this component unmounting (e.g. a
 * tab switch) while the request is still in flight. On failure, roll back both
 * and surface the error.
 */
async function adjust(action, amount = 1) {
  const previous = current.value;
  const next =
    action === 'spend'
      ? Math.max(0, previous - amount)
      : Math.min(props.resource.max_value, previous + amount);
  if (next === previous) return; // nothing to do (already empty/full)

  current.value = next; // optimistic — UI flips before the network round trip
  emit('updated', { ...props.resource, current_value: next });
  inflight += 1;
  try {
    const updated = await updateUsage(props.resource.id, action, amount);
    if (inflight === 1) {
      // Latest outstanding request — server truth is authoritative.
      current.value = updated.current_value;
      emit('updated', updated);
    }
  } catch (err) {
    current.value = previous; // rollback
    emit('updated', { ...props.resource, current_value: previous });
    emit('error', `${displayName.value}: ${err.message}`);
    console.error(`[${displayName.value}]`, err);
  } finally {
    inflight -= 1;
  }
}

/** Filled pip (unspent) -> spend one. Hollow pip (spent) -> restore one. */
function togglePip(n) {
  adjust(n <= current.value ? 'spend' : 'restore', 1);
}
</script>

<template>
  <div class="min-w-0" :data-resource="resource.resource_name">
    <!--
      Name + controls share one line (wrapping gracefully when a card is
      narrow) so five dense characters still fit a single 1080p screen.
      Only big pools get a full-width meter row of their own.
    -->
    <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <span class="min-w-0 break-words text-sm leading-snug">{{ displayName }}</span>
      <span class="ml-auto flex shrink-0 items-center gap-1.5">
        <!-- Consumable counter: an open-ended tally, not a checkbox rail -->
        <template v-if="isCounter">
          <button
            type="button"
            data-testid="counter-dec"
            class="stepper-btn"
            :disabled="current === 0"
            :aria-label="`Use one ${displayName}`"
            @click="adjust('spend', 1)"
          >
            −
          </button>
          <span
            data-testid="counter-value"
            class="min-w-[2ch] text-center font-display text-base tabular-nums leading-none"
            >{{ current }}</span
          >
          <button
            type="button"
            data-testid="counter-inc"
            class="stepper-btn"
            :disabled="current === resource.max_value"
            :aria-label="`Add one ${displayName}`"
            @click="adjust('restore', 1)"
          >
            +
          </button>
        </template>

        <!-- Pip rail: slot boxes off a paper character sheet; spent = struck through -->
        <span v-else-if="isPips" class="flex flex-wrap items-center gap-1">
          <button
            v-for="n in resource.max_value"
            :key="n"
            type="button"
            data-testid="pip"
            :data-filled="n <= current"
            :aria-label="`${displayName}: box ${n} of ${resource.max_value}, ${n <= current ? 'available — click to spend' : 'spent — click to restore'}`"
            class="h-4 w-4 rounded-[3px] border transition-colors duration-100 motion-reduce:transition-none"
            :class="n <= current ? meta.pipOn : 'border-edge bg-transparent'"
            @click="togglePip(n)"
          >
            <svg v-if="n > current" viewBox="0 0 16 16" class="h-full w-full text-faded/60" aria-hidden="true">
              <line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </button>
        </span>

        <span
          v-if="isAtWill"
          data-testid="at-will"
          class="rounded-full border border-edge px-1.5 py-px text-[10px] leading-tight text-faded"
          title="Usable at will — no uses to track"
          >At will</span
        >
        <span
          v-if="reset.tag"
          data-testid="reset-tag"
          class="rounded-full border border-edge/80 bg-ink/40 px-1.5 py-px text-[9px] uppercase leading-tight tracking-[0.12em] text-faded"
          :title="reset.title"
          >{{ reset.tag }}</span
        >
      </span>
    </div>

    <!-- Rules text: one muted line, click (or hover) for the full effect -->
    <button
      v-if="resource.description"
      type="button"
      data-testid="description"
      class="mt-0.5 block w-full cursor-pointer text-left text-[11px] leading-snug text-faded/90
        transition-colors duration-100 hover:text-faded focus-visible:outline
        focus-visible:outline-1 focus-visible:outline-faded motion-reduce:transition-none"
      :class="expanded ? 'whitespace-normal' : 'truncate'"
      :title="resource.description"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ resource.description }}
    </button>

    <!-- Pool meter: big tabular number + increments sized to the pool -->
    <div v-if="!isAtWill && !isCounter && !isPips" class="mt-1">
      <div class="flex items-center gap-1.5">
        <button
          v-if="isBigPool"
          type="button"
          data-testid="pool-spend-5"
          class="pool-btn"
          :disabled="current === 0"
          aria-label="Spend 5"
          @click="adjust('spend', 5)"
        >
          −5
        </button>
        <button
          type="button"
          data-testid="pool-spend-1"
          class="pool-btn"
          :disabled="current === 0"
          aria-label="Spend 1"
          @click="adjust('spend', 1)"
        >
          −1
        </button>
        <span data-testid="pool-value" class="mx-1 font-display text-lg tabular-nums leading-none">
          {{ current }}<span class="text-sm text-faded">/{{ resource.max_value }}</span>
        </span>
        <button
          type="button"
          data-testid="pool-restore-1"
          class="pool-btn"
          :disabled="current === resource.max_value"
          aria-label="Restore 1"
          @click="adjust('restore', 1)"
        >
          +1
        </button>
        <button
          v-if="isBigPool"
          type="button"
          data-testid="pool-restore-5"
          class="pool-btn"
          :disabled="current === resource.max_value"
          aria-label="Restore 5"
          @click="adjust('restore', 5)"
        >
          +5
        </button>
      </div>
      <div class="mt-1 h-1 w-full overflow-hidden rounded-full bg-edge">
        <div
          class="h-full transition-[width] duration-150 motion-reduce:transition-none"
          :class="meta.bar"
          :style="{ width: percent + '%' }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "../style.css";
.pool-btn {
  @apply rounded border border-edge px-1.5 py-0.5 text-xs text-faded transition-colors duration-100
    hover:border-faded hover:text-parchment focus-visible:outline focus-visible:outline-2
    focus-visible:outline-parchment disabled:cursor-not-allowed disabled:opacity-40
    motion-reduce:transition-none;
}
.stepper-btn {
  @apply h-5 w-5 rounded-md border border-edge text-sm leading-none text-faded transition-colors
    duration-100 hover:border-tonic hover:text-tonic focus-visible:outline focus-visible:outline-2
    focus-visible:outline-tonic disabled:cursor-not-allowed disabled:opacity-40
    motion-reduce:transition-none;
}
</style>
