import { test, expect } from '@playwright/test';

/**
 * The Healing Potions counter must both update the DOM optimistically and
 * write through to SQLite — page.reload() after each click proves the value
 * survived the round trip and isn't just client state.
 *
 * The stack is re-seeded before every run (see playwright.config.js), so
 * Uppy Beauty always starts with 3 potions.
 */
test.describe('Healing Potions counter', () => {
  test('[+] and [-] update the DOM and persist across reloads', async ({ page }) => {
    await page.goto('/');

    const uppy = page.getByRole('article', { name: 'Uppy Beauty' });
    await expect(uppy).toBeVisible();

    // Exactly one consumable per card, so the testids are unambiguous within it.
    const counter = uppy.getByTestId('counter-value');
    await expect(counter).toHaveText('3'); // fresh seed

    await uppy.getByTestId('counter-inc').click();
    await expect(counter).toHaveText('4');

    await page.reload();
    await expect(uppy.getByTestId('counter-value')).toHaveText('4'); // persisted, not optimistic

    await uppy.getByTestId('counter-dec').click();
    await expect(uppy.getByTestId('counter-value')).toHaveText('3');

    await page.reload();
    await expect(uppy.getByTestId('counter-value')).toHaveText('3');
  });

  test("counters are per-character — Kit's stock is untouched by Uppy's clicks", async ({
    page,
  }) => {
    await page.goto('/');

    const uppy = page.getByRole('article', { name: 'Uppy Beauty' });
    const kit = page.getByRole('article', { name: 'Kit Sofia' });

    await uppy.getByTestId('counter-inc').click();
    await expect(uppy.getByTestId('counter-value')).toHaveText('4');
    await expect(kit.getByTestId('counter-value')).toHaveText('3');

    // Put the shared seeded db back so test order never matters.
    await uppy.getByTestId('counter-dec').click();
    await expect(uppy.getByTestId('counter-value')).toHaveText('3');
  });
});
