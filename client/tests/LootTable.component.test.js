import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive, nextTick } from 'vue';
import LootTable from '../src/components/LootTable.vue';

/**
 * The view object must be reactive() — in the app it lives in App.vue so the
 * table's search/sort/page survive tab switches (v-if unmounts the component).
 */
const makeView = (overrides = {}) =>
  reactive({ search: '', sortKey: 'name', sortDir: 'asc', page: 1, pageSize: 10, ...overrides });

const item = (id, name, description, character_name, value_gp, quantity = 1) => ({
  id,
  name,
  description,
  character_id: character_name ? 100 + id : null,
  character_name,
  value_gp,
  quantity,
});

/** 12 items: two pages at the default size, mixed holders and values. */
const TWELVE = [
  item(1, 'Bag of Holding', 'Extradimensional storage.', 'Orlin', 4000),
  item(2, 'Gold Pouch', 'Loose coin.', null, 615),
  item(3, 'Silvered Longsword', 'Silvered weapon.', 'Lobos', 100),
  item(4, 'Dragonbone Dice Set', 'Probably cursed dice.', 'Orlin', 9),
  item(5, 'Ancient Map', 'Leads somewhere damp.', null, 700),
  item(6, 'Amulet of Health', 'CON becomes 19.', 'Kit Sofia', 8000),
  item(7, 'Chalk of Marking', 'Never runs out.', 'Malachai', 80),
  item(8, 'Emerald', 'A flawless cut.', null, 750),
  item(9, 'Folding Boat', 'A box that unfolds into a boat.', 'Uppy Beauty', 3000),
  item(10, 'Healing Salve', 'Smells of mint.', 'Kit Sofia', 55),
  item(11, 'Iron Key', 'Opens an unknown lock.', null, 1),
  item(12, 'Jade Comb', 'Once a queen’s.', 'Uppy Beauty', 320),
];

const rowNames = (wrapper) =>
  wrapper.findAll('[data-testid="loot-row"]').map((tr) => tr.findAll('td')[0].text());
const pageInfo = (wrapper) => wrapper.find('[data-testid="loot-page-info"]').text();
const rangeInfo = (wrapper) => wrapper.find('[data-testid="loot-range"]').text();

const mountTable = (loot = TWELVE, view = makeView()) =>
  mount(LootTable, { props: { loot, view } });

