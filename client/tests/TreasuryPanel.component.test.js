import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import TreasuryPanel from '../src/components/TreasuryPanel.vue';
import { createLoot, deleteLoot, sellLoot, updateCurrency } from '../src/api.js';

// Mock the API seam — no fetch, no server.
vi.mock('../src/api.js', () => ({
  createLoot: vi.fn(),
  deleteLoot: vi.fn(),
  sellLoot: vi.fn(),
  updateCurrency: vi.fn(),
}));

const CHARACTERS = [
  { id: 1, name: 'Uppy Beauty' },
  { id: 2, name: 'Kit Sofia' },
];

const flasks = (overrides = {}) => ({
  id: 11,
  name: "Alchemist's Fire",
  description: 'Thrown flask.',
  character_id: 2,
  character_name: 'Kit Sofia',
  value_gp: 50,
  quantity: 3,
  ...overrides,
});

const PURSE = { platinum: 12, gold: 447, electrum: 0, silver: 210, copper: 89 };

const mountPanel = (loot = [flasks()]) =>
  mount(TreasuryPanel, {
    props: {
      loot,
      currency: { ...PURSE },
      characters: CHARACTERS,
      view: reactive({ search: '', sortKey: 'name', sortDir: 'asc', page: 1, pageSize: 10 }),
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TreasuryPanel — currency bar', () => {
  it('shows all five 5e denominations, highest to lowest', () => {
    const wrapper = mountPanel();
    for (const [denom, amount] of Object.entries(PURSE)) {
      expect(wrapper.find(`[data-testid="currency-${denom}"]`).text()).toBe(String(amount));
    }
    expect(wrapper.find('[data-testid="currency-bar"]').text()).toMatch(
      /12.*pp.*447.*gp.*0.*ep.*210.*sp.*89.*cp/s
    );
  });
});

describe('TreasuryPanel — modify currency modal', () => {
  const openCurrency = async (wrapper) => {
    await wrapper.find('[data-testid="currency-modify"]').trigger('click');
    expect(wrapper.find('[data-testid="modal-currency"]').exists()).toBe(true);
  };
  const input = (wrapper, denom) => wrapper.find(`[data-testid="currency-input-${denom}"]`);

  it('opens pre-filled with the current purse, one row per denomination', async () => {
    const wrapper = mountPanel();
    await openCurrency(wrapper);
    for (const [denom, amount] of Object.entries(PURSE)) {
      expect(input(wrapper, denom).element.value).toBe(String(amount));
    }
  });

  it('+ and − step a denomination, and − never goes below zero', async () => {
    const wrapper = mountPanel();
    await openCurrency(wrapper);

    await wrapper.find('[data-testid="currency-inc-gold"]').trigger('click');
    await wrapper.find('[data-testid="currency-inc-gold"]').trigger('click');
    expect(input(wrapper, 'gold').element.value).toBe('449');
    await wrapper.find('[data-testid="currency-dec-gold"]').trigger('click');
    expect(input(wrapper, 'gold').element.value).toBe('448');

    // Electrum is seeded at 0: its − is disabled and clicking cannot underflow.
    expect(wrapper.find('[data-testid="currency-dec-electrum"]').attributes('disabled')).toBeDefined();
    await wrapper.find('[data-testid="currency-inc-electrum"]').trigger('click');
    expect(input(wrapper, 'electrum').element.value).toBe('1');
    await wrapper.find('[data-testid="currency-dec-electrum"]').trigger('click');
    expect(input(wrapper, 'electrum').element.value).toBe('0');
    expect(wrapper.find('[data-testid="currency-dec-electrum"]').attributes('disabled')).toBeDefined();
  });

  it('typed negative or fractional values block the save with a message', async () => {
    const wrapper = mountPanel();
    await openCurrency(wrapper);
    await input(wrapper, 'copper').setValue('-3');
    expect(wrapper.find('[data-testid="currency-errors"]').text()).toContain(
      'Copper (cp) must be a whole number of 0 or more.'
    );
    expect(wrapper.find('[data-testid="currency-confirm"]').attributes('disabled')).toBeDefined();

    await input(wrapper, 'copper').setValue('2.5');
    expect(wrapper.find('[data-testid="currency-confirm"]').attributes('disabled')).toBeDefined();

    await input(wrapper, 'copper').setValue('0');
    expect(wrapper.find('[data-testid="currency-errors"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="currency-confirm"]').attributes('disabled')).toBeUndefined();
  });

  it('saving PUTs the full purse and emits currency-updated', async () => {
    const updated = { ...PURSE, gold: 450, copper: 87 };
    updateCurrency.mockResolvedValue(updated);
    const wrapper = mountPanel();
    await openCurrency(wrapper);

    for (let i = 0; i < 3; i++) {
      await wrapper.find('[data-testid="currency-inc-gold"]').trigger('click');
    }
    await wrapper.find('[data-testid="currency-dec-copper"]').trigger('click');
    await wrapper.find('[data-testid="currency-dec-copper"]').trigger('click');
    await wrapper.find('[data-testid="currency-confirm"]').trigger('click');
    await flushPromises();

    expect(updateCurrency).toHaveBeenCalledWith({
      platinum: 12,
      gold: 450,
      electrum: 0,
      silver: 210,
      copper: 87,
    });
    expect(wrapper.emitted('currency-updated')[0][0]).toEqual(updated);
    expect(wrapper.find('[data-testid="modal-currency"]').exists()).toBe(false);
  });

  it('cancel discards pending edits — reopening shows the untouched purse', async () => {
    const wrapper = mountPanel();
    await openCurrency(wrapper);
    await wrapper.find('[data-testid="currency-inc-gold"]').trigger('click');
    await wrapper.find('[data-testid="currency-cancel"]').trigger('click');
    expect(wrapper.find('[data-testid="modal-currency"]').exists()).toBe(false);
    expect(updateCurrency).not.toHaveBeenCalled();

    await openCurrency(wrapper);
    expect(input(wrapper, 'gold').element.value).toBe('447'); // not 448
  });

  it('keeps the modal open and surfaces the error when the server rejects', async () => {
    updateCurrency.mockRejectedValue(new Error('copper must be a non-negative integer'));
    const wrapper = mountPanel();
    await openCurrency(wrapper);
    await wrapper.find('[data-testid="currency-confirm"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('error')[0][0]).toMatch(/copper/);
    expect(wrapper.find('[data-testid="modal-currency"]').exists()).toBe(true);
    expect(wrapper.emitted('currency-updated')).toBeUndefined();
  });
});

describe('TreasuryPanel — add modal', () => {
  const openAdd = async (wrapper) => {
    await wrapper.find('[data-testid="loot-add"]').trigger('click');
    expect(wrapper.find('[data-testid="modal-add"]').exists()).toBe(true);
  };

  const fillValid = async (wrapper) => {
    await wrapper.find('[data-testid="add-name"]').setValue('Sunblade');
    await wrapper.find('[data-testid="add-description"]').setValue('A radiant longsword.');
    await wrapper.find('[data-testid="add-holder"]').setValue('1');
    await wrapper.find('[data-testid="add-value"]').setValue('2200');
    await wrapper.find('[data-testid="add-quantity"]').setValue('1');
  };

  it('starts invalid (blank name/description/holder) with the confirm disabled', async () => {
    const wrapper = mountPanel();
    await openAdd(wrapper);
    const errors = wrapper.find('[data-testid="add-errors"]').text();
    expect(errors).toContain('Item name is required.');
    expect(errors).toContain('Description is required.');
    expect(errors).toContain('Choose who holds the item.');
    expect(wrapper.find('[data-testid="add-confirm"]').attributes('disabled')).toBeDefined();
    expect(createLoot).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only text, negative values, and fractional quantities', async () => {
    const wrapper = mountPanel();
    await openAdd(wrapper);
    await fillValid(wrapper);
    expect(wrapper.find('[data-testid="add-errors"]').exists()).toBe(false); // sanity: valid now

    await wrapper.find('[data-testid="add-name"]').setValue('   ');
    expect(wrapper.find('[data-testid="add-errors"]').text()).toContain('Item name is required.');

    await wrapper.find('[data-testid="add-name"]').setValue('Sunblade');
    await wrapper.find('[data-testid="add-value"]').setValue('-5');
    expect(wrapper.find('[data-testid="add-errors"]').text()).toContain(
      'Unit value must be a whole number of 0 or more.'
    );

    await wrapper.find('[data-testid="add-value"]').setValue('10');
    await wrapper.find('[data-testid="add-quantity"]').setValue('0');
    expect(wrapper.find('[data-testid="add-errors"]').text()).toContain(
      'Quantity must be a whole number of 1 or more.'
    );
    await wrapper.find('[data-testid="add-quantity"]').setValue('2.5');
    expect(wrapper.find('[data-testid="add-errors"]').text()).toContain(
      'Quantity must be a whole number of 1 or more.'
    );
    expect(wrapper.find('[data-testid="add-confirm"]').attributes('disabled')).toBeDefined();
  });

  it('submits a valid item, emits loot-created, and closes', async () => {
    const created = { id: 99, name: 'Sunblade', value_gp: 2200, quantity: 1 };
    createLoot.mockResolvedValue(created);
    const wrapper = mountPanel();
    await openAdd(wrapper);
    await fillValid(wrapper);

    await wrapper.find('[data-testid="add-confirm"]').trigger('click');
    await flushPromises();

    expect(createLoot).toHaveBeenCalledWith({
      name: 'Sunblade',
      description: 'A radiant longsword.',
      character_id: 1,
      value_gp: 2200,
      quantity: 1,
    });
    expect(wrapper.emitted('loot-created')[0][0]).toEqual(created);
    expect(wrapper.find('[data-testid="modal-add"]').exists()).toBe(false);
  });

  it('maps "Party" to a null holder', async () => {
    createLoot.mockResolvedValue({ id: 100 });
    const wrapper = mountPanel();
    await openAdd(wrapper);
    await fillValid(wrapper);
    await wrapper.find('[data-testid="add-holder"]').setValue('party');
    await wrapper.find('[data-testid="add-confirm"]').trigger('click');
    await flushPromises();
    expect(createLoot.mock.calls[0][0].character_id).toBeNull();
  });

  it('keeps the modal open and emits an error when the backend rejects', async () => {
    createLoot.mockRejectedValue(new Error('name must be a non-blank string'));
    const wrapper = mountPanel();
    await openAdd(wrapper);
    await fillValid(wrapper);
    await wrapper.find('[data-testid="add-confirm"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('error')[0][0]).toMatch(/non-blank/);
    expect(wrapper.find('[data-testid="modal-add"]').exists()).toBe(true); // retryable
    expect(wrapper.emitted('loot-created')).toBeUndefined();
  });

  it('cancel closes without calling the API', async () => {
    const wrapper = mountPanel();
    await openAdd(wrapper);
    await wrapper.find('[data-testid="add-cancel"]').trigger('click');
    expect(wrapper.find('[data-testid="modal-add"]').exists()).toBe(false);
    expect(createLoot).not.toHaveBeenCalled();
  });
});

describe('TreasuryPanel — remove confirmation', () => {
  it('confirming deletes the item and emits loot-removed', async () => {
    deleteLoot.mockResolvedValue({});
    const wrapper = mountPanel();
    await wrapper.find('[data-testid="loot-remove"]').trigger('click');
    expect(wrapper.find('[data-testid="modal-remove"]').text()).toContain("Alchemist's Fire");

    await wrapper.find('[data-testid="remove-confirm"]').trigger('click');
    await flushPromises();
    expect(deleteLoot).toHaveBeenCalledWith(11);
    expect(wrapper.emitted('loot-removed')[0][0]).toBe(11);
    expect(wrapper.find('[data-testid="modal-remove"]').exists()).toBe(false);
  });

  it('backing out leaves the item untouched', async () => {
    const wrapper = mountPanel();
    await wrapper.find('[data-testid="loot-remove"]').trigger('click');
    await wrapper.find('[data-testid="remove-cancel"]').trigger('click');
    expect(wrapper.find('[data-testid="modal-remove"]').exists()).toBe(false);
    expect(deleteLoot).not.toHaveBeenCalled();
    expect(wrapper.emitted('loot-removed')).toBeUndefined();
  });
});

describe('TreasuryPanel — sell modal', () => {
  const openSell = async (wrapper) => {
    await wrapper.find('[data-testid="loot-sell"]').trigger('click');
    expect(wrapper.find('[data-testid="modal-sell"]').exists()).toBe(true);
  };

  it('caps the quantity input at the owned amount and blocks overselling', async () => {
    const wrapper = mountPanel(); // owns 3
    await openSell(wrapper);
    expect(wrapper.find('[data-testid="sell-quantity"]').attributes('max')).toBe('3');

    await wrapper.find('[data-testid="sell-quantity"]').setValue('4');
    await wrapper.find('[data-testid="sell-amount-gold"]').setValue('100');
    expect(wrapper.find('[data-testid="sell-errors"]').text()).toContain(
      'Cannot sell more than you have (3).'
    );
    expect(wrapper.find('[data-testid="sell-confirm"]').attributes('disabled')).toBeDefined();

    await wrapper.find('[data-testid="sell-confirm"]').trigger('click');
    expect(sellLoot).not.toHaveBeenCalled();
  });

  it('validates each coin amount and the quantity as whole numbers', async () => {
    const wrapper = mountPanel();
    await openSell(wrapper);
    await wrapper.find('[data-testid="sell-amount-gold"]').setValue('-10');
    expect(wrapper.find('[data-testid="sell-errors"]').text()).toContain(
      'Gold (gp) amount must be a whole number of 0 or more.'
    );
    await wrapper.find('[data-testid="sell-amount-gold"]').setValue('10');
    await wrapper.find('[data-testid="sell-amount-copper"]').setValue('2.5');
    expect(wrapper.find('[data-testid="sell-errors"]').text()).toContain(
      'Copper (cp) amount must be a whole number of 0 or more.'
    );
    await wrapper.find('[data-testid="sell-amount-copper"]').setValue('');
    await wrapper.find('[data-testid="sell-quantity"]').setValue('0');
    expect(wrapper.find('[data-testid="sell-errors"]').text()).toContain(
      'Quantity must be a whole number of 1 or more.'
    );
  });

  it('a partial sale emits loot-updated + currency-updated with the flat proceeds', async () => {
    sellLoot.mockResolvedValue({
      loot: flasks({ quantity: 1 }),
      currency: { ...PURSE, gold: 527 },
      sold: { quantity: 2, proceeds: { gold: 80 } },
    });
    const wrapper = mountPanel();
    await openSell(wrapper);
    await wrapper.find('[data-testid="sell-quantity"]').setValue('2');
    await wrapper.find('[data-testid="sell-amount-gold"]').setValue('80');
    await wrapper.find('[data-testid="sell-confirm"]').trigger('click');
    await flushPromises();

    // Blank coin inputs are sent as 0 — the backend accepts explicit zeros.
    expect(sellLoot).toHaveBeenCalledWith(11, {
      quantity: 2,
      proceeds: { platinum: 0, gold: 80, electrum: 0, silver: 0, copper: 0 },
    });
    expect(wrapper.emitted('loot-updated')[0][0].quantity).toBe(1);
    expect(wrapper.emitted('currency-updated')[0][0].gold).toBe(527);
    expect(wrapper.emitted('loot-removed')).toBeUndefined();
    expect(wrapper.find('[data-testid="modal-sell"]').exists()).toBe(false);
  });

  it('one sale can mix several denominations (1 gp, 5 sp, 20 cp)', async () => {
    sellLoot.mockResolvedValue({
      loot: flasks({ quantity: 1 }),
      currency: { ...PURSE, gold: 448, silver: 215, copper: 109 },
      sold: { quantity: 2, proceeds: { gold: 1, silver: 5, copper: 20 } },
    });
    const wrapper = mountPanel();
    await openSell(wrapper);
    await wrapper.find('[data-testid="sell-quantity"]').setValue('2');
    await wrapper.find('[data-testid="sell-amount-gold"]').setValue('1');
    await wrapper.find('[data-testid="sell-amount-silver"]').setValue('5');
    await wrapper.find('[data-testid="sell-amount-copper"]').setValue('20');
    await wrapper.find('[data-testid="sell-confirm"]').trigger('click');
    await flushPromises();

    expect(sellLoot).toHaveBeenCalledWith(11, {
      quantity: 2,
      proceeds: { platinum: 0, gold: 1, electrum: 0, silver: 5, copper: 20 },
    });
    const purse = wrapper.emitted('currency-updated')[0][0];
    expect(purse).toMatchObject({ gold: 448, silver: 215, copper: 109 });
  });

  it('selling the full stack emits loot-removed instead of loot-updated', async () => {
    sellLoot.mockResolvedValue({
      loot: null,
      currency: { ...PURSE, silver: 330 },
      sold: { quantity: 3, proceeds: { silver: 120 } },
    });
    const wrapper = mountPanel();
    await openSell(wrapper);
    await wrapper.find('[data-testid="sell-quantity"]').setValue('3');
    await wrapper.find('[data-testid="sell-amount-silver"]').setValue('120');
    await wrapper.find('[data-testid="sell-confirm"]').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('loot-removed')[0][0]).toBe(11);
    expect(wrapper.emitted('loot-updated')).toBeUndefined();
    expect(wrapper.emitted('currency-updated')[0][0].silver).toBe(330);
  });

  it('offers one amount input per 5e denomination, highest to lowest', async () => {
    const wrapper = mountPanel();
    await openSell(wrapper);
    for (const denom of ['platinum', 'gold', 'electrum', 'silver', 'copper']) {
      expect(wrapper.find(`[data-testid="sell-amount-${denom}"]`).exists()).toBe(true);
    }
  });

  it('cancel closes without selling', async () => {
    const wrapper = mountPanel();
    await openSell(wrapper);
    await wrapper.find('[data-testid="sell-cancel"]').trigger('click');
    expect(wrapper.find('[data-testid="modal-sell"]').exists()).toBe(false);
    expect(sellLoot).not.toHaveBeenCalled();
  });
});
