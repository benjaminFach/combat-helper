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
      category: 'consumable',
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

describe('CombatHudCard — editable HP line', () => {
  /** Type into a vital field and commit it — setValue dispatches the change event. */
  const edit = async (wrapper, testid, value) => {
    const input = wrapper.find(`[data-testid="${testid}"]`);
    await input.setValue(value);
    return input;
  };

  it('renders current, max, and temp HP as one line of editable fields', () => {
    const wrapper = mount(CombatHudCard, { props: { character: uppy({ temp_hp: 5 }) } });
    expect(wrapper.find('[data-testid="hud-hp"]').element.value).toBe('63');
    expect(wrapper.find('[data-testid="hud-max-hp"]').element.value).toBe('63');
    expect(wrapper.find('[data-testid="hud-temp-hp"]').element.value).toBe('5');
    // The stepper era is over: no ± buttons for HP or temp HP.
    for (const gone of ['hp-dec-5', 'hp-dec-1', 'hp-inc-1', 'hp-inc-5', 'temp-dec-1', 'temp-inc-1']) {
      expect(wrapper.find(`[data-testid="${gone}"]`).exists(), gone).toBe(false);
    }
  });

  it('committing an edit emits the optimistic value BEFORE the server responds', async () => {
    const d = deferred();
    updateCharacter.mockReturnValue(d.promise);
    const wrapper = mount(CombatHudCard, { props: { character: uppy() } });

    await edit(wrapper, 'hud-hp', '62');
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

  it('each HP field writes through on its happy path', async () => {
    updateCharacter.mockResolvedValue({});
    const wrapper = mount(CombatHudCard, { props: { character: uppy() } });
    await edit(wrapper, 'hud-max-hp', '70');
    expect(updateCharacter).toHaveBeenCalledWith(1, { max_hp: 70 });
    await edit(wrapper, 'hud-temp-hp', '8');
    expect(updateCharacter).toHaveBeenCalledWith(1, { temp_hp: 8 });
    await edit(wrapper, 'hud-hp', '31');
    expect(updateCharacter).toHaveBeenCalledWith(1, { current_hp: 31 });
    expect(wrapper.emitted('resource-error')).toBeUndefined();
  });

  it('rejects current HP above max: no request, error toast, value reverted', async () => {
    const wrapper = mount(CombatHudCard, { props: { character: uppy() } }); // max 63
    const input = await edit(wrapper, 'hud-hp', '64');
    expect(updateCharacter).not.toHaveBeenCalled();
    expect(wrapper.emitted('character-updated')).toBeUndefined();
    expect(wrapper.emitted('resource-error')[0][0]).toMatch(/between 0 and 63/);
    expect(input.element.value).toBe('63'); // reverted in place
  });

  it('rejects negative current HP and negative temp HP', async () => {
    const wrapper = mount(CombatHudCard, { props: { character: uppy() } });
    const hp = await edit(wrapper, 'hud-hp', '-1');
    expect(hp.element.value).toBe('63');
    const temp = await edit(wrapper, 'hud-temp-hp', '-4');
    expect(temp.element.value).toBe('0');
    expect(updateCharacter).not.toHaveBeenCalled();
    expect(wrapper.emitted('resource-error')).toHaveLength(2);
    expect(wrapper.emitted('resource-error')[1][0]).toMatch(/cannot be negative/);
  });

  it('rejects max HP below current HP and max HP of zero', async () => {
    const wrapper = mount(CombatHudCard, { props: { character: uppy({ current_hp: 40 }) } });
    const max = await edit(wrapper, 'hud-max-hp', '39');
    expect(max.element.value).toBe('63');
    expect(wrapper.emitted('resource-error')[0][0]).toMatch(/cannot be below current HP \(40\)/);
    await edit(wrapper, 'hud-max-hp', '0');
    expect(wrapper.emitted('resource-error')[1][0]).toMatch(/at least 1/);
    expect(updateCharacter).not.toHaveBeenCalled();
  });

  it('rejects blank and fractional entries', async () => {
    const wrapper = mount(CombatHudCard, { props: { character: uppy() } });
    await edit(wrapper, 'hud-hp', '31.5');
    await edit(wrapper, 'hud-hp', '');
    expect(updateCharacter).not.toHaveBeenCalled();
    expect(wrapper.emitted('resource-error')).toHaveLength(2);
    expect(wrapper.emitted('resource-error')[0][0]).toMatch(/whole number/);
  });

  it('committing an unchanged value is a no-op', async () => {
    const wrapper = mount(CombatHudCard, { props: { character: uppy() } });
    await edit(wrapper, 'hud-hp', '63');
    expect(updateCharacter).not.toHaveBeenCalled();
    expect(wrapper.emitted('resource-error')).toBeUndefined();
  });
});

describe('CombatHudCard — hit dice steppers', () => {
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

  it('disables only at the pool bounds', () => {
    const wrapper = mount(CombatHudCard, {
      props: { character: uppy({ current_hit_dice: 10 }) },
    });
    expect(wrapper.find('[data-testid="hd-inc-1"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="hd-dec-1"]').attributes('disabled')).toBeUndefined();
  });
});

describe('CombatHudCard — consumables section', () => {
  it('lists consumables with their stock below the reminders section', () => {
    const wrapper = mount(CombatHudCard, { props: { character: uppy() } });
    const section = wrapper.find('[data-testid="hud-consumables"]');
    expect(section.text()).toContain('Consumables');
    const row = section.find('[data-consumable="Healing Potions"]');
    expect(row.text()).toContain('Healing Potions');
    expect(row.find('[data-testid="consumable-count"]').text()).toBe('3');
    // Below the reminders: the reminders list renders before it in the DOM.
    const html = wrapper.html();
    expect(html.indexOf('data-testid="reminder"')).toBeLessThan(
      html.indexOf('hud-consumables')
    );
  });

  it('tracks the shared resource row — a prop update (Ledger edit) changes the count', async () => {
    const wrapper = mount(CombatHudCard, { props: { character: uppy() } });
    const updated = uppy();
    updated.resources = updated.resources.map((r) =>
      r.resource_name === 'Healing Potions' ? { ...r, current_value: 7 } : r
    );
    await wrapper.setProps({ character: updated });
    expect(wrapper.find('[data-testid="consumable-count"]').text()).toBe('7');
  });

  it('omits the section entirely when the character has no consumables', () => {
    const bare = uppy();
    bare.resources = bare.resources.filter((r) => r.category !== 'consumable');
    const wrapper = mount(CombatHudCard, { props: { character: bare } });
    expect(wrapper.find('[data-testid="hud-consumables"]').exists()).toBe(false);
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

    // Activate still unresolved — the HP fields and hit dice remain usable.
    for (const id of ['hud-hp', 'hud-max-hp', 'hud-temp-hp', 'hd-dec-1']) {
      expect(wrapper.find(`[data-testid="${id}"]`).attributes('disabled'),
        id).toBeUndefined();
    }

    // And committing an edit dispatches its PATCH immediately.
    await wrapper.find('[data-testid="hud-hp"]').setValue('62');
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
