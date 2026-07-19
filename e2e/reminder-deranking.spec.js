import { test, expect } from '@playwright/test';

/**
 * De-ranking of depleted reminders on the Combat HUD:
 *  - a freshly seeded party shows no de-ranked reminders,
 *  - spending an ability's FINAL charge (through the Ledger UI, write-through
 *    to SQLite) sinks its reminder to the bottom with muted styling, a Spent
 *    chip, and its recharge trigger (LR / SR +1 · LR / Dawn),
 *  - regaining charges — via a Ledger pip, the party-wide long rest button,
 *    or a dawn recharge — restores the reminder's rank and styling.
 *
 * Tests restore whatever they mutate (shared seeded db per run).
 */

async function getCharacter(request, name) {
  const res = await request.get('/api/characters');
  return (await res.json()).find((c) => c.name === name);
}

const findResource = (character, name) =>
  character.resources.find((r) => r.resource_name === name);

/** Poll the API until an optimistic UI mutation has written through. */
async function expectServerValue(request, characterName, resourceName, value) {
  await expect
    .poll(async () =>
      findResource(await getCharacter(request, characterName), resourceName).current_value
    )
    .toBe(value);
}

const setResource = (request, id, value) =>
  request.post(`/api/resources/${id}/usage`, { data: { action: 'set', value } });

const hudCard = (page, name) => page.getByRole('article', { name: `${name} combat status` });

const reminderOrder = (card) =>
  card.getByTestId('reminder').evaluateAll((els) => els.map((el) => el.dataset.reminder));

/** The Combat HUD is the first tab and the default view — goto lands on it. */
async function openHud(page) {
  await page.goto('/');
  await expect(page.getByTestId('hud-card')).toHaveCount(5);
}

test.describe('Initial load', () => {
  test('a freshly seeded party has no de-ranked reminders on any card', async ({ page }) => {
    await openHud(page);
    await expect(page.getByTestId('reminder').first()).toBeVisible();
    expect(await page.getByTestId('reminder').count()).toBeGreaterThanOrEqual(10); // all five cards populated
    await expect(page.locator('[data-testid="reminder"][data-depleted="true"]')).toHaveCount(0);
    await expect(page.getByTestId('reminder-depleted')).toHaveCount(0);
    await expect(page.getByTestId('reminder-reset')).toHaveCount(0);
  });
});

test.describe('Depleting the final charge', () => {
  test("spending Kit's last Channel Divinity in the Ledger de-ranks Destructive Wrath; a pip restore re-ranks it", async ({
    page,
    request,
  }) => {
    const kitLedger = page.getByRole('article', { name: 'Kit Sofia', exact: true });
    const cdRow = kitLedger.locator('[data-resource="Channel Divinity (Tempest)"]');
    const kitHud = hudCard(page, 'Kit Sofia');
    const wrath = kitHud.locator('[data-reminder="destructive-wrath"]');
    const cd = findResource(await getCharacter(request, 'Kit Sofia'), 'Channel Divinity (Tempest)');

    try {
      await page.goto('/');
      await page.getByTestId('tab-ledger').click(); // HUD is the default view

      // Burn all 3 uses through the Ledger pips — the real table flow.
      for (let remaining = 3; remaining > 0; remaining--) {
        await cdRow.locator('[data-testid="pip"][data-filled="true"]').last().click();
        await expect(cdRow.locator('[data-testid="pip"][data-filled="true"]')).toHaveCount(
          remaining - 1
        );
      }
      await expectServerValue(request, 'Kit Sofia', 'Channel Divinity (Tempest)', 0);

      // HUD: the reminder is de-ranked to the bottom, marked, and shows its
      // reset trigger (Tempest CD regains 1 on a short rest, all on a long).
      await page.getByTestId('tab-hud').click();
      await expect(wrath).toHaveAttribute('data-depleted', 'true');
      await expect(wrath.getByTestId('reminder-depleted')).toHaveText('Spent');
      await expect(wrath.getByTestId('reminder-reset')).toHaveText('SR +1 · LR');
      expect(await reminderOrder(kitHud)).toEqual([
        'wrath-of-the-storm',
        'divine-intervention',
        'destructive-wrath',
      ]);
      // The other reminders stay ranked and unmarked.
      await expect(
        kitHud.locator('[data-reminder="wrath-of-the-storm"]')
      ).toHaveAttribute('data-depleted', 'false');

      // Depletion is server state, not client state: it survives a reload.
      await page.reload();
      await expect(wrath).toHaveAttribute('data-depleted', 'true');

      // Regain a single use in the Ledger — one charge is enough to re-rank.
      await page.getByTestId('tab-ledger').click();
      await cdRow.getByTestId('pip').first().click(); // hollow pip -> restore
      await expectServerValue(request, 'Kit Sofia', 'Channel Divinity (Tempest)', 1);
      await page.getByTestId('tab-hud').click();
      await expect(wrath).toHaveAttribute('data-depleted', 'false');
      await expect(wrath.getByTestId('reminder-depleted')).toHaveCount(0);
      await expect(wrath.getByTestId('reminder-reset')).toHaveCount(0);
      expect(await reminderOrder(kitHud)).toEqual([
        'destructive-wrath',
        'wrath-of-the-storm',
        'divine-intervention',
      ]);
    } finally {
      await setResource(request, cd.id, 3);
    }
  });
});

