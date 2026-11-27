import { expect, test } from '@playwright/test';

for (const pauseBeforeUpdate of [false, true]) {
  test(`match start corrects lane matchups ${pauseBeforeUpdate ? 'on resume' : 'automatically'}`, async ({ page, context }) => {
    const token = 's'.repeat(43);
    const headers = {
      'access-control-allow-origin': 'http://127.0.0.1:8791',
      'access-control-allow-methods': 'GET',
      'access-control-allow-headers': 'X-DraftLab-Session',
    };
    const draft = {
      sessionId: 'fixture', playerChampion: null, playerRole: 'jungle',
      allies: [{ id: 516, role: 'top' }], enemies: [{ id: 64 }, { id: 58 }], bans: [111],
    };
    const match = {
      phase: 'game', sessionId: draft.sessionId, player: { key: 'Shaco', role: 'jungle' },
      allies: [
        { key: 'ornn', role: 'top' }, { key: 'ahri', role: 'middle' },
        { key: 'ashe', role: 'bottom' }, { key: 'nami', role: 'support' },
      ],
      enemies: [
        { key: 'leesin', role: 'top' }, { key: 'renekton', role: 'jungle' },
        { key: 'orianna', role: 'middle' }, { key: 'caitlyn', role: 'bottom' },
        { key: 'xerath', role: 'support' },
      ],
      bans: draft.bans,
    };
    let revision = 1;
    let servedRevision = 0;
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'permissions', {
        value: {
          query: async () => ({
            state: 'granted',
            addEventListener() {},
            removeEventListener() {},
          }),
        },
      });
    });
    await context.route('http://127.0.0.1:8767/api/**', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers });
        return;
      }
      if (!new URL(route.request().url()).pathname.endsWith('/state')) {
        await route.fulfill({ status: 404, headers });
        return;
      }
      const selecting = revision === 1;
      servedRevision = revision;
      await route.fulfill({
        headers, json: {
          bridgeProtocol: 1, revision, status: selecting ? 'champ_select' : 'in_game',
          message: selecting ? 'Champion select' : 'Match in progress',
          snapshot: selecting ? draft : revision === 2 ? null : match,
        },
      });
    });
    await page.goto('/#' + new URLSearchParams({ companion: token, port: '8767' }));
    const top = page.getByRole('button', { name: 'Choose enemy Top' });
    const jungle = page.getByRole('button', { name: 'Choose enemy Jungle' });
    await expect(top).toContainText('Renekton');
    await expect(jungle).toContainText('Lee Sin');

    revision = 2;
    await expect.poll(() => servedRevision).toBe(2);
    await expect(top).toContainText('Renekton');
    if (pauseBeforeUpdate) {
      await page.getByText(/^League · /).click();
      await page.getByRole('button', { name: 'Pause live sync' }).click();
    }
    revision = 3;
    if (pauseBeforeUpdate) {
      await expect.poll(() => servedRevision).toBe(3);
      await expect(top).toContainText('Renekton');
      await page.getByText(/^League · /).click();
      await page.getByRole('button', { name: 'Resume live sync' }).click();
    }
    await page.getByRole('button', { name: 'Close build' }).click();
    await expect(top).toContainText('Lee Sin');
    await expect(jungle).toContainText('Renekton');
  });
}

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
          playerChampion: null,
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

