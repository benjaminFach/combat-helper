<script setup>
import { computed, reactive, ref } from 'vue';
import LootTable from './LootTable.vue';
import { DENOMINATIONS } from '../lootTable.js';
import { createLoot, deleteLoot, sellLoot, updateCurrency } from '../api.js';

const props = defineProps({
  loot: { type: Array, required: true },
  currency: { type: Object, required: true },
  characters: { type: Array, required: true },
  view: { type: Object, required: true },
});
const emit = defineEmits([
  'loot-created',
  'loot-removed',
  'loot-updated',
  'currency-updated',
  'error',
]);

/** One modal at a time: null | {type:'add'} | {type:'remove'|'sell', item}. */
const modal = ref(null);
const busy = ref(false);

/* ---------------------------------------------------------------- add --- */

const blankAddForm = () => ({ name: '', description: '', holder: '', value_gp: '0', quantity: '1' });
const addForm = reactive(blankAddForm());

/** A whole number >= min, or null. Number inputs hand us strings. */
function parseIntField(raw, min) {
  const n = Number(raw);
  return String(raw).trim() !== '' && Number.isInteger(n) && n >= min ? n : null;
}

/**
 * Validation mirrors the backend rules exactly: non-blank name, description,
 * and holder; unit value a whole number >= 0; quantity a whole number >= 1.
 */
const addErrors = computed(() => {
  const errors = [];
  if (addForm.name.trim() === '') errors.push('Item name is required.');
  if (addForm.description.trim() === '') errors.push('Description is required.');
  if (addForm.holder === '') errors.push('Choose who holds the item.');
  if (parseIntField(addForm.value_gp, 0) === null)
    errors.push('Unit value must be a whole number of 0 or more.');
  if (parseIntField(addForm.quantity, 1) === null)
    errors.push('Quantity must be a whole number of 1 or more.');
  return errors;
});

function openAdd() {
  Object.assign(addForm, blankAddForm());
  modal.value = { type: 'add' };
}

async function confirmAdd() {
  if (addErrors.value.length > 0 || busy.value) return;
  busy.value = true;
  try {
    const created = await createLoot({
      name: addForm.name.trim(),
      description: addForm.description.trim(),
      character_id: addForm.holder === 'party' ? null : Number(addForm.holder),
      value_gp: parseIntField(addForm.value_gp, 0),
      quantity: parseIntField(addForm.quantity, 1),
    });
    emit('loot-created', created);
    modal.value = null;
  } catch (err) {
    emit('error', `Add item: ${err.message}`); // modal stays open for a retry
  } finally {
    busy.value = false;
  }
}

/* ----------------------------------------------------------- currency --- */

/** Pending purse edits, as strings (inputs are typeable as well as steppable). */
const currencyForm = reactive({});

function openCurrency() {
  for (const denom of DENOMINATIONS) {
    currencyForm[denom.key] = String(props.currency[denom.key]);
  }
  modal.value = { type: 'currency' };
}

/** Step one denomination by ±1; never below 0 (the − button also disables there). */
function stepCurrency(key, delta) {
  const current = parseIntField(currencyForm[key], 0) ?? 0;
  currencyForm[key] = String(Math.max(0, current + delta));
}

const currencyErrors = computed(() => {
  if (modal.value?.type !== 'currency') return [];
  const errors = [];
  for (const denom of DENOMINATIONS) {
    if (parseIntField(currencyForm[denom.key], 0) === null) {
      errors.push(`${denom.label} must be a whole number of 0 or more.`);
    }
  }
  return errors;
});

async function confirmCurrency() {
  if (currencyErrors.value.length > 0 || busy.value) return;
  busy.value = true;
  try {
    const updated = await updateCurrency(
      Object.fromEntries(
        DENOMINATIONS.map((denom) => [denom.key, parseIntField(currencyForm[denom.key], 0)])
      )
    );
    emit('currency-updated', updated);
    modal.value = null;
  } catch (err) {
    emit('error', `Modify currency: ${err.message}`);
  } finally {
    busy.value = false;
  }
}

/* ------------------------------------------------------------- remove --- */

