<script setup>
import { computed } from 'vue';
import ResourceRow from './ResourceRow.vue';
import { CATEGORY_ORDER, CATEGORY_META } from '../categories.js';

const props = defineProps({
  character: { type: Object, required: true },
});
defineEmits(['resource-updated', 'resource-error']);

/**
 * Class/subclass flavor: a hue and an emblem per character so cards read at a
 * glance across the table. Matched against "subclass class" so characters
 * without a subclass (Monk, Artificer) still get their emblem. Literal class
 * strings — Tailwind's scanner needs them.
 */
const CLASS_ACCENTS = [
  { match: /twilight/i, text: 'text-arcane', line: 'bg-arcane/60', emblem: 'moon' },
  { match: /tempest|storm/i, text: 'text-tonic', line: 'bg-tonic/60', emblem: 'bolt' },
  { match: /lycan|blood hunter/i, text: 'text-blood', line: 'bg-blood/60', emblem: 'paw' },
  { match: /monk/i, text: 'text-vitality', line: 'bg-vitality/60', emblem: 'yinyang' },
  { match: /artificer/i, text: 'text-ember', line: 'bg-ember/60', emblem: 'gear' },
];
const DEFAULT_ACCENT = { text: 'text-ember', line: 'bg-ember/60', emblem: 'shield' };

const accent = computed(() => {
  const flavor = `${props.character.subclass ?? ''} ${props.character.class}`;
  return CLASS_ACCENTS.find((a) => a.match.test(flavor)) ?? DEFAULT_ACCENT;
});

/**
 * The API returns rows ordered by (sort_order, id), which interleaves
 * categories. Regroup client-side: one section per category, in a fixed
 * order, sorted by sort_order within each — so the five slot rows sit
 * together under "Spellcasting" and features under "Class features".
 */
const groups = computed(() =>
  CATEGORY_ORDER.map((category) => ({
    category,
    meta: CATEGORY_META[category],
    resources: props.character.resources
      .filter((r) => r.category === category)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
  })).filter((g) => g.resources.length > 0)
);

const hpPercent = computed(() =>
  props.character.max_hp === 0 ? 0 : Math.round((props.character.current_hp / props.character.max_hp) * 100)
);

/** HP bar drains from green through amber to red — legible from across the table. */
const hpBar = computed(() =>
  hpPercent.value > 50 ? 'bg-vitality' : hpPercent.value > 25 ? 'bg-ember' : 'bg-blood'
);
</script>