test('enemy picks rerank recommendations without taking over the League hover', async ({ page, context }) => {
  const headers = {
    'access-control-allow-origin': 'http://127.0.0.1:8791',
    'access-control-allow-methods': 'GET',
    'access-control-allow-headers': 'X-DraftLab-Session',
  };
  let revision = 1;
  let hovered: number | null = null;
  let enemies: { id: number }[] = [];
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'permissions', {
      value: { query: async () => ({ state: 'granted', addEventListener() {}, removeEventListener() {} }) },
    });
  });
  await context.route('http://127.0.0.1:8767/api/state*', (route) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers }) : route.fulfill({
      headers,
      json: {
        bridgeProtocol: 1, revision, status: 'champ_select', message: 'Champion select',
        champSelect: { sessionId: 'fixture', championId: hovered, role: 'jungle' },
        snapshot: { sessionId: 'fixture', playerRole: 'jungle', playerChampion: null, allies: [], enemies, bans: [] },
      },
    }),
  );
  await page.goto('/#' + new URLSearchParams({ companion: 's'.repeat(43), port: '8767' }));
  await expect(page.getByText(/^League · /)).toContainText('Live');
  const slot = page.getByLabel('Your Jungle pick preview');
  const viewedPick = page.getByRole('button', { name: /^View .* build$/ });
  const inspectedPick = page.getByRole('button', { name: /^Inspect /, pressed: true });
  const enemyTop = page.getByRole('button', { name: 'Choose enemy Top' });

  enemies = [{ id: 516 }];
  revision++;
  await expect(enemyTop).toContainText('Ornn');
  await expect(page.getByRole('heading', { name: 'Best picks for this draft' })).toBeVisible();
  await expect(inspectedPick).toHaveCount(0);
  await expect(viewedPick).toHaveCount(0);
  await expect(slot.locator('img')).toHaveCount(0);

  hovered = 32;
  revision++;
  await expect(slot).toContainText('Amumu');
  await expect(inspectedPick).toHaveAccessibleName(/^Inspect Amumu,/);
  await expect(viewedPick).toHaveAccessibleName('View Amumu build');

  await page.addStyleTag({ content: '#rankings { max-height: 70px; overflow-anchor: none; }' });
  await inspectedPick.evaluate((row) => {
    const list = row.closest<HTMLElement>('#rankings')!;
    list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top;
  });
  await expect(inspectedPick).toBeInViewport({ ratio: 0.9 });
  const initialRank = (await inspectedPick.getAttribute('aria-label'))?.match(/rank \d+/)?.[0];
  expect(initialRank).toBeTruthy();
  enemies = [...enemies, { id: 64 }];
  revision++;
  await expect(page.getByRole('button', { name: 'Choose enemy Jungle' })).toContainText('Lee Sin');
  await expect(inspectedPick).not.toHaveAccessibleName(new RegExp(`${initialRank}\\b`));
  await expect(inspectedPick).toBeInViewport({ ratio: 0.9 });

  await page.getByRole('button', { name: 'Choose enemy Mid' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose enemy Mid' });
  await picker.getByRole('searchbox').fill('Ahri');
  await picker.getByRole('button', { name: 'Pick Ahri', exact: true }).click();
  await expect(page.getByText(/^League · /)).toContainText('Paused');
  hovered = 35;
  revision++;
  await expect(slot).toContainText('Shaco');
  await expect(viewedPick).toHaveAccessibleName('View Shaco build');
  await expect(page.getByRole('button', { name: 'Choose enemy Mid' })).toContainText('Ahri');
});