describe('LootTable — rendering and pagination', () => {
  it('renders the four sortable columns and the first page of rows', () => {
    const wrapper = mountTable();
    expect(
      wrapper.findAll('th button').map((b) => b.text().replace(/[▲▼]/g, '').trim())
    ).toEqual(['Name', 'Description', 'Character', 'Qty', 'Value']);

    expect(wrapper.findAll('[data-testid="loot-row"]')).toHaveLength(10); // default page size
    expect(pageInfo(wrapper)).toBe('Page 1 of 2');
    expect(rangeInfo(wrapper)).toBe('Showing 1–10 of 12');
    // Default sort: name ascending.
    expect(rowNames(wrapper)[0]).toBe('Amulet of Health');
  });

  it('renders holders, Party for unassigned loot, quantity, and total gp values', () => {
    const wrapper = mountTable([TWELVE[0], TWELVE[1], item(30, 'Oil Flask', 'Burns.', null, 50, 3)]);
    const cells = wrapper.findAll('[data-testid="loot-row"]')[0].findAll('td');
    expect(cells.slice(0, 5).map((c) => c.text())).toEqual([
      'Bag of Holding',
      'Extradimensional storage.',
      'Orlin',
      '1',
      '4000 gp',
    ]);
    expect(wrapper.findAll('[data-testid="loot-row"]')[1].findAll('td')[2].text()).toBe('Party');

    // Stacked items show quantity, the TOTAL value, and a unit-price hint.
    const flask = wrapper.findAll('[data-testid="loot-row"]')[2];
    expect(flask.findAll('td')[3].text()).toBe('3');
    expect(flask.findAll('td')[4].text()).toContain('150 gp');
    expect(flask.findAll('td')[4].text()).toContain('50 gp ea');
  });

  it('emits add/sell/remove for the toolbar button and row actions', async () => {
    const wrapper = mountTable([TWELVE[0]]);
    await wrapper.find('[data-testid="loot-add"]').trigger('click');
    expect(wrapper.emitted('add')).toHaveLength(1);

    await wrapper.find('[data-testid="loot-sell"]').trigger('click');
    expect(wrapper.emitted('sell')[0][0].name).toBe('Bag of Holding');

    await wrapper.find('[data-testid="loot-remove"]').trigger('click');
    expect(wrapper.emitted('remove')[0][0].name).toBe('Bag of Holding');
  });

  it('pages forward and back, disabling the pager at the bounds', async () => {
    const view = makeView();
    const wrapper = mountTable(TWELVE, view);
    expect(wrapper.find('[data-testid="loot-prev"]').attributes('disabled')).toBeDefined();

    await wrapper.find('[data-testid="loot-next"]').trigger('click');
    expect(pageInfo(wrapper)).toBe('Page 2 of 2');
    expect(wrapper.findAll('[data-testid="loot-row"]')).toHaveLength(2);
    expect(rangeInfo(wrapper)).toBe('Showing 11–12 of 12');
    expect(wrapper.find('[data-testid="loot-next"]').attributes('disabled')).toBeDefined();

    await wrapper.find('[data-testid="loot-prev"]').trigger('click');
    expect(pageInfo(wrapper)).toBe('Page 1 of 2');
  });

  it('changing the page size re-paginates and returns to page 1', async () => {
    const view = makeView({ page: 2 });
    const wrapper = mountTable(TWELVE, view);
    await wrapper.find('[data-testid="loot-page-size"]').setValue('25');
    expect(view.pageSize).toBe(25);
    expect(pageInfo(wrapper)).toBe('Page 1 of 1');
    expect(wrapper.findAll('[data-testid="loot-row"]')).toHaveLength(12);
  });

  it('shows the empty-vault message when there is no loot at all', () => {
    const wrapper = mountTable([]);
    expect(wrapper.find('[data-testid="loot-empty"]').text()).toMatch(/vault is empty/i);
    expect(wrapper.findAll('[data-testid="loot-row"]')).toHaveLength(0);
    expect(pageInfo(wrapper)).toBe('Page 1 of 1');
    expect(rangeInfo(wrapper)).toBe('Showing 0–0 of 0');
  });
});

describe('LootTable — sorting', () => {
  it('sorts by value numerically, toggling direction on a second click', async () => {
    const wrapper = mountTable();
    await wrapper.find('[data-testid="loot-sort-value"]').trigger('click');
    // 1, 9, 55, 80 first — a lexicographic sort would put 100 before 9.
    expect(rowNames(wrapper).slice(0, 4)).toEqual([
      'Iron Key',
      'Dragonbone Dice Set',
      'Healing Salve',
      'Chalk of Marking',
    ]);
    expect(wrapper.findAll('th')[4].attributes('aria-sort')).toBe('ascending'); // Value column

    await wrapper.find('[data-testid="loot-sort-value"]').trigger('click');
    expect(rowNames(wrapper)[0]).toBe('Amulet of Health'); // 8000 gp
    expect(wrapper.findAll('th')[4].attributes('aria-sort')).toBe('descending');
  });

  it('switching to a new column always starts ascending', async () => {
    const view = makeView({ sortKey: 'value', sortDir: 'desc' });
    const wrapper = mountTable(TWELVE, view);
    await wrapper.find('[data-testid="loot-sort-character"]').trigger('click');
    expect(view.sortKey).toBe('character');
    expect(view.sortDir).toBe('asc');
    expect(wrapper.findAll('[data-testid="loot-row"]')[0].findAll('td')[2].text()).toBe(
      'Kit Sofia'
    );
    expect(wrapper.findAll('th')[2].attributes('aria-sort')).toBe('ascending');
    expect(wrapper.findAll('th')[4].attributes('aria-sort')).toBe('none');
  });
});

