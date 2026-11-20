import { expect, test } from '@playwright/test';

test('the companion imports a draft after the user connects', async ({
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

  let requested = false;
  await page.route('**/api/state', async (route) => {
    requested = true;
    await route.fulfill({
      json: {
        bridgeProtocol: 1,
        revision: 1,
        status: 'champ_select',
        message: 'Test champion select',
        snapshot: {
          sessionId: 'fixture',
          playerChampion: 35,
          playerRole: 'jungle',
          allies: [{ id: 516, role: 'top' }],
          bans: [],
          enemies: [],
        },
      },
    });
  });

  await page.goto('/#companion=' + token + '&port=8791');
  const setup = page.getByRole('dialog', { name: 'Connect your League client' });
  await expect(setup).toBeVisible();
  expect(requested).toBe(false);
  await expect(page).toHaveURL('/');
  await setup.getByRole('button', { name: 'Connect to League' }).click();
  await expect(setup).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Choose allied Top' }),
  ).toContainText('Ornn');
});