test('builds apply runes and spells together in champion select and remember the Flash slot', async ({ page, context }) => {
  const origin = 'http://127.0.0.1:8791';
  const token = 's'.repeat(43);
  const reconnectKey = 'r'.repeat(43);
  let locked = false;
  let status = 'connected';
  let hovered: number | null = null;
  let revision = 1;
  let sessionId = 'fixture';
  let flashPosition: 'right' | 'left' | null = null;
  let enemies: { id: number }[] = [];
  const buildRequests: Record<string, string>[] = [];
  const loadoutRequests: unknown[] = [];

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'permissions', {
      value: {
        query: async () => ({
          state: 'granted',
          addEventListener() {},
          removeEventListener() {},
        }),
      },
    });
  });
  await context.route('http://127.0.0.1:8767/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'Content-Type, X-DraftLab-Session, X-DraftLab-Reconnect',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
    } else if (url.pathname === '/api/reconnect') {
      expect(request.headers()['x-draftlab-reconnect']).toBe(reconnectKey);
      await route.fulfill({ headers, json: { token, port: 8767, championBuildsVersion: 2, draftBuilds: true } });
    } else if (url.pathname === '/api/loadout') {
      expect(request.method()).toBe('POST');
      expect(request.headers()['x-draftlab-session']).toBe(token);
      loadoutRequests.push(request.postDataJSON());
      await route.fulfill({ headers, json: { applied: true } });
    } else if (url.pathname === '/api/build') {
      expect(request.headers()['x-draftlab-session']).toBe(token);
      const params = Object.fromEntries(url.searchParams);
      buildRequests.push(params);
      const opponentId = params.opponentId === '777' ? 777 : null;
      const stats = { games: opponentId ? 125 : 3200, winRate: 52 };
      const usualBoots = { ...stats, key: '3020' };
      const noBoots = { key: 'no-boots', games: 112, winRate: 51.1, pickRate: 3.5 };
      const usualLateItem = { ...stats, key: '3089' };
      const situationalItem = { ...stats, key: '3116', winRate: 65.43 };
      const draft = params.draft ? {
        opponentIds: [516, 777, 89],
        changes: {
          boots: {
            usual: usualBoots, generalPickShare: 0.22, window: '16.23',
            opponents: [
              { opponentId: 89, contribution: 0.8, pickShare: 0.57, games: 405, winRate: 49.5 },
              { opponentId: 516, contribution: 0.5, pickShare: 0.42, games: 211, winRate: 51 },
            ],
          },
        },
        alternatives: {
          item4: { '3116': {
            option: situationalItem, usual: usualLateItem, generalPickShare: 0.08, window: '14',
            opponents: [{ opponentId: 777, contribution: 0.6, pickShare: 0.2, games: 36, winRate: 77.78 }],
          } },
        },
      } : undefined;
      await route.fulfill({
        headers,
        json: { build: {
          ...stats,
          opponentId,
          draft,
          window: '16.23',
          windows: draft ? { boots: '16.23', item4: '14' } : {},
          legendarySlots: true,
          summoners: { ...stats, key: '4_14' },
          summonerAlternatives: [{ key: '4_12', games: 410, winRate: 50.5 }],
          coreSteps: [],
          runes: [
            {
              ...stats, kind: 'win', primary: [8214, 8226, 8210, 8237],
              secondary: [8139, 8106], shards: [5005, 5008, 5011],
            },
            {
              ...stats, kind: 'pick', primary: [8112, 8139, 8140, 8106],
              secondary: [8226, 8210], shards: [5005, 5008, 5011],
            },
          ],
          runeStats: {
            primary: {
              8005: { games: 20, winRate: 55, pickRate: 0.6 },
              8112: { games: 32, winRate: 50, pickRate: 1 },
              8128: { games: 35, winRate: 57, pickRate: 1.1 },
            },
            secondary: { 8226: { games: 100, winRate: 59, pickRate: 3.1 } },
          },
          items: {
            startSet: [{ ...stats, key: '1056_2003_2003' }],
            boots: draft ? [{ ...stats, key: '3111' }, usualBoots, noBoots] : [usualBoots, noBoots],
            builtBootSet3: [],
            item1: [{ ...stats, key: opponentId ? '3118' : '6655' }],
            item2: [{ ...stats, key: opponentId ? '3135' : '4645' }],
            item4: draft ? [usualLateItem, situationalItem] : [usualLateItem],
            item5: [{ ...stats, key: '3157' }],
            item6: [{ ...stats, key: '3137' }],
          },
          maxOrder: { ...stats, key: 'QWE' },
          levelOrder: { ...stats, key: 'QWEQQR' },
        } },
      });
    } else {
      await route.fulfill({
        headers,
        json: {
          bridgeProtocol: 1, revision, status,
          message: 'Test connection', reconnectKey, temporaryRunes: true, loadoutImport: true,
          champSelect: status === 'connected' ? null : { sessionId, championId: hovered, flashPosition },
          snapshot: status === 'champ_select' ? {
            sessionId, playerChampion: locked ? 103 : null,
            playerRole: 'middle', allies: [], enemies, bans: [],
          } : null,
        },
      });
    }
  });
  await context.route('https://ddragon.leagueoflegends.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const image = (name: string) => ({ name, image: { full: name + '.png' } });
    let json;
    if (path.endsWith('versions.json')) json = ['16.22.1'];
    else if (path.endsWith('Ahri.json')) {
      json = { data: { Ahri: { spells: [image('Orb of Deception')], passive: image('Essence Theft') } } };
    } else if (path.endsWith('summoner.json')) {
      json = { data: {
        SummonerFlash: { ...image('Flash'), key: '4' },
        SummonerDot: { ...image('Ignite'), key: '14' },
        SummonerTeleport: { ...image('Teleport'), key: '12' },
      } };
    } else if (path.endsWith('item.json')) {
      json = { data: {
        2003: image('Health Potion'),
        3111: image("Mercury's Treads"),
        3116: image("Rylai's Crystal Scepter"),
        3157: image("Zhonya's Hourglass"), 3137: image('Cryptbloom'),
        1056: image("Doran's Ring"), 6655: image("Luden's Echo"), 4645: image('Shadowflame'),
        3089: image("Rabadon's Deathcap"),
        3020: image("Sorcerer's Shoes"), 3118: image('Malignance'), 3135: image('Void Staff'),
      } };
    } else if (path.endsWith('runesReforged.json')) {
      const tree = (id: number, name: string, slots: [number, string][][]) => ({
        id, name, icon: 'test.png',
        slots: slots.map((runes) => ({ runes: runes.map(([id, name]) => ({ id, name, icon: 'test.png' })) })),
      });
      json = [
        tree(8300, 'Inspiration', [[[8351, 'Glacial Augment']], [[8304, 'Magical Footwear']], [[8313, 'Biscuit Delivery']], [[8347, 'Cosmic Insight']]]),
        tree(8200, 'Sorcery', [[[8214, 'Summon Aery']], [[8226, 'Manaflow Band']], [[8210, 'Transcendence']], [[8237, 'Scorch']]]),
        tree(8000, 'Precision', [[[8005, 'Press the Attack']], [[9111, 'Triumph']], [[9104, 'Legend: Alacrity']], [[8014, 'Coup de Grace']]]),
        tree(8100, 'Domination', [
          [[8112, 'Electrocute'], [8128, 'Dark Harvest']],
          [[8139, 'Taste of Blood']], [[8140, 'Grisly Mementos']], [[8106, 'Ultimate Hunter']],
        ]),
        tree(8400, 'Resolve', [[[8437, 'Grasp of the Undying']], [[8446, 'Demolish']], [[8429, 'Conditioning']], [[8451, 'Overgrowth']]]),
      ];
    }
    await route.fulfill(json ? { json } : { status: 404 });
  });

  await page.goto('/#' + new URLSearchParams({ companion: token, port: '8767' }));
  const connection = page.getByText(/^League · /);
  await expect(connection).toContainText('Ready');
  const build = page.getByRole('dialog', { name: 'Ahri build' });
  const reopen = page.getByRole('button', { name: 'View Ahri build' });
  const view = page.getByRole('button', { name: /^View .*build$/ });
  await expect(view).toBeHidden();
  const settings = page.getByRole('button', { name: /^Settings/ });
  const settingsDialog = page.getByRole('dialog', { name: 'Draft settings' });
  const flash = settingsDialog.getByRole('combobox', { name: 'Flash position' });
  await settings.click();
  await expect(flash).toHaveValue('');
  await settingsDialog.getByRole('button', { name: 'Done', exact: true }).click();

  await page.getByRole('button', { name: 'Select Mid role' }).click();
  const ahri = page.getByRole('button', { name: /^Inspect Ahri,/ });
  const slot = page.getByLabel('Your Mid pick preview');
  await expect(ahri).toBeVisible();
  await ahri.evaluate((row) => {
    const list = row.closest<HTMLElement>('#rankings')!;
    list.scrollTop = 0;
    if (row.getBoundingClientRect().top < list.getBoundingClientRect().bottom)
      list.scrollTop = list.scrollHeight;
  });
  await expect(ahri).not.toBeInViewport();
  status = 'unsupported_draft';
  hovered = 103;
  revision++;
  await expect(reopen).toBeVisible();
  await expect(slot).toContainText('Ahri');
  await expect(slot.getByText('PREVIEW', { exact: true })).toBeVisible();
  await expect(slot.locator('img')).toHaveAttribute('src', /\/Ahri\.png$/);
  await expect(ahri).toHaveAttribute('aria-pressed', 'true');
  await expect(ahri).toBeInViewport({ ratio: 0.9 });

  hovered = null;
  revision++;
  await expect(view).toBeHidden();
  await expect(slot.locator('img')).toHaveCount(0);
  const search = page.getByRole('searchbox', { name: 'Filter recommendations' });
  await search.fill('Zed');
  await expect(ahri).toHaveCount(0);
  hovered = 103;
  revision++;
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(ahri).toHaveAttribute('aria-pressed', 'true');
  await expect(ahri).toBeInViewport({ ratio: 0.9 });

  hovered = null;
  status = 'connected';
  revision++;
  await expect(view).toBeHidden();
  await page.getByRole('button', { name: /^Inspect / }).first().click();
  await expect(view).toBeVisible();
  await view.click();
  const preview = page.getByRole('dialog', { name: /build$/i });
  await expect(preview.getByRole('heading', { name: 'Runes' })).toBeVisible();
  await expect(preview.getByRole('button', { name: /^Apply (?:runes|spells)/ })).toBeHidden();

  status = 'unsupported_draft';
  flashPosition = 'right';
  revision++;
  await expect(preview.getByRole('button', { name: 'Apply runes and spells' })).toBeVisible();
  hovered = 103;
  revision++;
  await expect(build.getByRole('heading', { name: 'Runes' })).toBeVisible();
  await expect.poll(() => buildRequests.at(-1)).toMatchObject({ id: '103', role: 'middle' });
  const applyLoadout = build.getByRole('button', { name: 'Apply runes and spells', exact: true });
  const closeBuild = build.getByRole('button', { name: 'Close build' });
  async function expectApplyLeftOfClose() {
    const [applyBox, closeBox] = await Promise.all([applyLoadout.boundingBox(), closeBuild.boundingBox()]);
    expect(applyBox!.x + applyBox!.width).toBeLessThanOrEqual(closeBox!.x);
    expect(applyBox!.y).toBe(closeBox!.y);
  }
  await expectApplyLeftOfClose();
  const resetRunes = build.getByRole('button', { name: 'Reset runes' });
  const primaryPath = build.getByRole('button', { name: /^Primary rune path:/ });
  const secondaryPath = build.getByRole('button', { name: /^Secondary rune path:/ });
  const primaryPaths = build.getByRole('group', { name: 'Primary rune paths' });
  const secondaryPaths = build.getByRole('group', { name: 'Secondary rune paths' });
  const electrocute = build.getByRole('button', { name: 'Electrocute', exact: true });
  const darkHarvest = build.getByRole('button', { name: 'Dark Harvest', exact: true });
  await expect(resetRunes).toBeHidden();
  await expect(primaryPaths).toBeHidden();
  await primaryPath.click();
  await expect(primaryPaths.getByRole('button')).toHaveCount(5);
  const pathNames = await primaryPaths.getByRole('button').evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('aria-label')),
  );
  expect(pathNames).toEqual(['Precision', 'Domination', 'Sorcery', 'Resolve', 'Inspiration']);
  await primaryPaths.getByRole('button', { name: 'Sorcery', exact: true }).click();
  await expect(primaryPath).toHaveAccessibleName('Primary rune path: Sorcery');
  await expect(secondaryPath).toHaveAccessibleName('Secondary rune path: Domination');
  await expect(primaryPath).toBeFocused();
  await resetRunes.click();

  await secondaryPath.click();
  await secondaryPaths.getByRole('button', { name: 'Domination', exact: true }).click();
  await expect(secondaryPath).toHaveAccessibleName('Secondary rune path: Domination');
  await expect(primaryPath).toHaveAccessibleName('Primary rune path: Sorcery');
  await resetRunes.click();

  await primaryPath.click();
  await primaryPaths.getByRole('button', { name: 'Precision', exact: true }).click();
  await expect(build.getByRole('button', { name: 'Press the Attack', pressed: true })).toBeVisible();
  await resetRunes.click();
  await expect(primaryPath).toHaveAccessibleName('Primary rune path: Domination');
  await expect(electrocute).toHaveAttribute('aria-pressed', 'true');

  await darkHarvest.click();
  await build.getByRole('button', { name: 'Scorch', exact: true }).click();
  await build.getByRole('list', { name: 'Flex shard' }).getByRole('button', { name: 'Move speed', exact: true }).click();
  await expect(darkHarvest).toHaveAttribute('aria-pressed', 'true');
  await expect(build.getByRole('button', { name: 'Manaflow Band', pressed: false })).toBeVisible();
  await expect(build.getByRole('button', { name: 'Transcendence', pressed: true })).toBeVisible();
  await expect(resetRunes).toBeVisible();
  expect(loadoutRequests).toHaveLength(0);
  await applyLoadout.click();
  await expect(build.getByRole('status').filter({ hasText: /applied/i })).toBeVisible();
  expect(loadoutRequests).toEqual([{
    sessionId: 'fixture', flashPosition: 'right', spells: [14, 4],
    runes: { primary: [8128, 8139, 8140, 8106], secondary: [8210, 8237], shards: [5005, 5010, 5011] },
  }]);
  await resetRunes.click();
  await expect(resetRunes).toBeHidden();
  await expect(electrocute).toHaveAttribute('aria-pressed', 'true');
  await expect(build.getByRole('button', { name: 'Manaflow Band', pressed: true })).toBeVisible();
  await expect(build.getByRole('list', { name: 'Flex shard' }).getByRole('button', { name: 'Adaptive force', pressed: true })).toBeVisible();
  await build.getByRole('button', { name: 'Close build' }).click();
  await expect(reopen).toBeVisible();
  await settings.click();
  await expect(flash).toHaveValue('right');
  await flash.selectOption('left');
  await settingsDialog.getByRole('button', { name: 'Done', exact: true }).click();
  status = 'champ_select';
  locked = true;
  revision++;
  await expect(build).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  await expect(page).toHaveURL('/');
  await expect(build.getByText(/All ranks/)).toBeVisible();
  await expect(build.getByText('Patch 16.23', { exact: true })).toBeVisible();
  await expect.poll(() => buildRequests.at(-1)).toEqual({ slug: 'ahri', id: '103', role: 'middle', tier: 'all' });
  await expect(build.getByRole('button', { name: /most picked|highest win rate/i })).toHaveCount(0);
  const recommended = build.getByRole('button', { name: 'Electrocute', pressed: true, exact: true });
  await expect(recommended).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(recommended.locator('.build-icon')).toHaveCSS('opacity', '1');
  await expect(recommended.locator('.build-icon')).toHaveCSS('border-top-width', '0px');
  await expect(build.getByRole('button', { name: 'Dark Harvest', pressed: false, exact: true })
    .locator('.build-icon')).not.toHaveCSS('opacity', '1');
  await expect(build.getByRole('group', { name: 'Stat shards' })
    .getByRole('button', { name: 'Adaptive force', pressed: true, exact: true })).toBeVisible();
  await expect(applyLoadout).toBeVisible();
  await expect(build.getByRole('heading', { name: 'Primary trees' })).toBeHidden();
  const runeToggle = build.getByRole('button', { name: /full rune trees/ });
  await runeToggle.click();
  await expect(runeToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(build.getByRole('heading', { name: 'Primary trees' })).toBeVisible();
  await expect(build.getByRole('heading', { name: 'Secondary trees' })).toBeVisible();
  await expect(build.getByText('55.0% win rate', { exact: true })).toBeVisible();
  await expect(build.getByText('3.1% pick rate', { exact: true })).toBeVisible();
  const fullRunes = build.getByRole('region', { name: 'Full rune trees' });
  const popularRune = fullRunes.getByRole('img', { name: 'Dark Harvest', exact: true }).locator('.build-icon');
  await expect(popularRune).toHaveCSS('opacity', '1');
  await expect(popularRune).toHaveCSS('border-top-width', '0px');
  await expect(fullRunes.getByText('1.1% pick rate', { exact: true })).toHaveCSS('font-weight', '700');
  await expect(fullRunes.getByRole('img', { name: 'Electrocute', exact: true })
    .locator('.build-icon')).not.toHaveCSS('opacity', '1');
  await expect(fullRunes.getByRole('img', { name: 'Press the Attack', exact: true })
    .locator('.build-icon')).not.toHaveCSS('opacity', '1');
  await runeToggle.click();
  await expect(build.getByRole('heading', { name: 'Primary trees' })).toBeHidden();
  await expect(recommended).toBeVisible();
  const item = build.getByRole('img', { name: "Doran's Ring", exact: true });
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute('title', "Doran's Ring");
  await expect(build.getByText("Doran's Ring", { exact: true })).toHaveCount(0);
  await expect(build.getByRole('img', { name: '2 × Health Potion' })).toBeVisible();
  await expect(build.getByRole('img', { name: "Rabadon's Deathcap", exact: true })).toBeVisible();
  const bootChoices = build.getByRole('region', { name: 'Boots', exact: true });
  await expect(bootChoices.getByRole('img', { name: "Sorcerer's Shoes", exact: true })).toBeVisible();
  await expect(bootChoices.getByText('No boots', { exact: true })).toBeVisible();
  await expect(bootChoices.getByText('3.5% of games')).toBeVisible();
  async function expectItemStatsBesideIcons() {
    for (const label of ['Starting items', 'Boots']) {
      const row = build.getByRole('region', { name: label, exact: true }).locator('.build-item-row').first();
      const [icons, stats] = await Promise.all([
        row.getByRole('list').boundingBox(),
        row.locator('.build-stats').boundingBox(),
      ]);
      expect(stats!.x).toBeGreaterThan(icons!.x + icons!.width);
      expect(stats!.y).toBeLessThan(icons!.y + icons!.height);
    }
  }
  await expectItemStatsBesideIcons();
  const spells = build.getByRole('region', { name: 'Summoner spells' });
  await expect(spells.getByRole('img', { name: 'Flash', exact: true })).toBeVisible();
  await expect(spells.getByRole('img', { name: 'Ignite', exact: true })).toBeVisible();
  await expect(spells.getByRole('list').first().getByRole('img').first()).toHaveAccessibleName('Flash');
  const teleport = spells.getByRole('img', { name: 'Teleport', exact: true });
  const spellToggle = spells.getByRole('button', { name: /summoner spell alternatives/ });
  await expect(teleport).toBeHidden();
  await spellToggle.click();
  await expect(teleport).toBeVisible();
  await expect(spells.getByText('410 matches')).toBeVisible();
  await spellToggle.click();
  await expect(teleport).toBeHidden();

  const headings = ['Ability order', 'Runes', 'Items', 'Starting items', 'Boots', 'First legendary', 'Fifth legendary'];
  const headingsLayout = () => Promise.all(headings.map((name) =>
    build.getByRole('heading', { name, exact: true }).boundingBox()));
  const [ability, runes, items, starting, boots, core, sixth] = await headingsLayout();
  const runePanel = await build.getByRole('region', { name: 'Runes', exact: true }).boundingBox();
  const spellPanel = await spells.boundingBox();
  expect(ability!.x).toBeLessThan(runes!.x);
  expect(spellPanel!.y).toBeGreaterThan(ability!.y);
  expect(Math.abs(spellPanel!.y + spellPanel!.height - (runePanel!.y + runePanel!.height))).toBeLessThan(2);
  expect(items!.y).toBeGreaterThan(runePanel!.y + runePanel!.height);
  expect(starting!.x).toBeLessThan(boots!.x);
  expect(boots!.x).toBeLessThan(core!.x);
  expect(sixth!.x).toBeGreaterThan(core!.x);
  expect([boots, core, sixth].every((heading) => Math.abs(heading!.y - starting!.y) < 2)).toBe(true);

  const desktop = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await expectApplyLeftOfClose();
  const [, mobileRunes, mobileItems, mobileStarting, mobileBoots, mobileCore] = await headingsLayout();
  expect(mobileRunes!.y).toBeLessThan(mobileItems!.y);
  expect(mobileItems!.y).toBeLessThan(mobileStarting!.y);
  expect(mobileStarting!.x).toBeLessThan(mobileBoots!.x);
  expect(mobileBoots!.y).toBeLessThan(mobileCore!.y);
  await expectItemStatsBesideIcons();
  await primaryPath.click();
  const lastPath = primaryPaths.getByRole('button', { name: 'Inspiration', exact: true });
  await expect(lastPath).toBeInViewport({ ratio: 0.9 });
  await lastPath.press('Escape');
  await expect(primaryPaths).toBeHidden();
  await expect(primaryPath).toBeFocused();
  await page.setViewportSize(desktop);

  const secondLegendary = build.getByRole('region', { name: 'Second legendary', exact: true });
  await expect(secondLegendary.getByRole('img', { name: 'Shadowflame', exact: true })).toBeVisible();
  const levelGrid = build.getByRole('table', { name: 'Ability by level' });
  await expect(levelGrid.getByRole('cell', { name: /^6\s*R$/ })).toBeVisible();
  const passive = levelGrid.getByRole('row').filter({ hasText: 'Essence Theft' });
  await expect(passive).toBeVisible();
  await expect(passive.getByRole('cell')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(passive.getByRole('cell')).toHaveCSS('border-top-width', '0px');
  await expect(build.getByRole('link', { name: 'LoLalytics stats' })).toHaveCount(0);
  await expect(build.getByText('Game assets by Riot Data Dragon')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(build).toBeHidden();
  revision++;
  await page.waitForResponse((response) => response.url().endsWith('/api/state'));
  await expect(build).toBeHidden();
  await reopen.click();
  await expect(build).toBeVisible();
  await build.getByRole('button', { name: 'Close build' }).click();
  await expect(build).toBeHidden();
  await expect(reopen).toBeFocused();

  await page.getByRole('combobox', { name: 'Rank dataset' }).selectOption('emerald-plus');
  sessionId = 'next-draft';
  revision++;
  await expect(build).toBeVisible();
  await expect(build.getByText(/Emerald\+/)).toBeVisible();
  await expect.poll(() => buildRequests.at(-1)).toEqual({
    slug: 'ahri', id: '103', role: 'middle', tier: 'emerald_plus',
  });

  enemies = [{ id: 516 }, { id: 777 }, { id: 89 }];
  revision++;
  const matchup = build.getByRole('combobox', { name: 'Build matchup' });
  await expect(matchup).toHaveValue('auto');
  await expect.poll(() => buildRequests.at(-1)).toEqual({
    slug: 'ahri', id: '103', role: 'middle', tier: 'emerald_plus',
    draft: 'ornn:516:top,yone:777:middle,leona:89:support',
  });
  await expect(build.getByRole('img', { name: "Mercury's Treads", exact: true })).toHaveCount(1);
  await build.getByText('Draft pick vs. Leona +1', { exact: true }).click();
  await expect(build.getByText(/Usual pick: Sorcerer's Shoes/)).toBeVisible();
  await expect(build.getByText('405 matches')).toBeVisible();
  await expect(build.getByText('49.50% WR')).toBeVisible();
  await expect(build.getByText(/Third legendary uses last 14 days/)).toBeVisible();
  await expect(build.getByRole('img', { name: "Rabadon's Deathcap", exact: true })).toBeVisible();
  await expect(build.getByRole('img', { name: "Rylai's Crystal Scepter", exact: true })).toBeVisible();
  await expect(build.getByText('Low sample', { exact: false })).toBeVisible();
  await build.getByText(/Draft option vs\. Yone/).click();
  await expect(build.getByText('Yone · 20.0% picked')).toBeVisible();
  await expect(build.getByText('36 matches')).toBeVisible();
  await expect(build.getByText(/65\.43%|77\.78%/)).toHaveCount(0);

  await matchup.selectOption('777');
  await expect.poll(() => buildRequests.at(-1)).toEqual({
    slug: 'ahri', id: '103', role: 'middle', tier: 'emerald_plus',
    opponent: 'yone', opponentId: '777', opponentRole: 'middle',
  });
  await expect(build.getByRole('region', { name: 'First legendary', exact: true })
    .getByRole('img', { name: 'Malignance', exact: true })).toBeVisible();

  await matchup.selectOption('89');
  await expect.poll(() => buildRequests.at(-1)).toMatchObject({
    opponent: 'leona', opponentId: '89', opponentRole: 'support', tier: 'emerald_plus',
  });
  await expect(build.getByRole('status').filter({ hasText: /Showing all matchups.*Leona/ })).toBeVisible();

  await matchup.selectOption('all');
  await expect.poll(() => buildRequests.at(-1)).toEqual({
    slug: 'ahri', id: '103', role: 'middle', tier: 'emerald_plus',
  });
  await expect(secondLegendary.getByRole('img', { name: 'Shadowflame', exact: true })).toBeVisible();
  status = 'connected';
  revision++;
  await expect(applyLoadout).toBeHidden();
  expect(loadoutRequests).toHaveLength(1);
  await closeBuild.click();
  await page.reload();
  await settings.click();
  await expect(flash).toHaveValue('left');
});
