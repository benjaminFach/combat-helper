import { test, expect } from '@playwright/test';

/**
 * Treasury tab: a sortable, searchable, paginated loot table fed by
 * GET /api/loot. The seed ships 15 items so the default 10-per-page view has
 * two pages out of the box.
 *
 * Edge-case setups (empty vault, 100+ entries) go through the loot API and
 * restore what they change — the seeded db is shared by every spec in a run.
 */

const getLoot = async (request) => (await request.get('/api/loot')).json();

async function openTreasury(page) {
  await page.goto('/');
  await page.getByTestId('tab-treasury').click();
  await expect(page.getByTestId('loot-table')).toBeVisible();
}

const rowNames = (page) =>
  page
    .getByTestId('loot-row')
    .evaluateAll((rows) => rows.map((r) => r.querySelector('td').textContent.trim()));

const pageInfo = (page) => page.getByTestId('loot-page-info');

test.describe('Treasury tab behavior', () => {
  test('is the third tab and swaps cleanly with the HUD and Ledger views', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('tab')).toHaveText(['Combat HUD', 'Ledger', 'Treasury']);
    await expect(page.getByTestId('loot-table')).toHaveCount(0); // HUD is the default

    await page.getByTestId('tab-treasury').click();
    await expect(page.getByTestId('tab-treasury')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('loot-table')).toBeVisible();
    await expect(page.getByTestId('hud-card')).toHaveCount(0);
    await expect(page.getByRole('article', { name: 'Lobos', exact: true })).toHaveCount(0);

    await page.getByTestId('tab-ledger').click();
    await expect(page.getByRole('article', { name: 'Lobos', exact: true })).toBeVisible();
    await expect(page.getByTestId('loot-table')).toHaveCount(0);

    await page.getByTestId('tab-treasury').click();
    await expect(page.getByTestId('loot-table')).toBeVisible();
    await page.getByTestId('tab-hud').click();
    await expect(page.getByTestId('hud-card')).toHaveCount(5);
  });

  test('treasury view state (search, sort, page size) survives visiting other tabs', async ({
    page,
  }) => {
    await openTreasury(page);

    await page.getByTestId('loot-search').fill('orlin');
    await page.getByTestId('loot-sort-value').click();
    await page.getByTestId('loot-sort-value').click(); // descending
    await expect(await rowNames(page)).toEqual(['Bag of Holding', 'Dragonbone Dice Set']);

    await page.getByTestId('tab-ledger').click();
    await expect(page.getByRole('article', { name: 'Lobos', exact: true })).toBeVisible();
    await page.getByTestId('tab-treasury').click();

    // Search text, filter, and sort all survived the unmount.
    await expect(page.getByTestId('loot-search')).toHaveValue('orlin');
    expect(await rowNames(page)).toEqual(['Bag of Holding', 'Dragonbone Dice Set']);
  });

  test("visiting the Treasury does not reset the Ledger's charge state", async ({
    page,
    request,
  }) => {
    const uppy = page.getByRole('article', { name: 'Uppy Beauty', exact: true });
    const steps = uppy.locator('[data-resource="Steps of Night"]');
    const filled = steps.locator('[data-testid="pip"][data-filled="true"]');
    const party = await (await request.get('/api/characters')).json();
    const stepsRow = party
      .find((c) => c.name === 'Uppy Beauty')
      .resources.find((r) => r.resource_name === 'Steps of Night');

    try {
      await page.goto('/');
      await page.getByTestId('tab-ledger').click();
      await filled.last().click(); // 4 -> 3
      await expect(filled).toHaveCount(3);

      await page.getByTestId('tab-treasury').click();
      await expect(page.getByTestId('loot-table')).toBeVisible();
      await page.getByTestId('tab-ledger').click();

      await expect(filled).toHaveCount(3); // not reset by the detour
    } finally {
      await request.post(`/api/resources/${stepsRow.id}/usage`, {
        data: { action: 'set', value: 4 },
      });
    }
  });
});

