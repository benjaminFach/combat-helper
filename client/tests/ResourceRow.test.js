import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import ResourceRow from '../src/components/ResourceRow.vue';
import { updateUsage } from '../src/api.js';

// Mock the API seam — no fetch, no server.
vi.mock('../src/api.js', () => ({
  updateUsage: vi.fn(),
}));

/** A promise we can settle from the test, to freeze the "in flight" moment. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const slotResource = (overrides = {}) => ({
  id: 7,
  character_id: 1,
  definition_id: 1,
  resource_name: 'Spell Slot',
  label: 'Level 1',
  category: 'spell_slot',
  refresh_on: 'long_rest',
  short_rest_gain: 0,
  description: 'Expended to cast leveled spells.',
  max_value: 4,
  current_value: 4,
  sort_order: 0,
  metadata: { slot_level: 1 },
  ...overrides,
});

const poolResource = (overrides = {}) => ({
  id: 12,
  character_id: 2,
  definition_id: 4,
  resource_name: 'Lay on Hands',
  label: null,
  category: 'pool',
  refresh_on: 'long_rest',
  short_rest_gain: 0,
  description: 'Healing pool of hit points, spent in any increments.',
  max_value: 50,
  current_value: 50,
  sort_order: 0,
  metadata: {},
  ...overrides,
});

const counterResource = (overrides = {}) => ({
  id: 31,
  character_id: 1,
  definition_id: 9,
  resource_name: 'Healing Potions',
  label: null,
  category: 'consumable',
  refresh_on: 'manual',
  short_rest_gain: 0,
  description: 'Drink or administer as a bonus action to regain 2d4 + 2 HP.',
  max_value: 10,
  current_value: 3,
  sort_order: 0,
  metadata: {},
  ...overrides,
});

const atWillResource = (overrides = {}) => ({
  id: 40,
  character_id: 1,
  definition_id: 11,
  resource_name: 'Vigilant Blessing',
  label: null,
  category: 'class_feature',
  refresh_on: 'manual',
  short_rest_gain: 0,
  description: 'Action to touch a creature and give them advantage on their next initiative roll.',
  max_value: 0,
  current_value: 0,
  sort_order: 0,
  metadata: {},
  ...overrides,
});

const filledPips = (wrapper) => wrapper.findAll('[data-testid="pip"][data-filled="true"]');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ResourceRow — pip mode rendering', () => {
  it('renders one pip per max_value, filled up to current_value', () => {
    const wrapper = mount(ResourceRow, {
      props: { resource: slotResource({ current_value: 2 }) },
    });
    expect(wrapper.findAll('[data-testid="pip"]')).toHaveLength(4);
    expect(filledPips(wrapper)).toHaveLength(2);
    expect(wrapper.text()).toContain('Level 1');
    expect(wrapper.text()).toContain('LR'); // refresh tag
  });
});

describe('ResourceRow — description and reset condition', () => {
  it('shows the description with the full text as a native tooltip', () => {
    const wrapper = mount(ResourceRow, { props: { resource: counterResource() } });
    const desc = wrapper.find('[data-testid="description"]');
    expect(desc.text()).toBe('Drink or administer as a bonus action to regain 2d4 + 2 HP.');
    expect(desc.attributes('title')).toBe(
      'Drink or administer as a bonus action to regain 2d4 + 2 HP.'
    );
  });

  it('toggles between truncated and expanded description on click', async () => {
    const wrapper = mount(ResourceRow, { props: { resource: slotResource() } });
    const desc = wrapper.find('[data-testid="description"]');
    expect(desc.classes()).toContain('truncate');
    await desc.trigger('click');
    expect(desc.classes()).not.toContain('truncate');
    expect(desc.attributes('aria-expanded')).toBe('true');
  });

  it('omits the description line when the definition has none', () => {
    const wrapper = mount(ResourceRow, {
      props: { resource: slotResource({ description: '' }) },
    });
    expect(wrapper.find('[data-testid="description"]').exists()).toBe(false);
  });

  it('renders standard reset tags with explanatory tooltips', () => {
    const cases = [
      [slotResource(), 'LR', 'Resets on a long rest'],
      [slotResource({ refresh_on: 'short_rest' }), 'SR', 'Resets on a short rest'],
      [slotResource({ refresh_on: 'dawn' }), 'Dawn', 'Recharges at dawn'],
    ];
    for (const [resource, tag, title] of cases) {
      const wrapper = mount(ResourceRow, { props: { resource } });
      const pill = wrapper.find('[data-testid="reset-tag"]');
      expect(pill.text()).toBe(tag);
      expect(pill.attributes('title')).toBe(title);
    }
  });

  it('shows no reset pill for manual resources (nothing to reset automatically)', () => {
    const wrapper = mount(ResourceRow, { props: { resource: counterResource() } });
    expect(wrapper.find('[data-testid="reset-tag"]').exists()).toBe(false);
  });

  it('renders the partial short-rest recovery tag (Tempest Channel Divinity)', () => {
    const wrapper = mount(ResourceRow, {
      props: {
        resource: slotResource({
          resource_name: 'Channel Divinity (Tempest)',
          label: 'Channel Divinity',
          category: 'class_feature',
          refresh_on: 'long_rest',
          short_rest_gain: 1,
          max_value: 3,
          current_value: 3,
        }),
      },
    });
    const pill = wrapper.find('[data-testid="reset-tag"]');
    expect(pill.text()).toBe('SR +1 · LR');
    expect(pill.attributes('title')).toBe('Regain 1 on a short rest, all on a long rest');
  });
});

describe('ResourceRow — consumable counter mode', () => {
  it('renders a ± counter instead of pips, without exposing the cap', () => {
    const wrapper = mount(ResourceRow, { props: { resource: counterResource() } });
    expect(wrapper.find('[data-testid="pip"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="counter-value"]').text()).toBe('3');
    expect(wrapper.find('[data-testid="counter-value"]').text()).not.toContain('/');
  });

  it('[+] optimistically increments, emits the optimistic value, and calls restore', async () => {
    const d = deferred();
    updateUsage.mockReturnValue(d.promise);
    const wrapper = mount(ResourceRow, { props: { resource: counterResource() } });

    await wrapper.find('[data-testid="counter-inc"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="counter-value"]').text()).toBe('4'); // optimistic
    expect(updateUsage).toHaveBeenCalledWith(31, 'restore', 1);
    // The optimistic value is emitted BEFORE the server responds, so parent
    // state stays correct even if this component unmounts mid-request.
    expect(wrapper.emitted('updated')).toHaveLength(1);
    expect(wrapper.emitted('updated')[0][0].current_value).toBe(4);

    d.resolve(counterResource({ current_value: 4 }));
    await flushPromises();
    expect(wrapper.emitted('updated')).toHaveLength(2); // + server confirmation
  });

  it('[-] optimistically decrements, calls spend, and rolls back on failure', async () => {
    const d = deferred();
    updateUsage.mockReturnValue(d.promise);
    const wrapper = mount(ResourceRow, { props: { resource: counterResource() } });

    await wrapper.find('[data-testid="counter-dec"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="counter-value"]').text()).toBe('2'); // optimistic
    expect(updateUsage).toHaveBeenCalledWith(31, 'spend', 1);

    d.reject(new Error('Insufficient resource 31: have 0, tried to spend 1'));
    await flushPromises();
    expect(wrapper.find('[data-testid="counter-value"]').text()).toBe('3'); // rolled back
    // Rollback is also emitted so parent state reverts with the row.
    const updates = wrapper.emitted('updated');
    expect(updates.map(([row]) => row.current_value)).toEqual([2, 3]);
    expect(wrapper.emitted('error')).toHaveLength(1);
  });

  it('disables [-] at zero and [+] at the cap', () => {
    const empty = mount(ResourceRow, {
      props: { resource: counterResource({ current_value: 0 }) },
    });
    expect(empty.find('[data-testid="counter-dec"]').attributes('disabled')).toBeDefined();
    expect(empty.find('[data-testid="counter-inc"]').attributes('disabled')).toBeUndefined();

    const full = mount(ResourceRow, {
      props: { resource: counterResource({ current_value: 10 }) },
    });
    expect(full.find('[data-testid="counter-inc"]').attributes('disabled')).toBeDefined();
    expect(full.find('[data-testid="counter-dec"]').attributes('disabled')).toBeUndefined();
  });
});

describe('ResourceRow — at-will mode', () => {
  it('renders an "At will" chip and no usage controls for max_value 0', () => {
    const wrapper = mount(ResourceRow, { props: { resource: atWillResource() } });
    expect(wrapper.find('[data-testid="at-will"]').text()).toBe('At will');
    expect(wrapper.find('[data-testid="pip"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="counter-value"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="pool-value"]').exists()).toBe(false);
  });
});

describe('ResourceRow — optimistic spend', () => {
  it('flips the pip and emits the optimistic value BEFORE the API responds', async () => {
    const d = deferred();
    updateUsage.mockReturnValue(d.promise);
    const wrapper = mount(ResourceRow, { props: { resource: slotResource() } });

    await wrapper.findAll('[data-testid="pip"]')[0].trigger('click');
    await nextTick();

    // Request still unresolved — the UI must already show 3 filled pips, and
    // the parent must already have been told (state survives an unmount).
    expect(filledPips(wrapper)).toHaveLength(3);
    expect(updateUsage).toHaveBeenCalledTimes(1);
    expect(updateUsage).toHaveBeenCalledWith(7, 'spend', 1);
    expect(wrapper.emitted('updated')).toHaveLength(1);
    expect(wrapper.emitted('updated')[0][0].current_value).toBe(3);

    const serverRow = slotResource({ current_value: 3 });
    d.resolve(serverRow);
    await flushPromises();

    expect(filledPips(wrapper)).toHaveLength(3); // reconciled with server truth
    expect(wrapper.emitted('updated')).toHaveLength(2);
    expect(wrapper.emitted('updated')[1][0]).toEqual(serverRow);
    expect(wrapper.emitted('error')).toBeUndefined();
  });

  it('keeps the other pips clickable while a request is in flight', async () => {
    // Regression: a multi-use resource must not lock out further tracking
    // for the duration of the round trip — only its own 0/max boundaries.
    const first = deferred();
    const second = deferred();
    updateUsage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const wrapper = mount(ResourceRow, { props: { resource: slotResource() } });

    await wrapper.findAll('[data-testid="pip"]')[0].trigger('click');
    await nextTick();
    expect(wrapper.findAll('[data-testid="pip"]')[1].attributes('disabled')).toBeUndefined();

    // Second spend fires immediately, without waiting for the first response.
    await wrapper.findAll('[data-testid="pip"]')[0].trigger('click');
    await nextTick();
    expect(updateUsage).toHaveBeenCalledTimes(2);
    expect(filledPips(wrapper)).toHaveLength(2); // both spends applied optimistically

    // First confirmation is stale (a newer request is out) — it must NOT
    // bounce the count back to 3.
    first.resolve(slotResource({ current_value: 3 }));
    await flushPromises();
    expect(filledPips(wrapper)).toHaveLength(2);

    second.resolve(slotResource({ current_value: 2 }));
    await flushPromises();
    expect(filledPips(wrapper)).toHaveLength(2); // final server truth
    expect(wrapper.emitted('error')).toBeUndefined();
  });
});

describe('ResourceRow — rollback on API failure', () => {
  it('reverts the optimistic state and emits "error" when the server rejects (409)', async () => {
    const d = deferred();
    updateUsage.mockReturnValue(d.promise);
    const wrapper = mount(ResourceRow, { props: { resource: slotResource() } });

    await wrapper.findAll('[data-testid="pip"]')[0].trigger('click');
    await nextTick();
    expect(filledPips(wrapper)).toHaveLength(3); // optimistic

    d.reject(new Error('Insufficient resource 7: have 0, tried to spend 1'));
    await flushPromises();

    expect(filledPips(wrapper)).toHaveLength(4); // rolled back
    // Parent state follows the rollback too: optimistic 3, then back to 4.
    expect(wrapper.emitted('updated').map(([row]) => row.current_value)).toEqual([3, 4]);
    const errors = wrapper.emitted('error');
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toMatch(/Level 1/);
    expect(errors[0][0]).toMatch(/Insufficient/);
  });
});

describe('ResourceRow — restoring a spent pip', () => {
  it('clicking a hollow pip optimistically refills it and calls restore', async () => {
    const d = deferred();
    updateUsage.mockReturnValue(d.promise);
    const wrapper = mount(ResourceRow, {
      props: { resource: slotResource({ current_value: 2 }) },
    });

    // Pips 3 and 4 are hollow; click one of them.
    await wrapper.findAll('[data-testid="pip"]')[3].trigger('click');
    await nextTick();

    expect(filledPips(wrapper)).toHaveLength(3); // optimistic refill
    expect(updateUsage).toHaveBeenCalledTimes(1);
    expect(updateUsage).toHaveBeenCalledWith(7, 'restore', 1);

    d.resolve(slotResource({ current_value: 3 }));
    await flushPromises();
    expect(wrapper.emitted('updated')).toHaveLength(2); // optimistic + confirmation
  });
});

describe('ResourceRow — pool mode', () => {
  it('renders a numeric meter with ±1/±5 controls for a 50-point pool', () => {
    const wrapper = mount(ResourceRow, { props: { resource: poolResource() } });
    expect(wrapper.find('[data-testid="pip"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="pool-value"]').text()).toBe('50/50');
    expect(wrapper.find('[data-testid="pool-spend-5"]').exists()).toBe(true);
    // Full pool: restore buttons disabled, spend buttons enabled
    expect(wrapper.find('[data-testid="pool-restore-1"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="pool-spend-1"]').attributes('disabled')).toBeUndefined();
  });

  it('spends optimistically from the pool and rolls back on failure', async () => {
    const d = deferred();
    updateUsage.mockReturnValue(d.promise);
    const wrapper = mount(ResourceRow, {
      props: { resource: poolResource({ current_value: 3 }) },
    });

    await wrapper.find('[data-testid="pool-spend-5"]').trigger('click');
    await nextTick();

    // Optimistic clamp at 0; API is asked for the full 5 and gets to rule on it.
    expect(wrapper.find('[data-testid="pool-value"]').text()).toBe('0/50');
    expect(updateUsage).toHaveBeenCalledTimes(1);
    expect(updateUsage).toHaveBeenCalledWith(12, 'spend', 5);

    d.reject(new Error('Insufficient resource 12: have 3, tried to spend 5'));
    await flushPromises();

    expect(wrapper.find('[data-testid="pool-value"]').text()).toBe('3/50'); // rolled back
    expect(wrapper.emitted('error')).toHaveLength(1);
  });

  it('syncs when the parent updates the prop (e.g. after a global rest)', async () => {
    const wrapper = mount(ResourceRow, {
      props: { resource: poolResource({ current_value: 10 }) },
    });
    expect(wrapper.find('[data-testid="pool-value"]').text()).toBe('10/50');

    await wrapper.setProps({ resource: poolResource({ current_value: 50 }) });
    expect(wrapper.find('[data-testid="pool-value"]').text()).toBe('50/50');
  });
});