async function confirmRemove() {
  if (busy.value) return;
  busy.value = true;
  try {
    await deleteLoot(modal.value.item.id);
    emit('loot-removed', modal.value.item.id);
    modal.value = null;
  } catch (err) {
    emit('error', `Remove item: ${err.message}`);
  } finally {
    busy.value = false;
  }
}

/* --------------------------------------------------------------- sell --- */

const blankProceeds = () =>
  Object.fromEntries(DENOMINATIONS.map((denom) => [denom.key, '']));
const sellForm = reactive({ quantity: '1', proceeds: blankProceeds() });

function openSell(item) {
  Object.assign(sellForm, { quantity: '1', proceeds: blankProceeds() });
  modal.value = { type: 'sell', item };
}

/** A proceeds field left blank means 0 of that coin. */
const parseAmount = (raw) => (String(raw).trim() === '' ? 0 : parseIntField(raw, 0));

const sellErrors = computed(() => {
  if (modal.value?.type !== 'sell') return [];
  const errors = [];
  const quantity = parseIntField(sellForm.quantity, 1);
  if (quantity === null) errors.push('Quantity must be a whole number of 1 or more.');
  else if (quantity > modal.value.item.quantity)
    errors.push(`Cannot sell more than you have (${modal.value.item.quantity}).`);
  for (const denom of DENOMINATIONS) {
    if (parseAmount(sellForm.proceeds[denom.key]) === null) {
      errors.push(`${denom.label} amount must be a whole number of 0 or more.`);
    }
  }
  return errors;
});