test.describe('Viewable loot', () => {
  test('renders the seeded treasury paginated at 10 rows, sorted by name', async ({ page }) => {
    await openTreasury(page);

    await expect(page.getByTestId('loot-row')).toHaveCount(10);
    await expect(pageInfo(page)).toHaveText('Page 1 of 2');
    await expect(page.getByTestId('loot-range')).toHaveText('Showing 1–10 of 15');

    const names = await rowNames(page);
    expect(names[0]).toBe("Alchemist's Fire");
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

    // Holder/qty/value columns render from the join: held items name their
    // character, pooled items say Party, and stacked items show the TOTAL
    // (unit x quantity) with a per-unit hint.
    const bagCells = await page
      .getByTestId('loot-row')
      .filter({ hasText: 'Bag of Holding' })
      .locator('td')
      .allTextContents();
    expect(bagCells[2]).toBe('Orlin');
    expect(bagCells[3]).toBe('1');
    expect(bagCells[4].trim()).toBe('4000 gp');
    const pouchCells = await page
      .getByTestId('loot-row')
      .filter({ hasText: 'Gold Pouch' })
      .locator('td')
      .allTextContents();
    expect(pouchCells[2]).toBe('Party');
    const flaskCells = await page
      .getByTestId('loot-row')
      .filter({ hasText: "Alchemist's Fire" })
      .locator('td')
      .allTextContents();
    expect(flaskCells[3]).toBe('3');
    expect(flaskCells[4]).toContain('150 gp'); // 50 gp x 3
    expect(flaskCells[4]).toContain('50 gp ea');

    await page.getByTestId('loot-next').click();
    await expect(page.getByTestId('loot-row')).toHaveCount(5);
    await expect(page.getByTestId('loot-range')).toHaveText('Showing 11–15 of 15');
    await expect(page.getByTestId('loot-next')).toBeDisabled();
  });

  test('sorts by value numerically in both directions via the column header', async ({ page }) => {
    await openTreasury(page);

    await page.getByTestId('loot-sort-value').click();
    let names = await rowNames(page);
    // Totals 25, 100, 150 lead — Alchemist's Fire is 50 gp x 3, so it sorts by
    // its 150 gp total, and a lexicographic sort would misplace all of them.
    expect(names.slice(0, 3)).toEqual([
      'Dragonbone Dice Set',
      'Silvered Longsword',
      "Alchemist's Fire",
    ]);

    await page.getByTestId('loot-sort-value').click();
    names = await rowNames(page);
    expect(names.slice(0, 2)).toEqual(['Cloak of Elvenkind', 'Immovable Rod']); // 5000, 4800
  });

  test('the page-size selector expands the view up to 100 rows', async ({ page }) => {
    await openTreasury(page);
    await page.getByTestId('loot-page-size').selectOption('100');
    await expect(page.getByTestId('loot-row')).toHaveCount(15);
    await expect(pageInfo(page)).toHaveText('Page 1 of 1');
  });

  test('an emptied vault shows the empty state instead of a broken table', async ({
    page,
    request,
  }) => {
    const snapshot = await getLoot(request);
    try {
      for (const item of snapshot) {
        await request.delete(`/api/loot/${item.id}`);
      }
      await openTreasury(page);
      await expect(page.getByTestId('loot-row')).toHaveCount(0);
      await expect(page.getByTestId('loot-empty')).toContainText('The vault is empty');
      await expect(pageInfo(page)).toHaveText('Page 1 of 1');
      await expect(page.getByTestId('loot-range')).toHaveText('Showing 0–0 of 0');
    } finally {
      await request.post('/api/loot', {
        data: snapshot.map(({ name, description, character_id, value_gp, quantity }) => ({
          name,
          description,
          character_id,
          value_gp,
          quantity,
        })),
      });
    }
  });

  test('handles more items than the largest page size (100)', async ({ page, request }) => {
    const filler = Array.from({ length: 110 }, (_, i) => ({
      name: `Copper Trinket #${String(i + 1).padStart(3, '0')}`,
      description: 'Bulk salvage from the warehouse job.',
      value_gp: 1,
    }));
    const created = await (await request.post('/api/loot', { data: filler })).json();

    try {
      await openTreasury(page);
      await page.getByTestId('loot-page-size').selectOption('100');
      await expect(page.getByTestId('loot-row')).toHaveCount(100);
      await expect(pageInfo(page)).toHaveText('Page 1 of 2'); // 125 items total
      await expect(page.getByTestId('loot-range')).toHaveText('Showing 1–100 of 125');

      await page.getByTestId('loot-next').click();
      await expect(page.getByTestId('loot-row')).toHaveCount(25);
      await expect(page.getByTestId('loot-next')).toBeDisabled();
    } finally {
      for (const item of created) {
        await request.delete(`/api/loot/${item.id}`);
      }
    }
  });
});

test.describe('Searchable loot', () => {
  test('filters live, keeps the active sort, and restores everything when cleared', async ({
    page,
  }) => {
    await openTreasury(page);
    await page.getByTestId('loot-sort-value').click();
    await page.getByTestId('loot-sort-value').click(); // value descending

    await page.getByTestId('loot-search').fill('uppy');
    await expect(page.getByTestId('loot-row')).toHaveCount(2);
    // Sort respected while searching: 400 gp before 300 gp.
    expect(await rowNames(page)).toEqual(['Pearl of Power', 'Scroll of Revivify']);
    await expect(pageInfo(page)).toHaveText('Page 1 of 1');

    await page.getByTestId('loot-search').fill('');
    await expect(page.getByTestId('loot-row')).toHaveCount(10); // back to page 1 of everything
    await expect(pageInfo(page)).toHaveText('Page 1 of 2');
    expect((await rowNames(page))[0]).toBe('Cloak of Elvenkind'); // sort still value desc
  });

  test('narrowing a search shrinks the page count and snaps back to page 1', async ({ page }) => {
    await openTreasury(page);
    await page.getByTestId('loot-next').click();
    await expect(pageInfo(page)).toHaveText('Page 2 of 2');

    await page.getByTestId('loot-search').fill('gold');
    await expect(pageInfo(page)).toHaveText('Page 1 of 1');
    expect(await rowNames(page)).toEqual(['Gold Pouch']);
  });

  test('a search with no matches names the query in its empty state', async ({ page }) => {
    await openTreasury(page);
    await page.getByTestId('loot-search').fill('vorpal sword');
    await expect(page.getByTestId('loot-row')).toHaveCount(0);
    await expect(page.getByTestId('loot-empty')).toContainText('No loot matches “vorpal sword”');

    await page.getByTestId('loot-search').fill('');
    await expect(page.getByTestId('loot-row')).toHaveCount(10);
  });

  test('searching an empty vault reports the empty vault, not a phantom match', async ({
    page,
    request,
  }) => {
    const snapshot = await getLoot(request);
    try {
      for (const item of snapshot) {
        await request.delete(`/api/loot/${item.id}`);
      }
      await openTreasury(page);
      await page.getByTestId('loot-search').fill('anything at all');
      await expect(page.getByTestId('loot-empty')).toContainText('No loot matches');
      await page.getByTestId('loot-search').fill('');
      await expect(page.getByTestId('loot-empty')).toContainText('The vault is empty');
    } finally {
      await request.post('/api/loot', {
        data: snapshot.map(({ name, description, character_id, value_gp, quantity }) => ({
          name,
          description,
          character_id,
          value_gp,
          quantity,
        })),
      });
    }
  });
});