test.describe('Recharging via a party rest', () => {
  test("a long rest restores Uppy's spent Divine Intervention and un-de-ranks it live", async ({
    page,
    request,
  }) => {
    const di = findResource(await getCharacter(request, 'Uppy Beauty'), 'Divine Intervention');
    const uppyHud = hudCard(page, 'Uppy Beauty');
    const diReminder = uppyHud.locator('[data-reminder="divine-intervention"]');

    try {
      await setResource(request, di.id, 0);
      await openHud(page);

      await expect(diReminder).toHaveAttribute('data-depleted', 'true');
      await expect(diReminder.getByTestId('reminder-reset')).toHaveText('LR');
      expect(await reminderOrder(uppyHud)).toEqual([
        'vigilant-blessing',
        'twilight-sanctuary',
        'divine-intervention',
      ]);

      // The header's long rest refreshes the party in one round trip — the
      // reminder must recover without a reload.
      await page.getByRole('button', { name: 'Take long rest' }).click();
      await expect(diReminder).toHaveAttribute('data-depleted', 'false');
      await expect(diReminder.getByTestId('reminder-depleted')).toHaveCount(0);
      await expectServerValue(request, 'Uppy Beauty', 'Divine Intervention', 1);
    } finally {
      await setResource(request, di.id, 1); // no-op after a successful rest
    }
  });
});

test.describe('Dawn-recharge items', () => {
  test("Lobos's rune reminder de-ranks with a Dawn tag when the item's charge is gone, and recovers when recharged", async ({
    page,
    request,
  }) => {
    const rune = findResource(
      await getCharacter(request, 'Lobos'),
      'Bloodshed Greatsword - Invoke Rune'
    );
    const lobosHud = hudCard(page, 'Lobos');
    const runeReminder = lobosHud.locator('[data-reminder="bloodshed-greatsword"]');

    try {
      await setResource(request, rune.id, 0);
      await openHud(page);

      // Hit dice remain, so the reminder is still listed — but de-ranked
      // below the at-will Crimson Rite, tagged with its dawn recharge.
      await expect(runeReminder).toBeVisible();
      await expect(runeReminder).toHaveAttribute('data-depleted', 'true');
      await expect(runeReminder.getByTestId('reminder-reset')).toHaveText('Dawn');
      expect(await reminderOrder(lobosHud)).toEqual([
        'shift',
        'crimson-rite',
        'bloodshed-greatsword',
      ]);

      // Dawn breaks (the DM hands the charge back) — rank is restored.
      await setResource(request, rune.id, 1);
      await page.reload();
      await expect(runeReminder).toHaveAttribute('data-depleted', 'false');
      expect(await reminderOrder(lobosHud)).toEqual([
        'shift',
        'bloodshed-greatsword',
        'crimson-rite',
      ]);
    } finally {
      await setResource(request, rune.id, 1);
    }
  });
});
