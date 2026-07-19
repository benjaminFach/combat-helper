import { test, expect } from '@playwright/test';

/**
 * The Combat HUD's HP line is one row of directly editable fields —
 * current HP / max HP + temp HP. Edits commit on blur, valid values write
 * through to SQLite, and invalid ones (negative, current above max, junk)
 * are rejected with a toast and reverted without touching the server.
 *
 * Tests restore whatever they mutate (shared seeded db per run).
 */

async function getCharacter(request, name) {
  const res = await request.get('/api/characters');
  return (await res.json()).find((c) => c.name === name);
}

async function expectServerVital(request, name, field, value) {
  await expect.poll(async () => (await getCharacter(request, name))[field]).toBe(value);
}

const hudCard = (page, name) => page.getByRole('article', { name: `${name} combat status` });

async function openHud(page) {
  await page.goto('/');
  await expect(page.getByTestId('hud-card')).toHaveCount(5);
}

/** Fill a vital field and commit it by blurring. */
async function editVital(card, testid, value) {
  await card.getByTestId(testid).fill(value);
  await card.getByTestId(testid).blur();
}

test.describe('Editing the HP line', () => {
  test('current, max, and temp HP each accept a valid edit and write through', async ({
    page,
    request,
  }) => {
    const { id } = await getCharacter(request, 'Uppy Beauty'); // 63/63, temp 0

    try {
      await openHud(page);
      const uppy = hudCard(page, 'Uppy Beauty');

      await editVital(uppy, 'hud-hp', '41');
      await expect(uppy.getByTestId('hud-hp')).toHaveValue('41');
      await expectServerVital(request, 'Uppy Beauty', 'current_hp', 41);

      await editVital(uppy, 'hud-max-hp', '70');
      await expect(uppy.getByTestId('hud-max-hp')).toHaveValue('70');
      await expectServerVital(request, 'Uppy Beauty', 'max_hp', 70);

      await editVital(uppy, 'hud-temp-hp', '8');
      await expect(uppy.getByTestId('hud-temp-hp')).toHaveValue('8');
      await expectServerVital(request, 'Uppy Beauty', 'temp_hp', 8);

      // The edits are server state: they survive a reload.
      await page.reload();
      await expect(hudCard(page, 'Uppy Beauty').getByTestId('hud-hp')).toHaveValue('41');
      await expect(hudCard(page, 'Uppy Beauty').getByTestId('hud-max-hp')).toHaveValue('70');
      await expect(hudCard(page, 'Uppy Beauty').getByTestId('hud-temp-hp')).toHaveValue('8');
    } finally {
      await request.patch(`/api/characters/${id}`, {
        data: { current_hp: 63, max_hp: 63, temp_hp: 0 },
      });
    }
  });

  test('current HP above max is rejected: toast, revert, no write', async ({ page, request }) => {
    await openHud(page);
    const uppy = hudCard(page, 'Uppy Beauty'); // 63/63

    await editVital(uppy, 'hud-hp', '64');
    await expect(page.getByRole('status').last()).toContainText(
      'current HP must be between 0 and 63'
    );
    await expect(uppy.getByTestId('hud-hp')).toHaveValue('63'); // reverted in place
    expect((await getCharacter(request, 'Uppy Beauty')).current_hp).toBe(63); // untouched
  });

  test('negative current HP and negative temp HP are rejected', async ({ page, request }) => {
    await openHud(page);
    const uppy = hudCard(page, 'Uppy Beauty');

    await editVital(uppy, 'hud-hp', '-1');
    await expect(page.getByRole('status').last()).toContainText('between 0 and 63');
    await expect(uppy.getByTestId('hud-hp')).toHaveValue('63');

    await editVital(uppy, 'hud-temp-hp', '-4');
    await expect(page.getByRole('status').last()).toContainText('temp HP cannot be negative');
    await expect(uppy.getByTestId('hud-temp-hp')).toHaveValue('0');

    const server = await getCharacter(request, 'Uppy Beauty');
    expect(server.current_hp).toBe(63);
    expect(server.temp_hp).toBe(0);
  });

  test('max HP below current HP is rejected with guidance', async ({ page, request }) => {
    await openHud(page);
    const uppy = hudCard(page, 'Uppy Beauty'); // current 63

    await editVital(uppy, 'hud-max-hp', '40');
    await expect(page.getByRole('status').last()).toContainText(
      'max HP cannot be below current HP (63)'
    );
    await expect(uppy.getByTestId('hud-max-hp')).toHaveValue('63');
    expect((await getCharacter(request, 'Uppy Beauty')).max_hp).toBe(63);

    // The backend enforces the same rule without the UI (DB CHECK -> 400).
    const { id } = await getCharacter(request, 'Uppy Beauty');
    const res = await request.patch(`/api/characters/${id}`, { data: { max_hp: 40 } });
    expect(res.status()).toBe(400);
    expect((await getCharacter(request, 'Uppy Beauty')).max_hp).toBe(63);
  });

  test('editing HP below half still trips the Bloodied indicator', async ({ page, request }) => {
    const { id } = await getCharacter(request, 'Lobos'); // 83 max, half = 41.5

    try {
      await openHud(page);
      const lobos = hudCard(page, 'Lobos');
      await expect(lobos.getByTestId('bloodied')).toHaveCount(0);

      await editVital(lobos, 'hud-hp', '41');
      await expect(lobos.getByTestId('bloodied')).toBeVisible();
      await expectServerVital(request, 'Lobos', 'current_hp', 41);
    } finally {
      await request.patch(`/api/characters/${id}`, { data: { current_hp: 83 } });
    }
  });
});
