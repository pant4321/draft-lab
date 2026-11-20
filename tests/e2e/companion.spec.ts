import { expect, test } from '@playwright/test';

test('companion sync resumes across tabs and can relaunch after closing or quitting', async ({
  page,
  context,
}) => {
  const previewOrigin = 'http://127.0.0.1:8791';
  const headers = { 'access-control-allow-origin': previewOrigin };
  let link: URL | undefined;
  let running = false;
  let token = '';
  let reconnectKey = '';
  let launches = 0;
  let selecting = false;
  let topChampion = 516;
  await context.exposeFunction('recordCompanionLink', (url: string) => {
    link = new URL(url);
    if (!running) {
      token = String(++launches).padStart(43, '0');
      reconnectKey = String(launches).padStart(43, '9');
    }
    running = true;
  });
  await context.addInitScript(() => {
    const testWindow = window as Window & {
      recordCompanionLink?: (url: string) => void;
    };
    document.addEventListener('click', (event) => {
      const anchor = (event.target as HTMLElement)?.closest(
        'a[href^="draftedge:"]',
      );
      if (anchor instanceof HTMLAnchorElement) {
        event.preventDefault();
        testWindow.recordCompanionLink?.(anchor.href);
      }
    });
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

  await context.route(
    /^http:\/\/127\.0\.0\.1:876[678]\/api\/pair$/,
    async (route) => {
      const port = Number(new URL(route.request().url()).port);
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            ...headers,
            'access-control-allow-methods': 'POST',
            'access-control-allow-headers': 'X-DraftLab-Pairing',
          },
        });
        return;
      }
      expect(link?.searchParams.get('origin')).toBe(previewOrigin);
      const expected = link?.pathname.split('/')[port - 8765];
      expect(route.request().headers()['x-draftlab-pairing']).toBe(expected);
      await route.fulfill(
        port === 8767 && running
          ? { headers, json: { token, port } }
          : { headers, status: 404 },
      );
    },
  );

  await context.route(/^http:\/\/127\.0\.0\.1:8767\/api\/(state|quit|reconnect)(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const quit = url.pathname === '/api/quit';
    const reconnect = url.pathname === '/api/reconnect';
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          ...headers,
          'access-control-allow-methods': quit || reconnect ? 'POST' : 'GET',
          'access-control-allow-headers': reconnect ? 'X-DraftLab-Reconnect' : 'X-DraftLab-Session',
        },
      });
      return;
    }
    if (!running) {
      await route.abort('connectionrefused');
      return;
    }
    if (reconnect) {
      const authorized = route.request().headers()['x-draftlab-reconnect'] === reconnectKey;
      await route.fulfill(authorized
        ? { headers, json: { token, port: 8767 } }
        : { headers, status: 403 });
      return;
    }
    if (route.request().headers()['x-draftlab-session'] !== token) {
      await route.fulfill({ headers, status: 403 });
      return;
    }
    if (quit) {
      running = false;
      await route.fulfill({ headers, json: { stopping: true } });
      return;
    }
    await route.fulfill({
      headers,
      json: {
        bridgeProtocol: 1,
        revision: selecting ? 2 : 1,
        status: selecting ? 'champ_select' : 'waiting_client',
        message: selecting ? 'Test champion select' : 'Waiting for League',
        ...(url.searchParams.has('remember') ? { reconnectKey } : {}),
        snapshot: selecting ? {
          sessionId: 'fixture',
          playerChampion: 35,
          playerRole: 'jungle',
          allies: [{ id: topChampion, role: 'top' }],
          bans: [],
          enemies: [],
        } : null,
      },
    });
  });

  await page.goto('/');
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await page.getByRole('button', { name: 'Companion', exact: true }).click();
  const openCompanion = page.getByRole('link', { name: 'Open Companion' });
  const leagueMenu = page.getByText(/^League · /);
  const topPick = page.getByRole('button', { name: 'Choose allied Top' });
  await openCompanion.click();
  await expect(leagueMenu).toContainText('Waiting');
  selecting = true;
  await expect(topPick).toContainText('Ornn');

  topChampion = 54;
  await page.reload();
  await expect(topPick).toContainText('Malphite');
  await expect(
    page.getByRole('dialog', { name: 'Connect your League client' }),
  ).toBeHidden();
  expect(navigations).toBe(1);

  await page.close();
  const reopened = await context.newPage();
  const reopenedMenu = reopened.getByText(/^League · /);
  const reopenedPick = reopened.getByRole('button', { name: 'Choose allied Top' });
  const reopenedLaunch = reopened.getByRole('link', { name: 'Open Companion' });
  topChampion = 86;
  await reopened.goto('/');
  await expect(reopenedPick).toContainText('Garen');
  await expect(reopened.getByRole('dialog')).toHaveCount(0);
  expect(launches).toBe(1);

  // Simulate a restarted companion already paired by another tab in this browser.
  reconnectKey = 'r'.repeat(43);
  await reopened.evaluate((key) => {
    localStorage.setItem('draftlab-companion-reconnect-v1', JSON.stringify({ key, port: 8767 }));
  }, reconnectKey);
  token = 's'.repeat(43);
  topChampion = 54;
  await expect(reopenedPick).toContainText('Malphite');
  expect(launches).toBe(1);

  let reopenedNavigations = 0;
  reopened.on('framenavigated', (frame) => {
    if (frame === reopened.mainFrame()) reopenedNavigations++;
  });
  running = false;
  await expect(reopenedMenu).toContainText('Offline');
  await reopenedMenu.click();
  await reopened.getByRole('button', { name: 'Reconnect' }).click();
  topChampion = 98;
  await reopenedLaunch.click();
  await expect(reopenedPick).toContainText('Shen');

  await reopenedMenu.click();
  await reopened.getByRole('button', { name: 'Quit companion' }).click();
  // Quit leaves the menu open so it can be reopened in one step from here.
  await reopened.getByRole('button', { name: 'Reopen Companion' }).click();
  topChampion = 516;
  await reopenedLaunch.click();
  await expect(reopenedPick).toContainText('Ornn');
  expect(launches).toBe(3);
  await expect(reopened).toHaveURL('/');
  expect(reopenedNavigations).toBe(0);
  expect(context.pages()).toHaveLength(1);
});
