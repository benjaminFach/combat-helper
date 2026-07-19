<script setup>
import { computed, watch } from 'vue';
import { LOOT_COLUMNS, PAGE_SIZES, holderName, valueText, filterLoot, sortLoot, paginate } from '../lootTable.js';

const props = defineProps({
  loot: { type: Array, required: true },
  /**
   * View state (search/sortKey/sortDir/page/pageSize) is OWNED BY App and
   * mutated in place here — the same pattern that keeps Ledger charges alive
   * across tab switches. The component can unmount freely; the view state
   * survives until the page reloads.
   */
  view: { type: Object, required: true },
});

/** Row actions bubble up — TreasuryPanel owns the modals and the API calls. */
defineEmits(['add', 'sell', 'remove']);

const filtered = computed(() => filterLoot(props.loot, props.view.search));
const sorted = computed(() => sortLoot(filtered.value, props.view.sortKey, props.view.sortDir));
const pageData = computed(() => paginate(sorted.value, props.view.page, props.view.pageSize));

/** Narrowing or changing a search always restarts from the first page. */
watch(
  () => props.view.search,
  () => (props.view.page = 1)
);

/** Click a header: same column flips direction, a new column sorts ascending. */
function sortBy(key) {
  if (props.view.sortKey === key) {
    props.view.sortDir = props.view.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    props.view.sortKey = key;
    props.view.sortDir = 'asc';
  }
}

function setPageSize(event) {
  props.view.pageSize = Number(event.target.value);
  props.view.page = 1; // page boundaries moved; restart from the top
}

const goTo = (page) => (props.view.page = Math.min(Math.max(1, page), pageData.value.totalPages));

const ariaSort = (key) =>
  props.view.sortKey !== key ? 'none' : props.view.sortDir === 'asc' ? 'ascending' : 'descending';
</script>

