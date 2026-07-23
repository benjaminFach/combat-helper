import { test, expect } from '@playwright/test';

/**
 * Regression coverage for three interaction bugs, all rooted in slow backends:
 *
 * 1. Charge state lost on tab switch — optimistic values used to live only in
 *    the row component, so unmounting the Ledger before a response landed
 *    reset the UI to stale App state (a page refresh "fixed" it because the
 *    server had the writes all along).
 * 2. Multi-use resources locked out after one click — a shared pending flag
 *    disabled every box in the row for the whole round trip.
 * 3. Activating Twilight Sanctuary locked the HUD card's vitals — same shared
 *    pending flag, card-wide.
 *
 * `page.route` delays make the slow backend deterministic. page.request calls
 * bypass routes, so server-truth polling and state restoration stay fast.
 */

async function getCharacter(request, name) {
  const res = await request.get('/api/characters');
  return (await res.json()).find((c) => c.name === name);
}

const findResource = (character, name) =>
  character.resources.find((r) => r.resource_name === name);

/** Poll the API until a resource's usage write-through lands. */
async function expectServerValue(request, characterName, resourceName, value) {
  await expect
    .poll(async () => findResource(await getCharacter(request, characterName), resourceName).current_value)
    .toBe(value);
}

/** Delay every request matching pattern by ms (responses stay intact). */
const delayRoute = (page, pattern, ms) =>
  page.route(pattern, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });

const filledPips = (row) => row.locator('[data-testid="pip"][data-filled="true"]');

test.describe('Ledger state survives tab switching', () => {
  test('spent charges persist across a Ledger → HUD → Ledger roundtrip (fast server)', async ({
    page,
    request,
  }) => {
    const uppy = page.getByRole('article', { name: 'Uppy Beauty', exact: true });
    const steps = uppy.locator('[data-resource="Steps of Night"]'); // 4 uses
    const { id } = findResource(await getCharacter(request, 'Uppy Beauty'), 'Steps of Night');

    try {
      await page.goto('/');
      await page.getByTestId('tab-ledger').click(); // HUD is the default view
      await expect(filledPips(steps)).toHaveCount(4);
      await filledPips(steps).last().click();
      await filledPips(steps).last().click();
      await expect(filledPips(steps)).toHaveCount(2);
      await expectServerValue(request, 'Uppy Beauty', 'Steps of Night', 2);

      await page.getByTestId('tab-hud').click();
      await expect(page.getByTestId('hud-card')).toHaveCount(5);
      await page.getByTestId('tab-ledger').click();

      await expect(filledPips(steps)).toHaveCount(2); // NOT reset to 4
    } finally {
      await request.post(`/api/resources/${id}/usage`, { data: { action: 'set', value: 4 } });
    }
  });

  test('charges spent moments before a tab switch survive responses still in flight', async ({
    page,
    request,
  }) => {
    const uppy = page.getByRole('article', { name: 'Uppy Beauty', exact: true });
    const steps = uppy.locator('[data-resource="Steps of Night"]');
    const { id } = findResource(await getCharacter(request, 'Uppy Beauty'), 'Steps of Night');

    try {
      await page.goto('/');
      await page.getByTestId('tab-ledger').click(); // HUD is the default view
      await delayRoute(page, '**/api/resources/*/usage', 1200);

      // Two spends, then switch tabs immediately — both responses still out.
      await filledPips(steps).last().click();
      await filledPips(steps).last().click();
      await page.getByTestId('tab-hud').click();
      await expect(page.getByTestId('hud-card')).toHaveCount(5);
      await page.getByTestId('tab-ledger').click();

      await expect(filledPips(steps)).toHaveCount(2); // optimistic state survived unmount
      await expectServerValue(request, 'Uppy Beauty', 'Steps of Night', 2); // and reached SQLite

      // The late confirmations must not bounce the UI back either.
      await page.waitForTimeout(1500);
      await expect(filledPips(steps)).toHaveCount(2);
    } finally {
      await request.post(`/api/resources/${id}/usage`, { data: { action: 'set', value: 4 } });
    }
  });
});

test.describe('Multi-use resources stay available during requests', () => {
  test('a second charge can be spent while the first spend is still in flight', async ({
    page,
    request,
  }) => {
    const kit = page.getByRole('article', { name: 'Kit Sofia', exact: true });
    const wrath = kit.locator('[data-resource="Wrath of the Storm"]'); // 5 uses
    const { id } = findResource(await getCharacter(request, 'Kit Sofia'), 'Wrath of the Storm');

    try {
      await page.goto('/');
      await page.getByTestId('tab-ledger').click(); // HUD is the default view
      await delayRoute(page, '**/api/resources/*/usage', 1200);

      await filledPips(wrath).last().click();
      // First response is ~1.2s away — no box may be disabled in the meantime.
      await expect(wrath.locator('[data-testid="pip"][disabled]')).toHaveCount(0);
      await filledPips(wrath).last().click();

      await expect(filledPips(wrath)).toHaveCount(3); // both spends tracked
      await expectServerValue(request, 'Kit Sofia', 'Wrath of the Storm', 3);
      await page.waitForTimeout(1500); // late confirmations must not bounce it
      await expect(filledPips(wrath)).toHaveCount(3);
    } finally {
      await request.post(`/api/resources/${id}/usage`, { data: { action: 'set', value: 5 } });
    }
  });
});

test.describe('Twilight Sanctuary activation does not lock the HUD card', () => {
  test('vitals remain adjustable while the activate request is in flight', async ({
    page,
    request,
  }) => {
    const before = await getCharacter(request, 'Uppy Beauty');
    const cd = findResource(before, 'Channel Divinity (Twilight)');

    try {
      await page.goto('/'); // the HUD is the default view
      const uppy = page.getByRole('article', { name: 'Uppy Beauty combat status' });
      await expect(uppy).toBeVisible();

      // Only the set_active call is slowed; character PATCHes stay fast.
      await delayRoute(page, '**/api/resources/*/usage', 1500);
      await uppy.getByTestId('activate-twilight-sanctuary').click();

      // Reminder flips optimistically; the card must NOT lock up meanwhile.
      await expect(uppy.locator('[data-reminder="twilight-sanctuary"]')).toHaveCount(0);
      for (const id of ['hud-hp', 'hud-max-hp', 'hud-temp-hp', 'hd-dec-1']) {
        await expect(uppy.getByTestId(id), id).toBeEnabled();
      }

      await uppy.getByTestId('hud-hp').fill('62');
      await uppy.getByTestId('hud-hp').blur();
      await expect(uppy.getByTestId('hud-hp')).toHaveValue('62');
      await uppy.getByTestId('hud-temp-hp').fill('1');
      await uppy.getByTestId('hud-temp-hp').blur();
      await expect(uppy.getByTestId('hud-temp-hp')).toHaveValue('1');

      // Everything lands server-side: the delayed toggle and the fast PATCHes.
      await expect
        .poll(async () =>
          findResource(await getCharacter(request, 'Uppy Beauty'), 'Channel Divinity (Twilight)')
            .is_active
        )
        .toBe(true);
      const after = await getCharacter(request, 'Uppy Beauty');
      expect(after.current_hp).toBe(62);
      expect(after.temp_hp).toBe(1);
    } finally {
      await request.post(`/api/resources/${cd.id}/usage`, {
        data: { action: 'set_active', active: false },
      });
      await request.patch(`/api/characters/${before.id}`, {
        data: { current_hp: 66, temp_hp: 0 },
      });
    }
  });
});
