import { test, expect } from '@playwright/test';

/**
 * Combat HUD end-to-end coverage: tab navigation, the status snapshot,
 * the Bloodied indicator boundary, and the conditional reminders.
 *
 * The stack is re-seeded before every run (see playwright.config.js), but all
 * spec files share that one database within a run — every test here restores
 * whatever it mutates so healing-potions/party-roster still see seed state.
 *
 * API calls go through the Vite proxy (baseURL-relative /api/...), which lets
 * tests pin exact HP/hit-dice values instead of clicking −1 dozens of times.
 */

async function getCharacter(request, name) {
  const res = await request.get('/api/characters');
  return (await res.json()).find((c) => c.name === name);
}

const patchCharacter = (request, id, patch) =>
  request.patch(`/api/characters/${id}`, { data: patch });

/**
 * Poll the API until an optimistic UI mutation has written through. Controls
 * never disable during requests, so server truth is the only reliable
 * "request settled" signal — needed before restoring state or reloading.
 */
async function expectServerState(request, name, pick, value) {
  await expect.poll(async () => pick(await getCharacter(request, name))).toBe(value);
}

/** One character's HUD card (aria-label = "<name> combat status"). */
const hudCard = (page, name) => page.getByRole('article', { name: `${name} combat status` });

/** The Combat HUD is the first tab and the default view — goto lands on it. */
async function openHud(page) {
  await page.goto('/');
  await expect(page.getByTestId('hud-card')).toHaveCount(5);
}

test.describe('Tab navigation', () => {
  test('Combat HUD is the first tab and the active view on spin-up', async ({ page }) => {
    await page.goto('/');

    // Tab bar order: Combat HUD leads, then Ledger, then Treasury.
    await expect(page.getByRole('tab')).toHaveText(['Combat HUD', 'Ledger', 'Treasury']);
    await expect(page.getByTestId('tab-hud')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tab-ledger')).toHaveAttribute('aria-selected', 'false');

    // The default view is the HUD: five HUD cards, no Ledger cards.
    await expect(page.getByTestId('hud-card')).toHaveCount(5);
    await expect(page.getByRole('article', { name: 'Lobos', exact: true })).toHaveCount(0);
  });

  test('choosing Ledger brings up the Party Ledger, and the HUD comes back on demand', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('hud-card')).toHaveCount(5);

    // Switch to the Party Ledger: resource cards with pip rails, no HUD cards.
    await page.getByTestId('tab-ledger').click();
    await expect(page.getByTestId('tab-ledger')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('article', { name: 'Lobos', exact: true })).toBeVisible();
    await expect(
      page.getByRole('article', { name: 'Lobos', exact: true }).getByText('Bloodshed Greatsword')
    ).toBeVisible();
    await expect(page.getByTestId('hud-card')).toHaveCount(0);

    // And back to the Combat HUD.
    await page.getByTestId('tab-hud').click();
    await expect(page.getByTestId('tab-hud')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('hud-card')).toHaveCount(5);
    await expect(page.getByRole('article', { name: 'Lobos', exact: true })).toHaveCount(0);
  });
});

