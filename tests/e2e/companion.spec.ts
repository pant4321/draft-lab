import { expect, test } from '@playwright/test';

test('the companion UI waits for permission and applies the latest import after a drag', async ({
  page,
}) => {
  const token = 'a'.repeat(43);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'permissions', {
      value: {
        query: async () => ({
          state: 'prompt',
          addEventListener() {},
          removeEventListener() {},
        }),
      },
    });
  });
  let revision = 1;
  let served = 0;
  const notices: string[] = [];
  await page.route('**/api/state', async (route) => {
    expect(route.request().headers()['x-draftlab-session']).toBe(token);
    served = revision;
    await route.fulfill({
      json: {
        bridgeProtocol: 1,
        revision,
        status: 'champ_select',
        message: 'Test champion select',
        snapshot: {
          sessionId: 'fixture',
          playerChampion: 35,
          playerRole: 'jungle',
          allies: [{ id: 516, role: 'top' }],
          bans: [],
          enemies: revision > 1 ? [{ id: 86, role: null }] : [],
        },
      },
    });
  });
  await page.route('**/api/quit', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-draftlab-session']).toBe(token);
    await route.fulfill({ json: { stopping: true } });
  });
  page.on('pageerror', (error) => notices.push(error.message));
  await page.goto('/#companion=' + token + '&port=8791');
  const setup = page.getByRole('dialog', {
    name: 'Connect your League client',
  });
  await expect(setup).toBeVisible();
  expect(served).toBe(0);
  await expect(page).toHaveURL('http://127.0.0.1:8791/');
  await setup.getByRole('button', { name: 'Connect to League' }).click();
  await expect(setup).toBeHidden();
  await expect(page.locator('#companion-chip-label')).toHaveText(
    'League · Live',
  );
  await expect(
    page.locator('[data-slot-side=allies][data-slot-role=jungle]'),
  ).toContainText('Shaco');

  const source = page.getByRole('button', { name: 'Choose allied Top' });
  const target = page.getByRole('button', { name: 'Choose allied Mid' });
  await expect(source).toContainText('Ornn');
  const from = await source.boundingBox(),
    to = await target.boundingBox();
  if (!from || !to) throw Error('Missing draft slot');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await expect(page.locator('.drag-preview')).toBeVisible();
  revision = 2;
  await expect.poll(() => served).toBe(2);
  await expect(page.locator('#enemies')).not.toContainText('Garen');
  await page.mouse.up();
  await expect(target).toContainText('Ornn');
  await expect(page.locator('#enemies')).toContainText('Garen');
  await expect(page.locator('#companion-chip-label')).toHaveText(
    'League · Live',
  );

  const pause = page.getByRole('button', { name: 'Pause live sync' });
  await pause.press('Enter');
  await expect(page.locator('#companion-chip-label')).toHaveText(
    'League · Paused',
  );
  await page.getByRole('button', { name: 'Resume live sync' }).press('Enter');
  await expect(page.locator('#companion-chip-label')).toHaveText(
    'League · Live',
  );
  await page.locator('#companion-menu-toggle').click();
  await page.getByRole('button', { name: 'Quit companion' }).click();
  await expect(page.locator('#companion-chip-label')).toHaveText(
    'League · Closed',
  );
  await expect(page.locator('#companion-details')).not.toHaveAttribute('open');
  expect(notices).toEqual([]);
});
