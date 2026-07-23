import { test, expect } from '@playwright/test';

/**
 * Treasury transactions: the add-item modal (with validation on both ends),
 * the remove confirmation, and the sell flow that moves value from the loot
 * table into the party purse (pp/gp/ep/sp/cp).
 *
 * The seed purse is { platinum: 12, gold: 447, electrum: 0, silver: 210,
 * copper: 89 }; every test restores whatever loot/coins it touches.
 */

const SEED_PURSE = { platinum: 12, gold: 447, electrum: 0, silver: 210, copper: 89 };

const getLoot = async (request) => (await request.get('/api/loot')).json();
const findByName = async (request, name) => (await getLoot(request)).find((l) => l.name === name);
const resetPurse = (request) => request.put('/api/currency', { data: SEED_PURSE });

async function openTreasury(page) {
  await page.goto('/');
  await page.getByTestId('tab-treasury').click();
  await expect(page.getByTestId('loot-table')).toBeVisible();
}

/** Search for one item so its row is the only one on screen. */
async function focusRow(page, name) {
  await page.getByTestId('loot-search').fill(name);
  await expect(page.getByTestId('loot-row')).toHaveCount(1);
  return page.getByTestId('loot-row').first();
}

test.describe('Party purse display', () => {
  test('all five denominations render from the seed', async ({ page }) => {
    await openTreasury(page);
    const bar = page.getByTestId('currency-bar');
    await expect(bar).toBeVisible();
    for (const [denom, amount] of Object.entries(SEED_PURSE)) {
      await expect(page.getByTestId(`currency-${denom}`)).toHaveText(String(amount));
    }
    await expect(bar).toContainText('pp');
    await expect(bar).toContainText('ep'); // electrum, the oft-forgotten one
  });
});

test.describe('Modify currency modal', () => {
  test('adding and subtracting coins through the modal updates the displayed purse', async ({
    page,
    request,
  }) => {
    try {
      await openTreasury(page);
      await page.getByTestId('currency-modify').click();
      const modal = page.getByTestId('modal-currency');
      await expect(modal).toBeVisible();

      // Pre-filled from the live purse.
      await expect(modal.getByTestId('currency-input-gold')).toHaveValue('447');

      // + gold three times, − copper twice.
      for (let i = 0; i < 3; i++) await modal.getByTestId('currency-inc-gold').click();
      await modal.getByTestId('currency-dec-copper').click();
      await modal.getByTestId('currency-dec-copper').click();
      await expect(modal.getByTestId('currency-input-gold')).toHaveValue('450');
      await expect(modal.getByTestId('currency-input-copper')).toHaveValue('87');

      await modal.getByTestId('currency-confirm').click();
      await expect(modal).toHaveCount(0);

      // The bar above the table reflects the confirmed purse immediately...
      await expect(page.getByTestId('currency-gold')).toHaveText('450');
      await expect(page.getByTestId('currency-copper')).toHaveText('87');
      await expect(page.getByTestId('currency-silver')).toHaveText('210'); // untouched
      // ...matches the API...
      expect(await (await request.get('/api/currency')).json()).toEqual({
        ...SEED_PURSE,
        gold: 450,
        copper: 87,
      });
      // ...and survives a reload.
      await page.reload();
      await page.getByTestId('tab-treasury').click();
      await expect(page.getByTestId('currency-gold')).toHaveText('450');
      await expect(page.getByTestId('currency-copper')).toHaveText('87');
    } finally {
      await resetPurse(request);
    }
  });

  test('no denomination can go below zero, and cancel discards edits', async ({
    page,
    request,
  }) => {
    await openTreasury(page);
    await page.getByTestId('currency-modify').click();
    const modal = page.getByTestId('modal-currency');

    // Electrum is 0: its − is disabled outright.
    await expect(modal.getByTestId('currency-dec-electrum')).toBeDisabled();

    // A typed negative blocks the save with a message.
    await modal.getByTestId('currency-input-silver').fill('-5');
    await expect(modal.getByTestId('currency-errors')).toContainText(
      'Silver (sp) must be a whole number of 0 or more.'
    );
    await expect(modal.getByTestId('currency-confirm')).toBeDisabled();

    // Backing out leaves the purse untouched in the UI and the database.
    await modal.getByTestId('currency-cancel').click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId('currency-silver')).toHaveText('210');
    expect(await (await request.get('/api/currency')).json()).toEqual(SEED_PURSE);

    // The backend independently refuses to store a negative value.
    const res = await request.put('/api/currency', { data: { silver: -5 } });
    expect(res.status()).toBe(400);
    expect((await (await request.get('/api/currency')).json()).silver).toBe(210);
  });
});