test.describe('Status snapshot', () => {
  test('shows HP, temp HP, hit dice, and potion stock from the seed', async ({ page }) => {
    await openHud(page);

    const uppy = hudCard(page, 'Uppy Beauty');
    // The HP line is one row of editable fields: current / max + temp.
    await expect(uppy.getByTestId('hud-hp')).toHaveValue('66');
    await expect(uppy.getByTestId('hud-max-hp')).toHaveValue('66');
    await expect(uppy.getByTestId('hud-temp-hp')).toHaveValue('0');
    await expect(uppy.getByTestId('hud-hit-dice')).toHaveText('10');
    // Consumables live in their own section below the reminders.
    const potions = uppy.locator('[data-consumable="Healing Potions"]');
    await expect(potions.getByTestId('consumable-count')).toHaveText('3'); // clerics stock 3
    await expect(
      hudCard(page, 'Lobos')
        .locator('[data-consumable="Healing Potions"]')
        .getByTestId('consumable-count')
    ).toHaveText('0');
  });

  test('the Consumables section sits below the Reminders section', async ({ page }) => {
    await openHud(page);
    const uppy = hudCard(page, 'Uppy Beauty');
    await expect(uppy.getByTestId('hud-consumables')).toContainText('Consumables');
    const positions = await uppy.evaluate((card) => ({
      reminder: card.querySelector('[data-testid="reminder"]').getBoundingClientRect().top,
      consumables: card.querySelector('[data-testid="hud-consumables"]').getBoundingClientRect().top,
    }));
    expect(positions.consumables).toBeGreaterThan(positions.reminder);
  });

  test('every character gets their expected always-on reminders', async ({ page }) => {
    await openHud(page);

    const uppy = hudCard(page, 'Uppy Beauty');
    await expect(uppy.locator('[data-reminder="vigilant-blessing"]')).toContainText(
      'Use this to grant someone advantage on initiative.'
    );
    await expect(uppy.locator('[data-reminder="divine-intervention"]')).toBeVisible();

    const kit = hudCard(page, 'Kit Sofia');
    await expect(kit.locator('[data-reminder="destructive-wrath"]')).toBeVisible();
    await expect(kit.locator('[data-reminder="wrath-of-the-storm"]')).toBeVisible();
    await expect(kit.locator('[data-reminder="divine-intervention"]')).toBeVisible();

    const lobos = hudCard(page, 'Lobos');
    await expect(lobos.locator('[data-reminder="shift"]')).toBeVisible();
    await expect(lobos.locator('[data-reminder="crimson-rite"]')).toBeVisible();

    await expect(hudCard(page, 'Malachai').locator('[data-reminder="molten-shell"]')).toBeVisible();
    await expect(
      hudCard(page, 'Orlin').locator('[data-reminder="alert-initiative-swap"]')
    ).toContainText('Swap your initiative with a willing ally.');
  });

  test('potion stock is the same counter the Ledger edits', async ({ page, request }) => {
    const potionStock = (c) =>
      c.resources.find((r) => r.resource_name === 'Healing Potions').current_value;

    await page.goto('/');
    await page.getByTestId('tab-ledger').click(); // HUD is the default view now
    const uppyLedger = page.getByRole('article', { name: 'Uppy Beauty' });
    await uppyLedger.getByTestId('counter-inc').click();
    await expect(uppyLedger.getByTestId('counter-value')).toHaveText('4');

    await page.getByTestId('tab-hud').click();
    await expect(
      hudCard(page, 'Uppy Beauty')
        .locator('[data-consumable="Healing Potions"]')
        .getByTestId('consumable-count')
    ).toHaveText('4');

    // Restore the seed value for the other spec files — and wait for the
    // write to land in SQLite so the test can't leak state.
    await page.getByTestId('tab-ledger').click();
    await uppyLedger.getByTestId('counter-dec').click();
    await expect(uppyLedger.getByTestId('counter-value')).toHaveText('3');
    await expectServerState(request, 'Uppy Beauty', potionStock, 3);
  });
});

test.describe('Bloodied indicator', () => {
  test('appears strictly below 50% of max HP and clears when healed', async ({ page, request }) => {
    const { id } = await getCharacter(request, 'Uppy Beauty'); // 66 max HP, half = 33
    await patchCharacter(request, id, { current_hp: 33 });

    try {
      await openHud(page);
      const uppy = hudCard(page, 'Uppy Beauty');
      await expect(uppy.getByTestId('bloodied')).toHaveCount(0); // 33 is exactly half, not below

      await uppy.getByTestId('hud-hp').fill('32'); // 32 < 33
      await uppy.getByTestId('hud-hp').blur(); // commit the edit
      await expect(uppy.getByTestId('bloodied')).toBeVisible();

      await uppy.getByTestId('hud-hp').fill('33'); // back to half
      await uppy.getByTestId('hud-hp').blur();
      await expect(uppy.getByTestId('bloodied')).toHaveCount(0);
      // Both optimistic PATCHes must land before the restore below runs,
      // or a late edit-PATCH would overwrite it.
      await expectServerState(request, 'Uppy Beauty', (c) => c.current_hp, 33);
    } finally {
      await patchCharacter(request, id, { current_hp: 66 });
    }
  });
});

