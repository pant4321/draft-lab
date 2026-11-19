import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function ready(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.locator('.pick').first()).toBeVisible();
}
async function pick(page: Page, slot: string, champion: string) {
  await page.getByRole('button', { name: 'Choose ' + slot }).click();
  const search = page.getByRole('searchbox', {
    name: 'Search champions',
    exact: true,
  });
  await expect(search).toBeFocused();
  await search.fill(champion);
  await page
    .getByRole('button', { name: 'Pick ' + champion, exact: true })
    .click();
}
async function drag(page: Page, from: string, to: string) {
  const source = await page
    .getByRole('button', { name: 'Choose ' + from })
    .boundingBox();
  const target = await page
    .getByRole('button', { name: 'Choose ' + to })
    .boundingBox();
  if (!source || !target) throw Error('Missing draft slot');
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
}

test('draft slots, swaps, bans, scoring, and saved state match the draft workflow', async ({
  page,
}) => {
  await ready(page);
  await pick(page, 'enemy Top', 'Garen');
  await expect(
    page.getByRole('heading', { name: 'Best picks for this draft' }),
  ).toBeAttached();
  await expect(page.locator('.breakdown-total')).toHaveText(
    /^[-+]?\d+\.\d{2}$/,
  );
  await expect(page.locator('.pair-card.enemy')).toContainText('Garen');
  await expect(
    page.getByLabel('Remaining counters', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'How remaining counters are ranked' })
    .click();
  await expect(page.locator('#remaining-counter-method')).toContainText(
    'Minimum 5,000 matchup games and 0.5% role pick share',
  );
  await page.keyboard.press('Escape');

  await pick(page, 'enemy Mid', 'Ahri');
  await drag(page, 'enemy Top', 'enemy Mid');
  await expect(
    page.locator('[data-slot-side=enemies][data-slot-role=middle]'),
  ).toContainText('Garen');
  await expect(
    page.locator('[data-slot-side=enemies][data-slot-role=top]'),
  ).toContainText('Ahri');
  await expect(
    page.getByRole('button', { name: 'Clear corrections' }),
  ).toBeVisible();
  const ignore = page.getByRole('button', {
    name: 'Exclude Garen from calculations',
  });
  await ignore.focus();
  await ignore.press('Space');
  await expect(ignore).toBeFocused();
  await expect(ignore).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.pair-weight')).toContainText(
    'Excluded from calculations',
  );

  await page.getByRole('button', { name: 'Add ban' }).click();
  await page
    .getByRole('searchbox', { name: 'Search champions', exact: true })
    .fill('Teemo');
  await page.getByRole('button', { name: 'Ban Teemo', exact: true }).click();
  await page
    .getByRole('searchbox', { name: 'Search champions', exact: true })
    .fill('');
  await page.keyboard.press('Escape');
  await expect(page.locator('#champion-picker')).toBeHidden();
  await expect(
    page.locator('#ban-chips').getByRole('button', { name: 'Unban Teemo' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Unban Teemo' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Remove Garen from enemy Mid' }),
  ).toBeVisible();
  await expect(ignore).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('button', { name: 'Remove Garen from enemy Mid' })
    .click();
  await expect(ignore).toHaveCount(0);
});