test.describe('Add item modal', () => {
  test('adds a stacked item that lands in the table and in SQLite', async ({ page, request }) => {
    try {
      await openTreasury(page);
      await page.getByTestId('loot-add').click();
      const modal = page.getByTestId('modal-add');
      await expect(modal).toBeVisible();

      await modal.getByTestId('add-name').fill('Moonlit Arrows');
      await modal.getByTestId('add-description').fill('Glow faintly; +1 to hit in darkness.');
      await modal.getByTestId('add-holder').selectOption({ label: 'Kit Sofia' });
      await modal.getByTestId('add-value').fill('15');
      await modal.getByTestId('add-quantity').fill('12');
      await expect(modal.getByTestId('add-errors')).toHaveCount(0);
      await modal.getByTestId('add-confirm').click();
      await expect(modal).toHaveCount(0); // closed on success

      const row = await focusRow(page, 'Moonlit Arrows');
      const cells = await row.locator('td').allTextContents();
      expect(cells[2]).toBe('Kit Sofia');
      expect(cells[3]).toBe('12');
      expect(cells[4]).toContain('180 gp'); // 15 gp x 12 total

      // Write-through: the row survives a full reload.
      await page.reload();
      await page.getByTestId('tab-treasury').click();
      await focusRow(page, 'Moonlit Arrows');
      const stored = await findByName(request, 'Moonlit Arrows');
      expect(stored).toMatchObject({ value_gp: 15, quantity: 12 });
    } finally {
      const leftover = await findByName(request, 'Moonlit Arrows');
      if (leftover) await request.delete(`/api/loot/${leftover.id}`);
    }
  });

  test('blocks blank fields, negative values, and bad quantities before any request', async ({
    page,
    request,
  }) => {
    const before = (await getLoot(request)).length;
    await openTreasury(page);
    await page.getByTestId('loot-add').click();
    const modal = page.getByTestId('modal-add');

    // Fresh modal: the three required fields are called out, submit is dead.
    await expect(modal.getByTestId('add-errors')).toContainText('Item name is required.');
    await expect(modal.getByTestId('add-errors')).toContainText('Description is required.');
    await expect(modal.getByTestId('add-errors')).toContainText('Choose who holds the item.');
    await expect(modal.getByTestId('add-confirm')).toBeDisabled();

    // Whitespace names and negative numbers do not count as fixed.
    await modal.getByTestId('add-name').fill('   ');
    await modal.getByTestId('add-description').fill('Something.');
    await modal.getByTestId('add-holder').selectOption('party');
    await modal.getByTestId('add-value').fill('-5');
    await modal.getByTestId('add-quantity').fill('0');
    await expect(modal.getByTestId('add-errors')).toContainText('Item name is required.');
    await expect(modal.getByTestId('add-errors')).toContainText(
      'Unit value must be a whole number of 0 or more.'
    );
    await expect(modal.getByTestId('add-errors')).toContainText(
      'Quantity must be a whole number of 1 or more.'
    );
    await expect(modal.getByTestId('add-confirm')).toBeDisabled();

    await modal.getByTestId('add-cancel').click();
    await expect(modal).toHaveCount(0);
    expect((await getLoot(request)).length).toBe(before); // nothing was created

    // The backend enforces the same rules even without the UI.
    const res = await request.post('/api/loot', {
      data: { name: '   ', description: 'x', value_gp: -1 },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('Remove item', () => {
  test('confirming the modal removes the item from table and database', async ({
    page,
    request,
  }) => {
    const temp = await (
      await request.post('/api/loot', {
        data: { name: 'Cracked Vase', description: 'Worthless but sentimental.', value_gp: 1 },
      })
    ).json();

    try {
      await openTreasury(page);
      const row = await focusRow(page, 'Cracked Vase');
      await row.getByTestId('loot-remove').click();

      const modal = page.getByTestId('modal-remove');
      await expect(modal).toContainText('Remove Cracked Vase?');
      await modal.getByTestId('remove-confirm').click();
      await expect(modal).toHaveCount(0);

      await expect(page.getByTestId('loot-row')).toHaveCount(0); // filtered view now empty
      await expect(page.getByTestId('loot-empty')).toContainText('No loot matches');
      expect(await findByName(request, 'Cracked Vase')).toBeUndefined(); // gone server-side
    } finally {
      const leftover = await findByName(request, 'Cracked Vase');
      if (leftover) await request.delete(`/api/loot/${leftover.id}`);
    }
  });

  test('backing out of the confirmation keeps the item', async ({ page, request }) => {
    await openTreasury(page);
    const row = await focusRow(page, 'Obsidian Idol'); // seeded item
    await row.getByTestId('loot-remove').click();
    await expect(page.getByTestId('modal-remove')).toBeVisible();

    await page.getByTestId('remove-cancel').click();
    await expect(page.getByTestId('modal-remove')).toHaveCount(0);

    await expect(page.getByTestId('loot-row')).toHaveCount(1); // still on screen
    expect(await findByName(request, 'Obsidian Idol')).toBeTruthy(); // still in SQLite
  });
});

test.describe('Sell item', () => {
  test('a partial sale can pay out in a mix of coins, all landing in the purse', async ({
    page,
    request,
  }) => {
    const flasks = await findByName(request, "Alchemist's Fire"); // qty 3 @ 50 gp

    try {
      await openTreasury(page);
      const row = await focusRow(page, "Alchemist's Fire");
      await row.getByTestId('loot-sell').click();

      const modal = page.getByTestId('modal-sell');
      await expect(modal).toContainText('You have 3 at 50 gp each');
      await modal.getByTestId('sell-quantity').fill('2');
      // One sale, three denominations: 80 gp + 5 sp + 20 cp.
      await modal.getByTestId('sell-amount-gold').fill('80');
      await modal.getByTestId('sell-amount-silver').fill('5');
      await modal.getByTestId('sell-amount-copper').fill('20');
      await modal.getByTestId('sell-confirm').click();
      await expect(modal).toHaveCount(0);

      // Line item updated in place: 1 left, worth 50 gp total now.
      const cells = await page.getByTestId('loot-row').first().locator('td').allTextContents();
      expect(cells[3]).toBe('1');
      expect(cells[4]).toContain('50 gp');

      // Every entered coin grew by its flat amount — NOT 2x — and the ones
      // left blank (pp/ep) did not move.
      await expect(page.getByTestId('currency-gold')).toHaveText('527'); // 447 + 80
      await expect(page.getByTestId('currency-silver')).toHaveText('215'); // 210 + 5
      await expect(page.getByTestId('currency-copper')).toHaveText('109'); // 89 + 20
      await expect(page.getByTestId('currency-platinum')).toHaveText('12');
      await expect(page.getByTestId('currency-electrum')).toHaveText('0');
      expect(await (await request.get('/api/currency')).json()).toEqual({
        platinum: 12,
        gold: 527,
        electrum: 0,
        silver: 215,
        copper: 109,
      });
      expect((await findByName(request, "Alchemist's Fire")).quantity).toBe(1);

      // Both survive a reload — server state, not client state.
      await page.reload();
      await page.getByTestId('tab-treasury').click();
      await expect(page.getByTestId('currency-gold')).toHaveText('527');
      await expect(page.getByTestId('currency-copper')).toHaveText('109');
    } finally {
      await request.patch(`/api/loot/${flasks.id}`, { data: { quantity: 3 } });
      await resetPurse(request);
    }
  });

  test('selling the entire quantity removes the line item', async ({ page, request }) => {
    const temp = await (
      await request.post('/api/loot', {
        data: { name: 'Wolf Pelts', description: 'Winter coats, good condition.', value_gp: 10, quantity: 2 },
      })
    ).json();

    try {
      await openTreasury(page);
      const row = await focusRow(page, 'Wolf Pelts');
      await row.getByTestId('loot-sell').click();

      const modal = page.getByTestId('modal-sell');
      await modal.getByTestId('sell-quantity').fill('2');
      await modal.getByTestId('sell-amount-silver').fill('30');
      await modal.getByTestId('sell-confirm').click();
      await expect(modal).toHaveCount(0);

      await expect(page.getByTestId('loot-row')).toHaveCount(0); // row is gone
      await expect(page.getByTestId('currency-silver')).toHaveText('240'); // 210 + 30
      expect(await findByName(request, 'Wolf Pelts')).toBeUndefined();
    } finally {
      const leftover = await findByName(request, 'Wolf Pelts');
      if (leftover) await request.delete(`/api/loot/${leftover.id}`);
      await resetPurse(request);
    }
  });

  test('the UI refuses to sell more than the party owns', async ({ page, request }) => {
    await openTreasury(page);
    const row = await focusRow(page, "Alchemist's Fire"); // qty 3
    await row.getByTestId('loot-sell').click();

    const modal = page.getByTestId('modal-sell');
    await expect(modal.getByTestId('sell-quantity')).toHaveAttribute('max', '3');
    await modal.getByTestId('sell-quantity').fill('4');
    await modal.getByTestId('sell-amount-gold').fill('200');
    await expect(modal.getByTestId('sell-errors')).toContainText(
      'Cannot sell more than you have (3).'
    );
    await expect(modal.getByTestId('sell-confirm')).toBeDisabled();
    await modal.getByTestId('sell-cancel').click();

    // Nothing moved, on either side of the API.
    expect((await findByName(request, "Alchemist's Fire")).quantity).toBe(3);
    expect((await (await request.get('/api/currency')).json()).gold).toBe(SEED_PURSE.gold);

    // The backend independently rejects an oversell (409, atomic no-op).
    const flasks = await findByName(request, "Alchemist's Fire");
    const res = await request.post(`/api/loot/${flasks.id}/sell`, {
      data: { quantity: 4, proceeds: { gold: 200 } },
    });
    expect(res.status()).toBe(409);
    expect((await findByName(request, "Alchemist's Fire")).quantity).toBe(3);
    expect((await (await request.get('/api/currency')).json()).gold).toBe(SEED_PURSE.gold);
  });
});

test.describe('Save button reliability across modals', () => {
  /**
   * Regression: `busy` (disables Save) and "which modal to close on success"
   * used to be tracked on shared, single state across all four Treasury
   * modals. Canceling a slow request (e.g. Add) and then opening a DIFFERENT
   * modal (e.g. Modify Currency) left that modal's Save permanently disabled
   * — stuck on the abandoned request's busy flag — with no visible reason.
   * Worse: when the abandoned request finally resolved, its success handler
   * unconditionally closed "the current modal," silently discarding whatever
   * the user was mid-edit on. Each modal now owns its own busy flag and only
   * closes itself if it's still the one open.
   */
  test('Save on the currency modal is not blocked or clobbered by an abandoned Add request', async ({
    page,
    request,
  }) => {
    try {
      await openTreasury(page);

      // Slow down the loot POST so the Add request is still in flight
      // after the user cancels the dialog.
      await page.route('**/api/loot', async (route) => {
        if (route.request().method() === 'POST') {
          await new Promise((r) => setTimeout(r, 2500));
        }
        await route.continue();
      });

      await page.getByTestId('loot-add').click();
      const addModal = page.getByTestId('modal-add');
      await addModal.getByTestId('add-name').fill('Slow Item');
      await addModal.getByTestId('add-description').fill('Added under a slow network.');
      await addModal.getByTestId('add-holder').selectOption('party');
      await addModal.getByTestId('add-confirm').click(); // fires the slow POST
      await addModal.getByTestId('add-cancel').click(); // abandon it before it resolves
      await expect(addModal).toHaveCount(0);

      // Open a different modal while that request is still out.
      await page.getByTestId('currency-modify').click();
      const modal = page.getByTestId('modal-currency');
      await expect(modal).toBeVisible();

      // This is the reported bug: Save must NOT be disabled here.
      await expect(modal.getByTestId('currency-confirm')).toBeEnabled();

      await modal.getByTestId('currency-inc-gold').click();
      await modal.getByTestId('currency-inc-gold').click();
      await modal.getByTestId('currency-confirm').click();

      // Save must actually work: modal closes, purse updates in the UI.
      await expect(modal).toHaveCount(0);
      await expect(page.getByTestId('currency-gold')).toHaveText('449');
      expect((await (await request.get('/api/currency')).json()).gold).toBe(449);

      // The abandoned Add resolves ~2.5s after being fired. It must not
      // reopen any modal or otherwise disturb the page — the currency modal
      // is already closed and saved, and nothing else should appear.
      await page.waitForTimeout(3000);
      await expect(page.getByTestId('modal-add')).toHaveCount(0);
      await expect(page.getByTestId('modal-currency')).toHaveCount(0);

      // The abandoned add's own data still lands server-side — canceling
      // the dialog doesn't cancel the in-flight request.
      const stored = await findByName(request, 'Slow Item');
      expect(stored).toBeTruthy();
    } finally {
      const leftover = await findByName(request, 'Slow Item');
      if (leftover) await request.delete(`/api/loot/${leftover.id}`);
      await resetPurse(request);
    }
  });

  test('a currency edit abandoned in favor of another action does not get silently applied later', async ({
    page,
    request,
  }) => {
    try {
      await openTreasury(page);

      await page.route('**/api/currency', async (route) => {
        if (route.request().method() === 'PUT') {
          await new Promise((r) => setTimeout(r, 2500));
        }
        await route.continue();
      });

      await page.getByTestId('currency-modify').click();
      const currencyModal = page.getByTestId('modal-currency');
      await currencyModal.getByTestId('currency-inc-platinum').click();
      await currencyModal.getByTestId('currency-confirm').click(); // fires the slow PUT
      await currencyModal.getByTestId('currency-cancel').click(); // abandon it
      await expect(currencyModal).toHaveCount(0);

      // Immediately start a totally different action: sell a seeded item.
      const row = await focusRow(page, "Alchemist's Fire");
      await row.getByTestId('loot-sell').click();
      const sellModal = page.getByTestId('modal-sell');
      await sellModal.getByTestId('sell-amount-gold').fill('50');
      await expect(sellModal.getByTestId('sell-confirm')).toBeEnabled(); // not blocked
      await sellModal.getByTestId('sell-confirm').click();
      await expect(sellModal).toHaveCount(0);
      await expect(page.getByTestId('currency-gold')).toHaveText('497'); // 447 + 50

      // The abandoned currency edit resolves later; it must not reopen the
      // currency modal or silently re-apply on top of the sell's result.
      await page.waitForTimeout(3000);
      await expect(page.getByTestId('modal-currency')).toHaveCount(0);
      await expect(page.getByTestId('modal-sell')).toHaveCount(0);
    } finally {
      const flasks = await findByName(request, "Alchemist's Fire");
      if (flasks) await request.patch(`/api/loot/${flasks.id}`, { data: { quantity: 3 } });
      await resetPurse(request);
    }
  });
});

test.describe('Write round-trip time', () => {
  /**
   * Regression guard: currency writes (PUT /api/currency, POST .../sell) were
   * once found taking up to ~20s to resolve because the sqlite file lived on
   * a slow bind mount (see connection.js's defaultDbPath doc comment). These
   * don't assert anything about *why* a write is slow — just that confirming
   * one closes the modal well inside a generous budget, so a regression
   * (e.g. the db moving back onto a slow filesystem, or an accidental extra
   * round trip creeping into the confirm handlers) fails loudly here instead
   * of only showing up as "the app feels slow" days later.
   */
  const BUDGET_MS = 5000;

  test('confirming a currency edit resolves well within budget', async ({ page, request }) => {
    try {
      await openTreasury(page);
      await page.getByTestId('currency-modify').click();
      const modal = page.getByTestId('modal-currency');
      await modal.getByTestId('currency-inc-gold').click();

      const start = Date.now();
      await modal.getByTestId('currency-confirm').click();
      await expect(modal).toHaveCount(0, { timeout: BUDGET_MS });
      expect(Date.now() - start).toBeLessThan(BUDGET_MS);
    } finally {
      await resetPurse(request);
    }
  });

  test('confirming a sale resolves well within budget', async ({ page, request }) => {
    const flasks = await findByName(request, "Alchemist's Fire"); // qty 3 @ 50 gp

    try {
      await openTreasury(page);
      const row = await focusRow(page, "Alchemist's Fire");
      await row.getByTestId('loot-sell').click();
      const modal = page.getByTestId('modal-sell');
      await modal.getByTestId('sell-quantity').fill('1');
      await modal.getByTestId('sell-amount-gold').fill('50');

      const start = Date.now();
      await modal.getByTestId('sell-confirm').click();
      await expect(modal).toHaveCount(0, { timeout: BUDGET_MS });
      expect(Date.now() - start).toBeLessThan(BUDGET_MS);
    } finally {
      const current = await findByName(request, "Alchemist's Fire");
      if (current) {
        await request.patch(`/api/loot/${current.id}`, { data: { quantity: flasks.quantity } });
      }
      await resetPurse(request);
    }
  });
});