<template>
  <article
    class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-edge bg-card shadow-[0_1px_8px_rgba(0,0,0,0.35)]"
    :aria-label="character.name"
  >
    <!-- Subclass accent line -->
    <div class="h-0.5 w-full" :class="accent.line" aria-hidden="true" />

    <div class="flex min-w-0 flex-col p-3">
      <!-- Header -->
      <header class="min-w-0">
        <div class="flex items-baseline justify-between gap-2">
          <h2 class="flex min-w-0 items-baseline gap-1.5 break-words font-display text-xl leading-tight">
            <svg
              viewBox="0 0 16 16"
              class="h-3.5 w-3.5 shrink-0 self-center"
              :class="accent.text"
              aria-hidden="true"
            >
              <!-- crescent moon -->
              <path
                v-if="accent.emblem === 'moon'"
                d="M10.5 1.5a6.5 6.5 0 1 0 4 11.9A7.5 7.5 0 0 1 10.5 1.5Z"
                fill="currentColor"
              />
              <!-- lightning bolt -->
              <path
                v-else-if="accent.emblem === 'bolt'"
                d="M9.5 1 3 9.5h3.5L6 15l6.5-8.5H9L9.5 1Z"
                fill="currentColor"
              />
              <!-- wolf paw print -->
              <path
                v-else-if="accent.emblem === 'paw'"
                d="M8 7.2c2 0 4.4 2.1 4.4 4.3 0 1.2-.8 2-2 2-.9 0-1.6-.5-2.4-.5s-1.5.5-2.4.5c-1.2 0-2-.8-2-2C3.6 9.3 6 7.2 8 7.2Z M2.9 6.2a1.6 1.9 0 1 0 0 3.8 1.6 1.9 0 0 0 0-3.8Z M13.1 6.2a1.6 1.9 0 1 0 0 3.8 1.6 1.9 0 0 0 0-3.8Z M5.7 2.2a1.7 2 0 1 0 0 4 1.7 2 0 0 0 0-4Z M10.3 2.2a1.7 2 0 1 0 0 4 1.7 2 0 0 0 0-4Z"
                fill="currentColor"
              />
              <!-- yin-yang (ki) -->
              <path
                v-else-if="accent.emblem === 'yinyang'"
                d="M8 .5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm0 1.2a6.3 6.3 0 0 1 0 12.6A3.15 3.15 0 0 1 8 8a3.15 3.15 0 0 0 0-6.3Zm0 3.4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm0 5.8a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
                fill="currentColor"
                fill-rule="evenodd"
              />
              <!-- gear -->
              <path
                v-else-if="accent.emblem === 'gear'"
                d="M6.69 2.56 6.66.52h2.68l-.03 2.04 1.61.66 1.43-1.46 1.89 1.89-1.46 1.43.66 1.61 2.04-.03v2.68l-2.04-.03-.66 1.61 1.46 1.43-1.89 1.89-1.43-1.46-1.61.66.03 2.04H6.66l.03-2.04-1.61-.66-1.43 1.46-1.89-1.89 1.46-1.43-.66-1.61-2.04.03V6.66l2.04.03.66-1.61-1.46-1.43 1.89-1.89 1.43 1.46 1.61-.66Z M10.4 8a2.4 2.4 0 1 0-4.8 0 2.4 2.4 0 1 0 4.8 0Z"
                fill="currentColor"
                fill-rule="evenodd"
              />
              <!-- shield -->
              <path
                v-else
                d="M8 1 2.5 3v5c0 3.5 2.3 5.9 5.5 7 3.2-1.1 5.5-3.5 5.5-7V3L8 1Z"
                fill="currentColor"
              />
            </svg>
            <span class="min-w-0 break-words">{{ character.name }}</span>
          </h2>
          <span class="shrink-0 text-xs text-faded">Lv {{ character.level }}</span>
        </div>
        <p class="mt-0.5 min-w-0 break-words text-xs text-faded">
          <template v-if="character.subclass"
            ><span :class="accent.text">{{ character.subclass }}</span> · </template
          >{{ character.class }}
        </p>
        <div class="mt-2 flex items-center gap-2">
          <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-edge">
            <div
              class="h-full transition-[width] duration-150 motion-reduce:transition-none"
              :class="hpBar"
              :style="{ width: hpPercent + '%' }"
            />
          </div>
          <span class="shrink-0 text-xs tabular-nums text-faded"
            >{{ character.current_hp }}/{{ character.max_hp }} HP</span
          >
        </div>
      </header>

      <!-- Resource groups -->
      <div class="mt-2.5 flex min-w-0 flex-col gap-2">
        <section v-for="group in groups" :key="group.category" class="min-w-0">
          <div class="mb-1 flex items-center gap-2">
            <h3
              class="shrink-0 text-[10px] font-semibold uppercase tracking-[0.15em]"
              :class="group.meta.text"
            >
              {{ group.meta.label }}
            </h3>
            <div class="h-px min-w-0 flex-1 bg-edge" />
          </div>
          <div class="flex min-w-0 flex-col gap-1.5">
            <ResourceRow
              v-for="resource in group.resources"
              :key="resource.id"
              :resource="resource"
              @updated="$emit('resource-updated', $event)"
              @error="$emit('resource-error', $event)"
            />
          </div>
        </section>
      </div>
    </div>
  </article>
</template>