test.describe('Conditional reminders (Lobos)', () => {
  test('Invoke Rune shows the hit dice count and hides at 0 dice', async ({ page, request }) => {
    const { id } = await getCharacter(request, 'Lobos');

    try {
      await openHud(page);
      const lobos = hudCard(page, 'Lobos');
      const rune = lobos.locator('[data-reminder="bloodshed-greatsword"]');
      await expect(rune).toContainText('10 Hit Dice remaining');

      await lobos.getByTestId('hd-dec-1').click(); // live count, no reload
      await expect(rune).toContainText('9 Hit Dice remaining');
      await expectServerState(request, 'Lobos', (c) => c.current_hit_dice, 9); // click settled

      await patchCharacter(request, id, { current_hit_dice: 0 });
      await page.reload();
      await expect(lobos.locator('[data-reminder="bloodshed-greatsword"]')).toHaveCount(0);
      await expect(lobos.locator('[data-reminder="shift"]')).toBeVisible(); // unconditional ones stay
    } finally {
      await patchCharacter(request, id, { current_hit_dice: 10 });
    }
  });

  test('Bloodsmelt Plate appears only when bloodied AND hit dice remain', async ({
    page,
    request,
  }) => {
    const { id } = await getCharacter(request, 'Lobos'); // 139 max HP, bloodied below 69.5

    try {
      await openHud(page);
      const lobos = hudCard(page, 'Lobos');
      const plate = lobos.locator('[data-reminder="bloodsmelt-plate"]');
      await expect(plate).toHaveCount(0); // full HP: not bloodied

      await patchCharacter(request, id, { current_hp: 41 });
      await page.reload();
      await expect(lobos.getByTestId('bloodied')).toBeVisible();
      await expect(plate).toContainText('10 Hit Dice remaining');

      // Bloodied but out of hit dice -> reminder hides again.
      await patchCharacter(request, id, { current_hit_dice: 0 });
      await page.reload();
      await expect(lobos.getByTestId('bloodied')).toBeVisible();
      await expect(plate).toHaveCount(0);
    } finally {
      await patchCharacter(request, id, { current_hp: 139, current_hit_dice: 10 });
    }
  });
});

test.describe('Twilight Sanctuary toggle (Uppy)', () => {
  test('reminder hides while Active, comes back when ended, persists across reloads', async ({
    page,
    request,
  }) => {
    const sanctuaryActive = (c) =>
      c.resources.find((r) => r.resource_name === 'Channel Divinity (Twilight)').is_active;

    await openHud(page);
    const uppy = hudCard(page, 'Uppy Beauty');
    const sanctuary = uppy.locator('[data-reminder="twilight-sanctuary"]');
    await expect(sanctuary).toBeVisible();
    await expect(uppy.getByTestId('active-feature')).toHaveCount(0);

    await uppy.getByTestId('activate-twilight-sanctuary').click();
    await expect(sanctuary).toHaveCount(0);
    await expect(uppy.getByTestId('active-feature')).toContainText('Twilight Sanctuary — Active');
    await expectServerState(request, 'Uppy Beauty', sanctuaryActive, true); // persisted

    await page.reload(); // active flag lives in SQLite, not client state
    await expect(uppy.locator('[data-reminder="twilight-sanctuary"]')).toHaveCount(0);

    await uppy.getByTestId('deactivate-twilight-sanctuary').click();
    await expect(uppy.locator('[data-reminder="twilight-sanctuary"]')).toBeVisible();
    await expect(uppy.getByTestId('active-feature')).toHaveCount(0);
    await expectServerState(request, 'Uppy Beauty', sanctuaryActive, false); // no state leak
  });

  test('reminder also hides when no Channel Divinity uses remain', async ({ page, request }) => {
    const uppy = await getCharacter(request, 'Uppy Beauty');
    const cd = uppy.resources.find((r) => r.resource_name === 'Channel Divinity (Twilight)');
    await request.post(`/api/resources/${cd.id}/usage`, { data: { action: 'set', value: 0 } });

    try {
      await openHud(page);
      const card = hudCard(page, 'Uppy Beauty');
      await expect(card.locator('[data-reminder="vigilant-blessing"]')).toBeVisible();
      await expect(card.locator('[data-reminder="twilight-sanctuary"]')).toHaveCount(0);
    } finally {
      await request.post(`/api/resources/${cd.id}/usage`, { data: { action: 'set', value: 3 } });
    }
  });
});