<template>
  <section
    data-testid="loot-table"
    class="rounded-lg border border-edge bg-card p-3 shadow-[0_1px_8px_rgba(0,0,0,0.35)]"
    aria-label="Party treasury"
  >
    <!-- Title + add button, search top right -->
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <span class="flex items-center gap-3">
        <h2 class="font-display text-xl leading-none">Treasury</h2>
        <button
          type="button"
          data-testid="loot-add"
          class="rounded border border-ember/50 px-2.5 py-1 text-xs font-semibold uppercase
            tracking-[0.12em] text-ember transition-colors duration-100 hover:border-ember
            hover:bg-ember/10 focus-visible:outline focus-visible:outline-2
            focus-visible:outline-ember motion-reduce:transition-none"
          @click="$emit('add')"
        >
          + Add item
        </button>
      </span>
      <input
        data-testid="loot-search"
        :value="view.search"
        type="search"
        placeholder="Search loot…"
        aria-label="Search loot"
        class="w-56 rounded border border-edge bg-ink/40 px-2 py-1 text-sm placeholder:text-faded/70
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-parchment"
        @input="view.search = $event.target.value"
      />
    </div>

    <!-- The wide part scrolls inside the card; the page never scrolls sideways -->
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-edge">
            <th
              v-for="col in LOOT_COLUMNS"
              :key="col.key"
              scope="col"
              :aria-sort="ariaSort(col.key)"
              class="p-0 text-left"
              :class="['value', 'quantity'].includes(col.key) ? 'text-right' : ''"
            >
              <button
                type="button"
                :data-testid="`loot-sort-${col.key}`"
                class="flex w-full items-center gap-1 px-2 py-1.5 text-[10px] font-semibold uppercase
                  tracking-[0.15em] text-faded transition-colors duration-100 hover:text-parchment
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-parchment
                  motion-reduce:transition-none"
                :class="[
                  view.sortKey === col.key ? 'text-ember' : '',
                  ['value', 'quantity'].includes(col.key) ? 'justify-end' : '',
                ]"
                @click="sortBy(col.key)"
              >
                {{ col.label }}
                <span aria-hidden="true" class="text-[9px]">
                  {{ view.sortKey === col.key ? (view.sortDir === 'asc' ? '▲' : '▼') : '' }}
                </span>
              </button>
            </th>
            <th scope="col" class="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-[0.15em] text-faded">
              <span class="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in pageData.rows"
            :key="item.id"
            data-testid="loot-row"
            class="border-b border-edge/50 last:border-b-0"
          >
            <td class="px-2 py-1.5 align-top">{{ item.name }}</td>
            <td class="px-2 py-1.5 align-top text-[11px] leading-snug text-faded/90">
              {{ item.description }}
            </td>
            <td class="px-2 py-1.5 align-top" :class="item.character_name ? '' : 'text-faded'">
              {{ holderName(item) }}
            </td>
            <td class="px-2 py-1.5 text-right align-top tabular-nums">{{ item.quantity }}</td>
            <td class="px-2 py-1.5 text-right align-top tabular-nums">
              {{ valueText(item) }}
              <span v-if="item.quantity > 1" class="block text-[10px] leading-tight text-faded"
                >{{ item.value_gp }} gp ea</span
              >
            </td>
            <td class="px-2 py-1.5 text-right align-top">
              <span class="flex justify-end gap-1">
                <button
                  type="button"
                  data-testid="loot-sell"
                  class="row-btn text-tonic hover:border-tonic"
                  :aria-label="`Sell ${item.name}`"
                  @click="$emit('sell', item)"
                >
                  Sell
                </button>
                <button
                  type="button"
                  data-testid="loot-remove"
                  class="row-btn text-blood hover:border-blood"
                  :aria-label="`Remove ${item.name}`"
                  @click="$emit('remove', item)"
                >
                  Remove
                </button>
              </span>
            </td>
          </tr>

          <!-- Empty states: a bare vault vs. a search with no matches -->
          <tr v-if="pageData.total === 0">
            <td data-testid="loot-empty" :colspan="LOOT_COLUMNS.length + 1" class="px-2 py-8 text-center text-sm text-faded">
              <template v-if="view.search.trim()"
                >No loot matches “{{ view.search.trim() }}”.</template
              >
              <template v-else>The vault is empty — the party owns nothing but debts.</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Footer: range summary, page size, pager -->
    <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-faded">
      <span data-testid="loot-range" class="tabular-nums">
        Showing {{ pageData.start }}–{{ pageData.end }} of {{ pageData.total }}
      </span>
      <span class="flex items-center gap-3">
        <label class="flex items-center gap-1.5">
          Per page
          <select
            data-testid="loot-page-size"
            :value="view.pageSize"
            class="rounded border border-edge bg-ink/40 px-1.5 py-0.5 text-xs
              focus-visible:outline focus-visible:outline-2 focus-visible:outline-parchment"
            @change="setPageSize"
          >
            <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
          </select>
        </label>
        <span class="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="loot-prev"
            class="pager-btn"
            :disabled="pageData.page === 1"
            aria-label="Previous page"
            @click="goTo(pageData.page - 1)"
          >
            ‹
          </button>
          <span data-testid="loot-page-info" class="tabular-nums"
            >Page {{ pageData.page }} of {{ pageData.totalPages }}</span
          >
          <button
            type="button"
            data-testid="loot-next"
            class="pager-btn"
            :disabled="pageData.page === pageData.totalPages"
            aria-label="Next page"
            @click="goTo(pageData.page + 1)"
          >
            ›
          </button>
        </span>
      </span>
    </div>
  </section>
</template>

<style scoped>
@reference "../style.css";
.row-btn {
  @apply rounded border border-edge px-1.5 py-0.5 text-[10px] font-semibold uppercase
    tracking-[0.12em] transition-colors duration-100 focus-visible:outline
    focus-visible:outline-2 focus-visible:outline-parchment motion-reduce:transition-none;
}
.pager-btn {
  @apply rounded border border-edge px-2 py-0.5 text-sm leading-none text-faded transition-colors
    duration-100 hover:border-faded hover:text-parchment focus-visible:outline
    focus-visible:outline-2 focus-visible:outline-parchment disabled:cursor-not-allowed
    disabled:opacity-40 motion-reduce:transition-none;
}
</style>
