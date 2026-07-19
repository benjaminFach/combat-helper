import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import CombatHudCard from '../src/components/CombatHudCard.vue';
import { updateCharacter, setResourceActive } from '../src/api.js';

// Mock the API seam — no fetch, no server.
vi.mock('../src/api.js', () => ({
  updateCharacter: vi.fn(),
  setResourceActive: vi.fn(),
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

/** Uppy-shaped character: Twilight Cleric with Channel Divinity + potions. */
const uppy = (overrides = {}, cd = {}) => ({
  id: 1,
  name: 'Uppy Beauty',
  class: 'Cleric',
  subclass: 'Twilight Domain',
  level: 10,
  max_hp: 63,
  current_hp: 63,
  temp_hp: 0,
  max_hit_dice: 10,
  current_hit_dice: 10,
  resources: [
    {
      id: 7,
      resource_name: 'Channel Divinity (Twilight)',
      label: 'Channel Divinity',
      description: 'Choose one: Twilight Sanctuary...',
      current_value: 3,
      max_value: 3,
      is_active: false,
      ...cd,
    },
    {
      id: 9,
      resource_name: 'Divine Intervention',
      description: 'Cast a level 5 spell for free.',
      current_value: 1,
      max_value: 1,
      is_active: false,
    },
    {
      id: 15,
      resource_name: 'Healing Potions',
      description: 'Regain 2d4 + 2 HP.',
      current_value: 3,
      max_value: 10,
      is_active: false,
    },
  ],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CombatHudCard — combat role banner', () => {
  const playbook = {
    role_name: 'Anchor',
    role_text: 'You keep the party standing — your aura and concentration are the plan.',
    default_action: "Sacred Flame the party's focused target",
    rules: [],
    signatures: [],
  };

  it('shows the assigned combat role at the top of the card', () => {
    const wrapper = mount(CombatHudCard, { props: { character: uppy({ playbook }) } });
    const banner = wrapper.find('[data-testid="role-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('Anchor');
    expect(banner.text()).toContain('You keep the party standing');
    // Top of the card: the banner renders before the name header (<h2>).
    const html = wrapper.html();
    expect(html.indexOf('role-banner')).toBeLessThan(html.indexOf('<h2'));
  });

  it('renders no banner for a character without a playbook', () => {
    const wrapper = mount(CombatHudCard, { props: { character: uppy({ playbook: null }) } });
    expect(wrapper.find('[data-testid="role-banner"]').exists()).toBe(false);
  });
});

describe('CombatHudCard — depleted reminder de-ranking', () => {
  /** Uppy with Divine Intervention out of uses (LR recharge). */
  const withSpentDI = () => {
    const c = uppy();
    c.resources = c.resources.map((r) =>
      r.resource_name === 'Divine Intervention'
        ? { ...r, current_value: 0, refresh_on: 'long_rest', short_rest_gain: 0 }
        : r
    );
    return c;
  };

  /** Kit-shaped character whose FIRST reminder (Destructive Wrath) can sink. */
  const kit = (cdValue) =>
    uppy({
      class: 'Cleric',
      subclass: 'Tempest Domain',
      resources: [
        {
          id: 21,
          resource_name: 'Channel Divinity (Tempest)',
          label: 'Channel Divinity',
          description: 'Destructive Wrath — max Lightning/Thunder damage.',
          current_value: cdValue,
          max_value: 3,
          refresh_on: 'long_rest',
          short_rest_gain: 1,
          is_active: false,
        },
        {
          id: 22,
          resource_name: 'Wrath of the Storm',
          description: 'Reaction: 2d8 Lightning/Thunder.',
          current_value: 5,
          max_value: 5,
          refresh_on: 'long_rest',
          short_rest_gain: 0,
          is_active: false,
        },
        {
          id: 23,
          resource_name: 'Divine Intervention',
          description: 'Cast a level 5 spell for free.',
          current_value: 1,
          max_value: 1,
          refresh_on: 'long_rest',
          short_rest_gain: 0,
          is_active: false,
        },
      ],
    });

  const reminderKeys = (wrapper) =>
    wrapper.findAll('[data-testid="reminder"]').map((li) => li.attributes('data-reminder'));

  it('renders no depleted reminders on a fully charged character', () => {
    const wrapper = mount(CombatHudCard, { props: { character: uppy() } });
    expect(wrapper.findAll('[data-testid="reminder"]').length).toBeGreaterThan(0);
    expect(wrapper.findAll('[data-testid="reminder"][data-depleted="true"]')).toHaveLength(0);
    expect(wrapper.find('[data-testid="reminder-depleted"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="reminder-reset"]').exists()).toBe(false);
  });

  it('marks a spent reminder with muted styling, a Spent chip, and its reset trigger', () => {
    const wrapper = mount(CombatHudCard, { props: { character: withSpentDI() } });
    const di = wrapper.find('[data-reminder="divine-intervention"]');
    expect(di.attributes('data-depleted')).toBe('true');
    expect(di.classes()).toContain('opacity-60');
    expect(di.find('span.line-through').exists()).toBe(true);
    expect(di.find('[data-testid="reminder-depleted"]').text()).toBe('Spent');
    const reset = di.find('[data-testid="reminder-reset"]');
    expect(reset.text()).toBe('LR');
    expect(reset.attributes('title')).toBe('Resets on a long rest');
    // The healthy reminders are untouched.
    expect(wrapper.find('[data-reminder="vigilant-blessing"]').attributes('data-depleted')).toBe(
      'false'
    );
  });

  it('sinks a depleted first reminder to the bottom of the list', () => {
    const healthy = mount(CombatHudCard, { props: { character: kit(3) } });
    expect(reminderKeys(healthy)).toEqual([
      'destructive-wrath',
      'wrath-of-the-storm',
      'divine-intervention',
    ]);

    const spent = mount(CombatHudCard, { props: { character: kit(0) } });
    expect(reminderKeys(spent)).toEqual([
      'wrath-of-the-storm',
      'divine-intervention',
      'destructive-wrath',
    ]);
    expect(
      spent.find('[data-reminder="destructive-wrath"] [data-testid="reminder-reset"]').text()
    ).toBe('SR +1 · LR'); // partial short-rest recovery flows into the indicator
  });

  it('re-ranks live when the prop updates with restored charges', async () => {
    const wrapper = mount(CombatHudCard, { props: { character: kit(0) } });
    expect(wrapper.findAll('[data-testid="reminder"][data-depleted="true"]')).toHaveLength(1);

    await wrapper.setProps({ character: kit(1) }); // one use back is enough
    expect(wrapper.findAll('[data-testid="reminder"][data-depleted="true"]')).toHaveLength(0);
    expect(wrapper.find('[data-testid="reminder-reset"]').exists()).toBe(false);
    expect(reminderKeys(wrapper)).toEqual([
      'destructive-wrath',
      'wrath-of-the-storm',
      'divine-intervention',
    ]);
  });
});

describe('CombatHudCard — vitals mutations', () => {
  it('emits the optimistic value BEFORE the server responds, then the server row', async () => {
    const d = deferred();
    updateCharacter.mockReturnValue(d.promise);
    const wrapper = mount(CombatHudCard, { props: { character: uppy() } });

    await wrapper.find('[data-testid="hp-dec-1"]').trigger('click');
    await nextTick();

    expect(updateCharacter).toHaveBeenCalledWith(1, { current_hp: 62 });
    expect(wrapper.emitted('character-updated')).toHaveLength(1);
    expect(wrapper.emitted('character-updated')[0][0]).toEqual({ id: 1, current_hp: 62 });

    const serverRow = { ...uppy(), current_hp: 62 };
    d.resolve(serverRow);
    await flushPromises();
    expect(wrapper.emitted('character-updated')).toHaveLength(2);
    expect(wrapper.emitted('character-updated')[1][0]).toEqual(serverRow);
  });

  it('rolls back the optimistic value and emits an error when the PATCH fails', async () => {
    const d = deferred();
    updateCharacter.mockReturnValue(d.promise);
    const wrapper = mount(CombatHudCard, { props: { character: uppy() } });

    await wrapper.find('[data-testid="hd-dec-1"]').trigger('click');
    await nextTick();
    expect(wrapper.emitted('character-updated')[0][0]).toEqual({ id: 1, current_hit_dice: 9 });

    d.reject(new Error('boom'));
    await flushPromises();
    expect(wrapper.emitted('character-updated')[1][0]).toEqual({ id: 1, current_hit_dice: 10 });
    expect(wrapper.emitted('resource-error')[0][0]).toMatch(/boom/);
  });

  it('disables controls only at their own 0/max boundaries', () => {
    const wrapper = mount(CombatHudCard, {
      props: { character: uppy({ current_hp: 0, temp_hp: 0, current_hit_dice: 10 }) },
    });
    expect(wrapper.find('[data-testid="hp-dec-1"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="hp-inc-1"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.find('[data-testid="temp-dec-1"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="temp-inc-1"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.find('[data-testid="hd-inc-1"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="hd-dec-1"]').attributes('disabled')).toBeUndefined();
  });
});

describe('CombatHudCard — Twilight Sanctuary toggle', () => {
  it('activating emits the optimistic is_active row before the server responds', async () => {
    const d = deferred();
    setResourceActive.mockReturnValue(d.promise);
    const wrapper = mount(CombatHudCard, { props: { character: uppy() } });

    await wrapper.find('[data-testid="activate-twilight-sanctuary"]').trigger('click');
    await nextTick();

    expect(setResourceActive).toHaveBeenCalledWith(7, true);
    expect(wrapper.emitted('resource-updated')).toHaveLength(1);
    expect(wrapper.emitted('resource-updated')[0][0]).toMatchObject({ id: 7, is_active: true });

    d.resolve({ id: 7, is_active: true, current_value: 3, max_value: 3 });
    await flushPromises();
    expect(wrapper.emitted('resource-updated')).toHaveLength(2);
  });

  it('rolls the toggle back and emits an error when the server rejects', async () => {
    const d = deferred();
    setResourceActive.mockReturnValue(d.promise);
    const wrapper = mount(CombatHudCard, { props: { character: uppy() } });

    await wrapper.find('[data-testid="activate-twilight-sanctuary"]').trigger('click');
    d.reject(new Error('nope'));
    await flushPromises();

    const rows = wrapper.emitted('resource-updated').map(([r]) => r.is_active);
    expect(rows).toEqual([true, false]); // optimistic, then rollback
    expect(wrapper.emitted('resource-error')[0][0]).toMatch(/nope/);
  });

  it('does NOT lock the vitals controls while the activate request is in flight', async () => {
    // Regression: clicking Activate used to disable HP/temp/hit-dice steppers
    // (shared pending flag) until the round trip finished.
    const activate = deferred();
    setResourceActive.mockReturnValue(activate.promise);
    const patch = deferred();
    updateCharacter.mockReturnValue(patch.promise);
    const wrapper = mount(CombatHudCard, { props: { character: uppy() } });

    await wrapper.find('[data-testid="activate-twilight-sanctuary"]').trigger('click');
    await nextTick();

    // Activate still unresolved — every vital stepper must remain usable.
    for (const id of ['hp-dec-5', 'hp-dec-1', 'temp-inc-1', 'hd-dec-1']) {
      expect(wrapper.find(`[data-testid="${id}"]`).attributes('disabled'),
        id).toBeUndefined();
    }

    // And clicking one dispatches its PATCH immediately.
    await wrapper.find('[data-testid="hp-dec-1"]').trigger('click');
    await nextTick();
    expect(updateCharacter).toHaveBeenCalledWith(1, { current_hp: 62 });

    activate.resolve({ id: 7, is_active: true });
    patch.resolve({ ...uppy(), current_hp: 62 });
    await flushPromises();
    expect(wrapper.emitted('resource-error')).toBeUndefined();
  });
});

describe('CombatHudCard — active chip', () => {
  it('shows the Active chip with a working End control when the feature runs', async () => {
    setResourceActive.mockResolvedValue({ id: 7, is_active: false });
    const wrapper = mount(CombatHudCard, {
      props: { character: uppy({}, { is_active: true }) },
    });

    expect(wrapper.find('[data-testid="active-feature"]').text()).toContain(
      'Twilight Sanctuary — Active'
    );
    expect(wrapper.find('[data-testid="activate-twilight-sanctuary"]').exists()).toBe(false);

    await wrapper.find('[data-testid="deactivate-twilight-sanctuary"]').trigger('click');
    await nextTick();
    expect(setResourceActive).toHaveBeenCalledWith(7, false);
    expect(wrapper.emitted('resource-updated')[0][0]).toMatchObject({ id: 7, is_active: false });
  });
});