describe('LootTable — search', () => {
  it('filters across name, description, and holder; clearing restores everything', async () => {
    const wrapper = mountTable();
    const search = wrapper.find('[data-testid="loot-search"]');

    await search.setValue('uppy');
    expect(rowNames(wrapper)).toEqual(['Folding Boat', 'Jade Comb']);
    expect(rangeInfo(wrapper)).toBe('Showing 1–2 of 2');

    await search.setValue('cursed'); // description match
    expect(rowNames(wrapper)).toEqual(['Dragonbone Dice Set']);

    await search.setValue('');
    expect(wrapper.findAll('[data-testid="loot-row"]')).toHaveLength(10);
    expect(rangeInfo(wrapper)).toBe('Showing 1–10 of 12');
  });

  it('respects the active column sort while searching', async () => {
    const view = makeView({ sortKey: 'value', sortDir: 'desc' });
    const wrapper = mountTable(TWELVE, view);
    await wrapper.find('[data-testid="loot-search"]').setValue('kit sofia');
    expect(rowNames(wrapper)).toEqual(['Amulet of Health', 'Healing Salve']); // 8000 then 55
  });

  it('resets to page 1 and shrinks the page count as the search narrows', async () => {
    const view = makeView({ page: 2 });
    const wrapper = mountTable(TWELVE, view);
    expect(pageInfo(wrapper)).toBe('Page 2 of 2');

    await wrapper.find('[data-testid="loot-search"]').setValue('e');
    await nextTick();
    expect(view.page).toBe(1);
    expect(pageInfo(wrapper)).toBe('Page 1 of 2'); // still 11 matches at size 10

    await wrapper.find('[data-testid="loot-search"]').setValue('emerald');
    expect(pageInfo(wrapper)).toBe('Page 1 of 1'); // narrowed to a single page
    expect(rowNames(wrapper)).toEqual(['Emerald']);
  });

  it('shows the no-match message (with the query) instead of rows', async () => {
    const wrapper = mountTable();
    await wrapper.find('[data-testid="loot-search"]').setValue('vorpal sword');
    expect(wrapper.findAll('[data-testid="loot-row"]')).toHaveLength(0);
    expect(wrapper.find('[data-testid="loot-empty"]').text()).toContain(
      'No loot matches “vorpal sword”'
    );
  });

  it('searching an empty vault still shows an empty state, never a crash', async () => {
    const view = makeView({ search: 'anything' });
    const wrapper = mountTable([], view);
    expect(wrapper.find('[data-testid="loot-empty"]').text()).toMatch(/no loot matches/i);
    view.search = '';
    await nextTick();
    expect(wrapper.find('[data-testid="loot-empty"]').text()).toMatch(/vault is empty/i);
  });
});

describe('LootTable — view state survives unmount (tab switches)', () => {
  it('a remount with the same view object restores search, sort, and page', async () => {
    const view = makeView();
    const first = mountTable(TWELVE, view);
    await first.find('[data-testid="loot-search"]').setValue('orlin');
    await first.find('[data-testid="loot-sort-value"]').trigger('click');
    await first.find('[data-testid="loot-sort-value"]').trigger('click'); // desc
    first.unmount(); // tab switched away

    const second = mountTable(TWELVE, view); // tab switched back
    expect(second.find('[data-testid="loot-search"]').element.value).toBe('orlin');
    expect(second.findAll('th')[4].attributes('aria-sort')).toBe('descending');
    expect(rowNames(second)).toEqual(['Bag of Holding', 'Dragonbone Dice Set']); // priciest first
  });
});