test('rank sorting, inspection, and the spread chart work with the keyboard', async ({
  page,
}) => {
  await ready(page);
  const help = page.getByRole('button', {
    name: 'What the draft metrics mean',
  });
  await help.click();
  await expect(page.locator('#ranking-metrics-help')).toBeVisible();
  for (const metric of ['blindability', 'sample', 'score']) {
    await expect(page.locator(`[data-sort=${metric}]`)).toHaveAttribute(
      'aria-describedby',
      'metric-' + metric,
    );
    await expect(page.locator('#metric-' + metric)).toBeVisible();
  }
  await page.keyboard.press('Escape');
  const sort = page.getByRole('button', { name: 'Blindability', exact: true });
  await expect(sort).toHaveAttribute('data-direction', 'descending');
  await sort.press('Enter');
  await expect(sort).toHaveAttribute('data-direction', 'ascending');
  await sort.press('Enter');
  const result = page.locator('#rankings .pick').first();
  await result.getByRole('button', { name: /^Inspect/ }).press('Enter');
  await expect(page.locator('#breakdown')).toBeVisible();
  const chartButton = result.getByRole('button', {
    name: /matchup WR delta spread/,
  });
  await chartButton.focus();
  await expect(page.locator('#blindability-popover')).toBeVisible();
  await chartButton.press('Enter');
  await expect(
    page.getByRole('combobox', { name: 'Spread matchup group' }),
  ).toBeFocused();
  await expect(page.locator('#spread-chart svg')).toBeVisible();
  await page.locator('#spread-chart svg').click();
  await expect(page.locator('#blindability-popover')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#blindability-popover')).toBeHidden();
  await expect(chartButton).toBeFocused();

  const pickerTrigger = page.getByRole('button', { name: 'Choose enemy Top' });
  await pickerTrigger.click();
  await page
    .getByRole('searchbox', { name: 'Search champions', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Choose enemy Top' }),
  ).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(
    page.getByRole('dialog', { name: 'Choose enemy Top' }),
  ).toBeHidden();
});

test('champion pools, role weights, and patches persist with their existing keys', async ({
  page,
}) => {
  await ready(page, '/draft-lab/');
  await page.getByRole('button', { name: 'Edit your champion pool' }).click();
  await page
    .getByRole('searchbox', { name: 'Search your champion pool' })
    .fill('Vi');
  await page
    .getByRole('button', { name: 'Add Vi to your Jungle pool', exact: true })
    .click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit your champion pool' }),
  ).toHaveText('Your pool · 1');
  await page
    .getByRole('button', { name: 'Suggested bans for your pool' })
    .click();
  await expect(page.locator('#pool-bans-popover')).toBeVisible();
  const suggestion = page.locator('.pool-ban-entry').first();
  await suggestion.click();
  await expect(page.locator('.pool-ban-table:visible').first()).toBeVisible();
  await expect(page.locator('.pool-ban-table:visible').first()).toContainText(
    'Total ban score',
  );
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Draft settings' });
  const patchSettings = page.locator('#patch-settings');
  await expect(patchSettings).not.toHaveAttribute('open');
  await dialog
    .getByRole('spinbutton', { name: 'Top synergy multiplier' })
    .fill('1.5');
  await dialog.getByText('Patches', { exact: true }).click();
  await expect(dialog.getByText(/Fewer games make the stats/)).toBeVisible();
  const patches = dialog.locator('#patch-options input');
  for (let index = 1; index < (await patches.count()); index++)
    await patches.nth(index).uncheck();
  await expect(patches.first()).toBeDisabled();
  await expect(page.locator('#snapshot')).not.toContainText('1 of ');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('#snapshot')).toContainText('1 of ');
  await page.reload();
  await expect(page.locator('#snapshot')).toContainText('1 of ');
  await expect(
    page.getByRole('button', { name: 'Edit your champion pool' }),
  ).toHaveText('Your pool · 1');
  await page.getByRole('button', { name: 'Settings · custom' }).click();
  await expect(
    dialog.getByRole('spinbutton', { name: 'Top synergy multiplier' }),
  ).toHaveValue('1.5');
});

test('a failed cohort switch retains the draft and can be retried', async ({
  page,
}) => {
  await ready(page);
  await pick(page, 'enemy Top', 'Garen');
  const selector = page.getByRole('combobox', { name: 'Rank dataset' });
  const pattern = '**/data/emerald-plus/draft/catalog.json?*';
  await page.route(pattern, (route) => route.fulfill({ status: 503 }));
  await selector.selectOption('emerald-plus');
  await expect(page.locator('#status')).toContainText(
    'Could not load the requested dataset',
  );
  await expect(selector).toHaveValue('combined');
  await expect(
    page.getByRole('button', { name: 'Remove Garen from enemy Top' }),
  ).toBeVisible();
  await page.unroute(pattern);
  await selector.selectOption('emerald-plus');
  await expect(selector).toHaveValue('emerald-plus');
  await expect(page.locator('#status')).toBeEmpty();
  await expect(
    page.getByRole('button', { name: 'Remove Garen from enemy Top' }),
  ).toBeVisible();
});

test('switching cohorts during a patch load commits only the newer request', async ({
  page,
}) => {
  await ready(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Draft settings' });
  await dialog.getByText('Patches', { exact: true }).click();
  const checkboxes = dialog.locator('#patch-options input');
  for (let index = 1; index < (await checkboxes.count()); index++)
    await checkboxes.nth(index).uncheck();
  let unblock!: () => void;
  const delay = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const pattern = '**/data/patch-inputs/combined/**/catalog.json?*';
  await page.route(pattern, async (route) => {
    await delay;
    await route.continue();
  });
  try {
    const request = page.waitForRequest(pattern);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await request;
    const ranks = page.getByRole('combobox', { name: 'Rank dataset' });
    await ranks.selectOption('emerald-plus');
    await expect(page.locator('#snapshot')).toContainText('1 of ');
    await expect(page.locator('.pick').first()).toBeVisible();
    const late = page.waitForResponse(pattern);
    unblock();
    await late;
    await expect(ranks).toHaveValue('emerald-plus');
    await expect(page.locator('#status')).toBeEmpty();
  } finally {
    unblock();
  }
});
