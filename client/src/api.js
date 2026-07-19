/**
 * Thin fetch wrapper around the Express API.
 * Kept as a standalone module so component tests can vi.mock() it.
 */
async function req(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

const post = (url, payload) =>
  req(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

/** GET the full party with nested resources. */
export const fetchCharacters = () => req('/api/characters');

/**
 * Mutate one resource's usage.
 * action: 'spend' | 'restore' (amount = delta) or 'set' (amount = absolute value).
 * Resolves with the updated resource row.
 */
export const updateUsage = (id, action, amount = 1) =>
  post(`/api/resources/${id}/usage`, action === 'set' ? { action, value: amount } : { action, amount });

/** Toggle a feature's active flag (e.g. Twilight Sanctuary). Resolves with the resource row. */
export const setResourceActive = (id, active) =>
  post(`/api/resources/${id}/usage`, { action: 'set_active', active });

/**
 * PATCH a character's own state (current_hp, temp_hp, current_hit_dice...).
 * Resolves with the updated character row (no nested resources).
 */
export const updateCharacter = (id, patch) =>
  req(`/api/characters/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

/** GET the party treasury: every loot row with its holder's name joined in. */
export const fetchLoot = () => req('/api/loot');

/** GET the party purse: { platinum, gold, electrum, silver, copper }. */
export const fetchCurrency = () => req('/api/currency');

/**
 * PUT absolute purse values (any subset of denominations). The server rejects
 * negative or fractional amounts. Resolves with the full updated purse.
 */
export const updateCurrency = (values) =>
  req('/api/currency', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });

/** Add one loot item. Resolves with the created row (201). */
export const createLoot = (item) => post('/api/loot', item);

/** Remove one loot item outright (no sale). Resolves with {} on the 204. */
export const deleteLoot = (id) => req(`/api/loot/${id}`, { method: 'DELETE' });

/**
 * Sell part or all of a line item. `proceeds` maps denominations to flat coin
 * amounts for the whole sale (never multiplied by quantity), and one sale may
 * mix several denominations: { gold: 1, silver: 5, copper: 20 }.
 * Resolves with { loot: row|null, currency, sold }.
 */
export const sellLoot = (id, { quantity, proceeds }) =>
  post(`/api/loot/${id}/sell`, { quantity, proceeds });

/** Trigger a party-wide rest. Resolves with { type, refreshed, characters }. */
export const triggerRest = (type) => post('/api/rests', { type });
