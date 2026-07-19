/**
 * Treasury table logic — pure functions over the loot rows the API returns,
 * so Vitest can drive filtering, sorting, and pagination without the DOM.
 * The LootTable component is a thin renderer over these.
 */

export const LOOT_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'character', label: 'Character' },
  { key: 'quantity', label: 'Qty' },
  { key: 'value', label: 'Value' },
];

export const PAGE_SIZES = [10, 25, 50, 100];

/** The five D&D 5e coin denominations, highest to lowest. */
export const DENOMINATIONS = [
  { key: 'platinum', abbr: 'pp', label: 'Platinum (pp)' },
  { key: 'gold', abbr: 'gp', label: 'Gold (gp)' },
  { key: 'electrum', abbr: 'ep', label: 'Electrum (ep)' },
  { key: 'silver', abbr: 'sp', label: 'Silver (sp)' },
  { key: 'copper', abbr: 'cp', label: 'Copper (cp)' },
];

/** Display name for the Character column: unassigned loot belongs to the party. */
export function holderName(item) {
  return item.character_name ?? 'Party';
}

/** A line item's total worth: unit price times quantity. */
export function totalValue(item) {
  return item.value_gp * item.quantity;
}

/** Rendered form of the Value column — search matches what the table shows. */
export function valueText(item) {
  return `${totalValue(item)} gp`;
}

const ACCESSORS = {
  name: (item) => item.name,
  description: (item) => item.description,
  character: holderName,
  quantity: (item) => String(item.quantity),
  value: valueText, // display form; sorting uses the numeric fields below
};

const NUMERIC_SORTS = {
  quantity: (item) => item.quantity,
  value: totalValue,
};

/**
 * Case-insensitive substring filter across every visible column.
 * A blank/whitespace query returns the full list untouched.
 */
export function filterLoot(items, query) {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) =>
    Object.values(ACCESSORS).some((accessor) => accessor(item).toLowerCase().includes(q))
  );
}

/**
 * Sort a copy of the list by column key. Value (unit x quantity) and quantity
 * sort numerically; text columns sort case-insensitively; id breaks ties so
 * order is deterministic.
 */
export function sortLoot(items, key, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  const numeric = NUMERIC_SORTS[key];
  const compare = numeric
    ? (a, b) => numeric(a) - numeric(b)
    : (a, b) =>
        (ACCESSORS[key] ?? ACCESSORS.name)(a).localeCompare(
          (ACCESSORS[key] ?? ACCESSORS.name)(b),
          undefined,
          { sensitivity: 'base' }
        );
  // The direction flips the column comparison only — tied rows keep a stable
  // ascending-id order either way, so toggling never shuffles equal entries.
  return [...items].sort((a, b) => sign * compare(a, b) || a.id - b.id);
}

/**
 * Slice one page out of the list. The page is clamped into [1, totalPages]
 * so a shrinking result set (narrowed search, bigger page size) can never
 * strand the view on a page that no longer exists. An empty list still
 * reports one (empty) page.
 */
export function paginate(items, page, pageSize) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * pageSize;
  return {
    rows: items.slice(start, start + pageSize),
    page: clampedPage,
    totalPages,
    total,
    start: total === 0 ? 0 : start + 1, // 1-based "Showing X–Y of N" bounds
    end: Math.min(start + pageSize, total),
  };
}
