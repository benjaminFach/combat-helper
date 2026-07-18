import { test, expect } from '@playwright/test';

/**
 * Roster smoke test for the full party of five. Each card is an <article>
 * whose accessible name is the character's name, so counting/naming cards
 * proves the seed -> API -> render pipeline end to end.
 *
 * The stack is re-seeded before every run (see playwright.config.js).
 */
test.describe('Party roster', () => {
  test('all 5 character cards render', async ({ page }) => {
    await page.goto('/');

    for (const name of ['Uppy Beauty', 'Kit Sofia', 'Lobos', 'Malachai', 'Orlin']) {
      await expect(page.getByRole('article', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('article')).toHaveCount(5);
  });

  test("Lobos's card lists his resources loaded from the backend", async ({ page }) => {
    await page.goto('/');

    const lobos = page.getByRole('article', { name: 'Lobos', exact: true });
    await expect(lobos).toBeVisible();

    // The magic item name only exists in the seeded database — seeing it in
    // the DOM proves Lobos's resources made the trip through SQLite and the API.
    await expect(lobos.getByText('Bloodshed Greatsword')).toBeVisible();
  });
});
