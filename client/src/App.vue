<script setup>
import { ref, reactive, onMounted } from 'vue';
import CharacterCard from './components/CharacterCard.vue';
import CombatHudCard from './components/CombatHudCard.vue';
import TreasuryPanel from './components/TreasuryPanel.vue';
import ManagementPanel from './components/ManagementPanel.vue';
import { fetchCharacters, fetchLoot, fetchCurrency, triggerRest } from './api.js';

// Combat HUD leads: it's the mid-session view, so it's first and the default.
const TABS = [
  { id: 'hud', label: 'Combat HUD' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'treasury', label: 'Treasury' },
];
const activeTab = ref('hud');

const characters = ref([]);
const loot = ref([]);
const currency = ref({ platinum: 0, gold: 0, electrum: 0, silver: 0, copper: 0 });

/**
 * Treasury view state lives HERE, not in LootTable — tabs render with v-if,
 * so component-local state would reset on every tab switch. App owns it for
 * the same reason it owns `characters`: the view must survive unmounts.
 */
const lootView = reactive({ search: '', sortKey: 'name', sortDir: 'asc', page: 1, pageSize: 10 });
const loading = ref(true);
const loadError = ref(null);
const resting = ref(false);
const toasts = ref([]);
let toastSeq = 0;

function pushToast(message, tone = 'error') {
  const id = ++toastSeq;
  toasts.value.push({ id, message, tone });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, 4000);
}

async function load() {
  loading.value = true;
  loadError.value = null;
  try {
    [characters.value, loot.value, currency.value] = await Promise.all([
      fetchCharacters(),
      fetchLoot(),
      fetchCurrency(),
    ]);
  } catch (err) {
    loadError.value = err.message;
  } finally {
    loading.value = false;
  }
}

/** Merge a server-confirmed character row (HP, hit dice...) back into party state. */
function onCharacterUpdated(row) {
  const i = characters.value.findIndex((c) => c.id === row.id);
  if (i !== -1) characters.value[i] = { ...characters.value[i], ...row }; // keeps nested resources
}

/** Merge a server-confirmed resource row back into party state. */
function onResourceUpdated(row) {
  const character = characters.value.find((c) => c.id === row.character_id);
  if (!character) return;
  const i = character.resources.findIndex((r) => r.id === row.id);
  if (i !== -1) character.resources[i] = { ...character.resources[i], ...row };
}

function onResourceError(message) {
  pushToast(message, 'error');
}

/* Treasury mutations: the panel talks to the API; App keeps the source of truth. */
function onLootCreated(row) {
  loot.value.push(row);
}
function onLootUpdated(row) {
  const i = loot.value.findIndex((l) => l.id === row.id);
  if (i !== -1) loot.value[i] = row;
}
function onLootRemoved(id) {
  loot.value = loot.value.filter((l) => l.id !== id);
}
function onCurrencyUpdated(purse) {
  currency.value = purse;
}

async function onRest(type) {
  resting.value = true;
  try {
    const result = await triggerRest(type);
    characters.value = result.characters; // full refreshed party in one round trip
    pushToast(
      `${type === 'long_rest' ? 'Long' : 'Short'} rest complete — ${result.refreshed} resources refreshed`,
      'success'
    );
  } catch (err) {
    pushToast(`Rest failed: ${err.message}`, 'error');
  } finally {
    resting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="mx-auto min-h-screen max-w-[1900px] px-4 py-4">
    <header class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="font-display text-2xl leading-none tracking-wide">Party Ledger</h1>
        <p class="mt-1 text-xs text-faded">Local resource tracker · party.db</p>
      </div>
      <ManagementPanel :busy="resting" @rest="onRest" />
    </header>

    <!-- Tab bar: one dashboard, two lenses on the same party state -->
    <nav class="mb-4 flex gap-1 border-b border-edge" role="tablist" aria-label="Views">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        role="tab"
        :data-testid="`tab-${tab.id}`"
        :aria-selected="activeTab === tab.id"
        class="-mb-px rounded-t border-b-2 px-4 py-2 text-sm transition-colors duration-100 motion-reduce:transition-none"
        :class="
          activeTab === tab.id
            ? 'border-ember font-semibold text-parchment'
            : 'border-transparent text-faded hover:text-parchment'
        "
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </nav>

    <main>
      <p v-if="loading" class="py-16 text-center text-sm text-faded">Consulting the ledger…</p>

      <div v-else-if="loadError" class="py-16 text-center text-sm">
        <p class="text-ember">Could not reach the server: {{ loadError }}</p>
        <p class="mt-1 text-faded">Start it with <code>npm run dev --workspace server</code>, then</p>
        <button
          type="button"
          class="mt-3 rounded border border-edge px-3 py-1.5 text-sm hover:border-faded"
          @click="load"
        >
          Retry
        </button>
      </div>

      <!-- Treasury doesn't need characters, so it sits above the empty-party guard. -->
      <TreasuryPanel
        v-else-if="activeTab === 'treasury'"
        :loot="loot"
        :currency="currency"
        :characters="characters"
        :view="lootView"
        @loot-created="onLootCreated"
        @loot-updated="onLootUpdated"
        @loot-removed="onLootRemoved"
        @currency-updated="onCurrencyUpdated"
        @error="onResourceError"
      />

      <p v-else-if="characters.length === 0" class="py-16 text-center text-sm text-faded">
        The ledger is empty — add characters to party.db to begin tracking.
      </p>

      <!--
        auto-fit/minmax grid: at 1920px this resolves to exactly 5 columns
        (5 x 340px + gaps < 1824px of content width), collapsing gracefully
        to 4/3/2/1 on narrower screens with no pagination or routing.
        v-if (not v-show) so only the active tab's cards exist in the DOM.
      -->
      <div
        v-else-if="activeTab === 'ledger'"
        class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(340px,1fr))]"
      >
        <CharacterCard
          v-for="character in characters"
          :key="character.id"
          :character="character"
          @resource-updated="onResourceUpdated"
          @resource-error="onResourceError"
        />
      </div>

      <div v-else class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(340px,1fr))]">
        <CombatHudCard
          v-for="character in characters"
          :key="character.id"
          :character="character"
          @character-updated="onCharacterUpdated"
          @resource-updated="onResourceUpdated"
          @resource-error="onResourceError"
        />
      </div>
    </main>

    <!-- Toasts -->
    <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto rounded border px-3 py-2 text-sm shadow-lg"
        :class="
          toast.tone === 'success'
            ? 'border-vitality/40 bg-card text-vitality'
            : 'border-ember/40 bg-card text-ember'
        "
        role="status"
      >
        {{ toast.message }}
      </div>
    </div>
  </div>
</template>