async function confirmSell() {
  if (sellErrors.value.length > 0 || busy.value) return;
  busy.value = true;
  const { item } = modal.value;
  try {
    const result = await sellLoot(item.id, {
      quantity: parseIntField(sellForm.quantity, 1),
      proceeds: Object.fromEntries(
        DENOMINATIONS.map((denom) => [denom.key, parseAmount(sellForm.proceeds[denom.key])])
      ),
    });
    if (result.loot === null) emit('loot-removed', item.id);
    else emit('loot-updated', result.loot);
    emit('currency-updated', result.currency);
    modal.value = null;
  } catch (err) {
    emit('error', `Sell item: ${err.message}`);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <!-- Party purse: the five 5e denominations, highest to lowest -->
    <div
      data-testid="currency-bar"
      class="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-card px-3 py-2"
      aria-label="Party currency"
    >
      <span class="text-[10px] font-semibold uppercase tracking-[0.15em] text-faded">Party purse</span>
      <span
        v-for="denom in DENOMINATIONS"
        :key="denom.key"
        class="rounded-full border border-edge bg-ink/40 px-2 py-0.5 text-xs tabular-nums"
        :title="denom.label"
      >
        <span :data-testid="`currency-${denom.key}`" class="font-display">{{
          currency[denom.key]
        }}</span>
        <span class="ml-1 text-faded">{{ denom.abbr }}</span>
      </span>
      <button
        type="button"
        data-testid="currency-modify"
        class="ml-auto rounded border border-edge px-2 py-0.5 text-[10px] font-semibold uppercase
          tracking-[0.12em] text-faded transition-colors duration-100 hover:border-faded
          hover:text-parchment focus-visible:outline focus-visible:outline-2
          focus-visible:outline-parchment motion-reduce:transition-none"
        @click="openCurrency"
      >
        Modify
      </button>
    </div>

    <LootTable
      :loot="loot"
      :view="view"
      @add="openAdd"
      @sell="openSell($event)"
      @remove="modal = { type: 'remove', item: $event }"
    />

    <!-- Modal overlay: one dialog at a time, Cancel always available -->
    <div
      v-if="modal"
      class="fixed inset-0 z-40 flex items-center justify-center bg-ink/80 p-4"
    >
      <!-- Add item -->
      <div
        v-if="modal.type === 'add'"
        data-testid="modal-add"
        role="dialog"
        aria-modal="true"
        aria-label="Add loot item"
        class="w-full max-w-md rounded-lg border border-edge bg-card p-4 shadow-[0_4px_24px_rgba(0,0,0,0.6)]"
      >
        <h3 class="font-display text-lg">Add loot</h3>
        <div class="mt-3 flex flex-col gap-2.5">
          <label class="modal-label">
            Name
            <input v-model="addForm.name" data-testid="add-name" type="text" class="modal-input" placeholder="Sunblade" />
          </label>
          <label class="modal-label">
            Description
            <textarea v-model="addForm.description" data-testid="add-description" rows="2" class="modal-input" placeholder="What it is, what it does…" />
          </label>
          <label class="modal-label">
            Held by
            <select v-model="addForm.holder" data-testid="add-holder" class="modal-input">
              <option value="" disabled>— choose a holder —</option>
              <option value="party">Party</option>
              <option v-for="c in characters" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
            </select>
          </label>
          <div class="flex gap-2.5">
            <label class="modal-label flex-1">
              Unit value (gp)
              <input v-model="addForm.value_gp" data-testid="add-value" type="number" min="0" step="1" class="modal-input" />
            </label>
            <label class="modal-label flex-1">
              Quantity
              <input v-model="addForm.quantity" data-testid="add-quantity" type="number" min="1" step="1" class="modal-input" />
            </label>
          </div>
        </div>

        <ul v-if="addErrors.length" data-testid="add-errors" class="mt-3 flex flex-col gap-0.5 text-xs text-blood">
          <li v-for="error in addErrors" :key="error">{{ error }}</li>
        </ul>

        <div class="mt-4 flex justify-end gap-2">
          <button type="button" data-testid="add-cancel" class="modal-btn" @click="modal = null">Cancel</button>
          <button
            type="button"
            data-testid="add-confirm"
            class="modal-btn border-ember/60 text-ember hover:border-ember"
            :disabled="addErrors.length > 0 || busy"
            @click="confirmAdd"
          >
            Add to treasury
          </button>
        </div>
      </div>

      <!-- Modify currency -->
      <div
        v-else-if="modal.type === 'currency'"
        data-testid="modal-currency"
        role="dialog"
        aria-modal="true"
        aria-label="Modify party currency"
        class="w-full max-w-md rounded-lg border border-edge bg-card p-4 shadow-[0_4px_24px_rgba(0,0,0,0.6)]"
      >
        <h3 class="font-display text-lg">Modify party currency</h3>
        <p class="mt-1 text-xs text-faded">
          Adjust each coin with − / + (or type a value). No denomination can go below 0.
        </p>
        <div class="mt-3 flex flex-col gap-2">
          <div
            v-for="denom in DENOMINATIONS"
            :key="denom.key"
            class="flex items-center justify-between gap-2"
          >
            <span class="text-[10px] font-semibold uppercase tracking-[0.15em] text-faded">
              {{ denom.label }}
            </span>
            <span class="flex items-center gap-1.5">
              <button
                type="button"
                :data-testid="`currency-dec-${denom.key}`"
                class="modal-btn px-2.5 py-0.5 text-base leading-none"
                :disabled="(parseIntField(currencyForm[denom.key], 0) ?? 0) <= 0"
                :aria-label="`Decrease ${denom.label}`"
                @click="stepCurrency(denom.key, -1)"
              >
                −
              </button>
              <input
                v-model="currencyForm[denom.key]"
                :data-testid="`currency-input-${denom.key}`"
                type="number"
                min="0"
                step="1"
                class="modal-input w-24 text-center tabular-nums"
                :aria-label="`${denom.label} total`"
              />
              <button
                type="button"
                :data-testid="`currency-inc-${denom.key}`"
                class="modal-btn px-2.5 py-0.5 text-base leading-none"
                :aria-label="`Increase ${denom.label}`"
                @click="stepCurrency(denom.key, 1)"
              >
                +
              </button>
            </span>
          </div>
        </div>

        <ul v-if="currencyErrors.length" data-testid="currency-errors" class="mt-3 flex flex-col gap-0.5 text-xs text-blood">
          <li v-for="error in currencyErrors" :key="error">{{ error }}</li>
        </ul>

        <div class="mt-4 flex justify-end gap-2">
          <button type="button" data-testid="currency-cancel" class="modal-btn" @click="modal = null">Cancel</button>
          <button
            type="button"
            data-testid="currency-confirm"
            class="modal-btn border-ember/60 text-ember hover:border-ember"
            :disabled="currencyErrors.length > 0 || busy"
            @click="confirmCurrency"
          >
            Save
          </button>
        </div>
      </div>

      <!-- Remove confirmation -->
      <div
        v-else-if="modal.type === 'remove'"
        data-testid="modal-remove"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm removal"
        class="w-full max-w-sm rounded-lg border border-edge bg-card p-4 shadow-[0_4px_24px_rgba(0,0,0,0.6)]"
      >
        <h3 class="font-display text-lg">Remove {{ modal.item.name }}?</h3>
        <p class="mt-2 text-sm text-faded">
          This discards
          <template v-if="modal.item.quantity > 1">all {{ modal.item.quantity }} of them</template>
          <template v-else>it</template>
          with no payment — it cannot be undone.
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" data-testid="remove-cancel" class="modal-btn" @click="modal = null">Cancel</button>
          <button
            type="button"
            data-testid="remove-confirm"
            class="modal-btn border-blood/60 text-blood hover:border-blood"
            :disabled="busy"
            @click="confirmRemove"
          >
            Remove
          </button>
        </div>
      </div>

      <!-- Sell -->
      <div
        v-else-if="modal.type === 'sell'"
        data-testid="modal-sell"
        role="dialog"
        aria-modal="true"
        aria-label="Sell loot item"
        class="w-full max-w-md rounded-lg border border-edge bg-card p-4 shadow-[0_4px_24px_rgba(0,0,0,0.6)]"
      >
        <h3 class="font-display text-lg">Sell {{ modal.item.name }}</h3>
        <p class="mt-1 text-xs text-faded">
          You have {{ modal.item.quantity }} at {{ modal.item.value_gp }} gp each. The sale price is
          the total for the whole sale, not per unit — split it across any mix of coins
          (blank means none of that coin).
        </p>
        <div class="mt-3 flex flex-col gap-2.5">
          <label class="modal-label">
            Quantity to sell
            <input
              v-model="sellForm.quantity"
              data-testid="sell-quantity"
              type="number"
              min="1"
              :max="modal.item.quantity"
              step="1"
              class="modal-input"
            />
          </label>
          <fieldset class="modal-label border-0 p-0">
            <legend class="mb-1">Sale total, by coin</legend>
            <div class="grid grid-cols-5 gap-1.5">
              <label
                v-for="denom in DENOMINATIONS"
                :key="denom.key"
                class="flex flex-col gap-1 text-center text-[9px] font-semibold uppercase tracking-[0.12em] text-faded"
              >
                <input
                  v-model="sellForm.proceeds[denom.key]"
                  :data-testid="`sell-amount-${denom.key}`"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  class="modal-input px-1.5 text-center"
                  :aria-label="`${denom.label} amount`"
                />
                {{ denom.abbr }}
              </label>
            </div>
          </fieldset>
        </div>

        <ul v-if="sellErrors.length" data-testid="sell-errors" class="mt-3 flex flex-col gap-0.5 text-xs text-blood">
          <li v-for="error in sellErrors" :key="error">{{ error }}</li>
        </ul>

        <div class="mt-4 flex justify-end gap-2">
          <button type="button" data-testid="sell-cancel" class="modal-btn" @click="modal = null">Cancel</button>
          <button
            type="button"
            data-testid="sell-confirm"
            class="modal-btn border-tonic/60 text-tonic hover:border-tonic"
            :disabled="sellErrors.length > 0 || busy"
            @click="confirmSell"
          >
            Sell
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "../style.css";
.modal-label {
  @apply flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-faded;
}
.modal-input {
  @apply rounded border border-edge bg-ink/40 px-2 py-1.5 text-sm normal-case tracking-normal
    text-parchment placeholder:text-faded/50 focus-visible:outline focus-visible:outline-2
    focus-visible:outline-parchment;
}
.modal-btn {
  @apply rounded border border-edge px-3 py-1.5 text-sm text-faded transition-colors duration-100
    hover:border-faded hover:text-parchment focus-visible:outline focus-visible:outline-2
    focus-visible:outline-parchment disabled:cursor-not-allowed disabled:opacity-40
    motion-reduce:transition-none;
}
</style>
