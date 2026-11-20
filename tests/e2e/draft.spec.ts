import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

function firstRecommendation(page: Page) {
  return page.getByRole('button', { name: /^Inspect / }).first();
}

async function ready(page: Page) {
  await page.goto('/');
  await expect(firstRecommendation(page)).toBeVisible();
}

async function pick(page: Page, slot: Locator, champion: string) {
  await slot.press('Enter');
  const picker = page.getByRole('dialog');
  const search = picker.getByRole('searchbox');
  await expect(search).toBeFocused();
  await search.fill(champion);
  await picker
    .getByRole('button', { name: 'Pick ' + champion, exact: true })
    .click();
}

async function drag(page: Page, source: Locator, target: Locator) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw Error('Missing draft slot');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

test('manual swaps are saved and can be released when auto roles are enabled', async ({
  page,
}) => {
  await ready(page);
  const top = page.getByRole('button', { name: 'Choose enemy Top' });
  const mid = page.getByRole('button', { name: 'Choose enemy Mid' });
  await pick(page, top, 'Garen');
  await pick(page, mid, 'Ahri');
  await drag(page, top, mid);
  await expect(top).toContainText('Ahri');
  await expect(mid).toContainText('Garen');

  const exclude = page.getByRole('button', {
    name: 'Exclude Garen from calculations',
  });
  await exclude.press('Space');
  await expect(exclude).toBeFocused();
  await expect(exclude).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(top).toContainText('Ahri');
  await expect(mid).toContainText('Garen');
  await expect(exclude).toHaveAttribute('aria-pressed', 'true');

  const clearPins = page.getByRole('button', { name: 'Clear role pins' });
  await expect(clearPins).toBeHidden();
  await expect(mid.getByText('Pinned', { exact: true })).toBeHidden();

  await page.getByRole('button', { name: /^Settings/ }).click();
  const settings = page.getByRole('dialog', { name: 'Draft settings' });
  await settings.getByRole('checkbox', { name: 'Auto guess roles' }).check();
  await settings.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(mid).toContainText('Garen');
  await expect(mid.getByText('Pinned', { exact: true })).toBeVisible();
  await clearPins.click();
  await expect(clearPins).toBeHidden();
});

test('a patch filter survives a reload', async ({ page }) => {
  await ready(page);
  const settings = page.getByRole('button', { name: /^Settings/ });
  const dialog = page.getByRole('dialog', { name: 'Draft settings' });
  const patches = dialog.getByRole('checkbox', { name: /^\d+\.\d+$/ });

  await settings.click();
  await dialog.getByText('Patches', { exact: true }).click();
  for (const patch of (await patches.all()).slice(1)) await patch.uncheck();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(firstRecommendation(page)).toBeVisible();

  await page.reload();
  await expect(firstRecommendation(page)).toBeVisible();
  await settings.click();
  await dialog.getByText('Patches', { exact: true }).click();
  await expect(patches.first()).toBeChecked();
  await expect(patches.nth(1)).not.toBeChecked();
});

test('a failed dataset switch keeps the draft usable and allows a retry', async ({
  page,
}) => {
  await ready(page);
  const top = page.getByRole('button', { name: 'Choose enemy Top' });
  await pick(page, top, 'Garen');
  const selector = page.getByRole('combobox', { name: 'Rank dataset' });
  const initial = await selector.inputValue();
  const catalog = '**/data/emerald-plus/draft/catalog.json?*';

  await page.route(catalog, (route) => route.fulfill({ status: 503 }));
  const failed = page.waitForResponse(
    (response) =>
      response.url().includes('/emerald-plus/draft/catalog.json') &&
      response.status() === 503,
  );
  await selector.selectOption('emerald-plus');
  await failed;
  await expect(selector).toHaveValue(initial);
  await expect(firstRecommendation(page)).toBeVisible();
  await expect(top).toContainText('Garen');

  await page.unroute(catalog);
  await selector.selectOption('emerald-plus');
  await expect(firstRecommendation(page)).toBeVisible();
  await expect(selector).toHaveValue('emerald-plus');
  await expect(top).toContainText('Garen');
});
