import { describe, it, expect } from 'vitest';
import { filterLoot, sortLoot, paginate, holderName, valueText, totalValue } from '../src/lootTable.js';

/** Loot rows as GET /api/loot returns them (character_name joined, null = party). */
const item = (id, name, description, character_name, value_gp, quantity = 1) => ({
  id,
  name,
  description,
  character_id: character_name ? 100 + id : null,
  character_name,
  value_gp,
  quantity,
});

const ITEMS = [
  item(1, 'Bag of Holding', 'Holds 500 lbs.', 'Orlin', 4000),
  item(2, 'gold pouch', 'Loose coin from three jobs.', null, 615),
  item(3, 'Silvered Longsword', 'Counts as silvered.', 'Lobos', 100),
  item(4, 'Dragonbone Dice Set', 'Probably cursed.', 'Orlin', 25),
  item(5, 'Ancient Map', 'Leads somewhere damp.', null, 700),
  item(6, 'amulet of health', 'CON becomes 19.', 'Kit Sofia', 8000),
];

const ids = (rows) => rows.map((r) => r.id);

describe('holderName / valueText / totalValue', () => {
  it('unassigned loot belongs to the Party and values render in gp', () => {
    expect(holderName(ITEMS[0])).toBe('Orlin');
    expect(holderName(ITEMS[1])).toBe('Party');
    expect(valueText(ITEMS[3])).toBe('25 gp');
  });

  it('a line item is worth unit price times quantity', () => {
    const flasks = item(9, 'Oil Flask', 'Burns.', null, 50, 3);
    expect(totalValue(flasks)).toBe(150);
    expect(valueText(flasks)).toBe('150 gp'); // the table renders the total
    expect(totalValue(ITEMS[0])).toBe(4000); // quantity 1 = unit price
  });
});

describe('filterLoot', () => {
  it('returns the list untouched for blank or whitespace queries', () => {
    expect(filterLoot(ITEMS, '')).toBe(ITEMS);
    expect(filterLoot(ITEMS, '   ')).toBe(ITEMS);
    expect(filterLoot(ITEMS, undefined)).toBe(ITEMS);
  });

  it('matches names case-insensitively', () => {
    expect(ids(filterLoot(ITEMS, 'BAG'))).toEqual([1]);
    expect(ids(filterLoot(ITEMS, 'GoLd PoUcH'))).toEqual([2]);
  });

  it('matches descriptions and holder names', () => {
    expect(ids(filterLoot(ITEMS, 'cursed'))).toEqual([4]);
    expect(ids(filterLoot(ITEMS, 'orlin'))).toEqual([1, 4]);
  });

  it('matches "party" for unassigned loot and the rendered value text', () => {
    expect(ids(filterLoot(ITEMS, 'party'))).toEqual([2, 5]);
    expect(ids(filterLoot(ITEMS, '615'))).toEqual([2]);
    expect(ids(filterLoot(ITEMS, '8000 gp'))).toEqual([6]);
  });

  it('returns nothing when nothing matches, and everything is fine with no loot', () => {
    expect(filterLoot(ITEMS, 'zzzz-no-such-thing')).toEqual([]);
    expect(filterLoot([], 'anything')).toEqual([]);
  });
});

describe('sortLoot', () => {
  it('sorts names case-insensitively in both directions without mutating input', () => {
    const original = [...ITEMS];
    const asc = sortLoot(ITEMS, 'name', 'asc').map((r) => r.name);
    expect(asc).toEqual([
      'amulet of health',
      'Ancient Map',
      'Bag of Holding',
      'Dragonbone Dice Set',
      'gold pouch',
      'Silvered Longsword',
    ]);
    expect(sortLoot(ITEMS, 'name', 'desc').map((r) => r.name)).toEqual([...asc].reverse());
    expect(ITEMS).toEqual(original); // pure — no in-place sort
  });

  it('sorts value numerically, not lexicographically', () => {
    // String sort would order 100 < 25 < 4000 < 615 < 700 < 8000.
    expect(sortLoot(ITEMS, 'value', 'asc').map((r) => r.value_gp)).toEqual([
      25, 100, 615, 700, 4000, 8000,
    ]);
    expect(sortLoot(ITEMS, 'value', 'desc')[0].value_gp).toBe(8000);
  });

  it('sorts value by TOTAL (unit x quantity), and quantity numerically', () => {
    const stacked = [
      item(1, 'Cheap Pile', '', null, 10, 100), // total 1000
      item(2, 'Single Gem', '', null, 500, 1), // total 500
      item(3, 'Mid Stack', '', null, 60, 12), // total 720
    ];
    expect(sortLoot(stacked, 'value', 'asc').map((r) => r.id)).toEqual([2, 3, 1]);
    // Quantity sorts on the count itself: 1, 12, 100 (lexicographic would say 1, 100, 12).
    expect(sortLoot(stacked, 'quantity', 'asc').map((r) => r.quantity)).toEqual([1, 12, 100]);
  });

  it('sorts the character column by display name with Party last alphabetically, ids breaking ties', () => {
    expect(ids(sortLoot(ITEMS, 'character', 'asc'))).toEqual([6, 3, 1, 4, 2, 5]);
    // Ties (two Orlin items, two Party items) stay in id order even descending.
    expect(ids(sortLoot(ITEMS, 'character', 'desc'))).toEqual([2, 5, 1, 4, 3, 6]);
  });
});

describe('paginate', () => {
  const many = Array.from({ length: 25 }, (_, i) => item(i + 1, `Item ${i + 1}`, '', null, i));

  it('slices pages with 1-based range bounds', () => {
    const p1 = paginate(many, 1, 10);
    expect(ids(p1.rows)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(p1).toMatchObject({ page: 1, totalPages: 3, total: 25, start: 1, end: 10 });

    const p3 = paginate(many, 3, 10);
    expect(p3.rows).toHaveLength(5);
    expect(p3).toMatchObject({ page: 3, start: 21, end: 25 });
  });

  it('clamps out-of-range pages instead of stranding the view', () => {
    expect(paginate(many, 99, 10).page).toBe(3);
    expect(paginate(many, 0, 10).page).toBe(1);
    expect(paginate(many, -4, 10).page).toBe(1);
  });

  it('handles exact multiples and oversized page sizes', () => {
    expect(paginate(many.slice(0, 20), 2, 10)).toMatchObject({ totalPages: 2, start: 11, end: 20 });
    expect(paginate(many, 1, 100)).toMatchObject({ totalPages: 1, end: 25 });
  });

  it('reports one empty page for an empty list', () => {
    expect(paginate([], 5, 10)).toEqual({
      rows: [],
      page: 1,
      totalPages: 1,
      total: 0,
      start: 0,
      end: 0,
    });
  });
});
