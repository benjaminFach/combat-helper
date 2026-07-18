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

/** Trigger a party-wide rest. Resolves with { type, refreshed, characters }. */
export const triggerRest = (type) => post('/api/rests', { type });
