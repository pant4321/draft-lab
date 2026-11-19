import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const artifact = resolve('build/pages');
const read = (path: string) => readFileSync(resolve(artifact, path));
const hash = (path: string) =>
  createHash('sha256').update(read(path)).digest('hex');

for (const base of ['/', '/draft-lab/']) {
  test(`production assets, draft, and privacy load at ${base}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.url().startsWith('http://127.0.0.1:8791') && !response.ok())
        errors.push(response.url());
    });
    await page.goto(base);
    await expect(
      page.getByRole('heading', { name: 'Blind picks for Jungle' }),
    ).toBeAttached();
    const header = page.locator('main > header');
    await expect(header.locator('button, select').last()).toHaveAccessibleName(
      'Rank dataset',
    );
    await expect(page.locator('#data-details')).toHaveText(
      'Draft stats come from a saved, non-live snapshot.',
    );
    await expect(page.getByRole('link', { name: 'Contact' })).toHaveAttribute(
      'href',
      'mailto:contact@draftedge.website',
    );
    await expect(page.locator('.riot-legal')).toContainText('Riot Games');
    await expect(page.locator('.brand img')).toHaveAttribute(
      'src',
      'assets/draft-lab-mark.png?v=' +
        hash('assets/draft-lab-mark.png').slice(0, 12),
    );
    await expect(page.locator('link[rel=icon]')).toHaveAttribute(
      'href',
      'favicon.ico?v=' + hash('favicon.ico').slice(0, 12),
    );
    expect(
      await page
        .locator('.pick-portrait img')
        .first()
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    await page.getByRole('link', { name: 'Privacy' }).click();
    await expect(page).toHaveURL(
      new RegExp(base.replaceAll('/', '\\/') + 'privacy\\.html'),
    );
    await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
    await expect(page.locator('link[rel=icon]')).toHaveAttribute(
      'href',
      'favicon.ico?v=' + hash('favicon.ico').slice(0, 12),
    );
    expect(errors).toEqual([]);
  });
}

test('the artifact references hashed bundles and contains only verified public dataset files', () => {
  const html = read('index.html').toString();
  const bundles = [
    ...html.matchAll(/(?:src|href)="\.\/(bundles\/[^"]+)"/g),
  ].map((match) => match[1]);
  expect(bundles).toHaveLength(2);
  for (const file of bundles) {
    expect(file).toMatch(/^bundles\/.+-[\w-]+\.(js|css)$/);
    expect(read(file).length).toBeGreaterThan(0);
  }
  const index = JSON.parse(read('data/datasets.json').toString());
  expect(index.schemaVersion).toBe(1);
  expect(index.default).toBe('combined');
  expect(index.datasets.map(({ id }: { id: string }) => id).sort()).toEqual([
    'combined',
    'emerald-plus',
  ]);
  const expected = ['datasets.json'];
  for (const dataset of index.datasets) {
    for (const entry of [dataset, ...dataset.patchInputs]) {
      expect(entry.base).toMatch(
        /^data\/(draft|emerald-plus\/draft|patch-inputs\/)/,
      );
      for (const [name, checksum] of Object.entries(entry.files)) {
        const file = entry.base + '/' + name;
        expected.push(file.slice('data/'.length));
        expect(hash(file)).toBe(checksum);
      }
    }
    const catalog = JSON.parse(read(dataset.base + '/catalog.json').toString());
    for (const champion of catalog.champions)
      expect(read('assets/' + champion.key + '.png').length).toBeGreaterThan(0);
  }
  const files = readdirSync(resolve(artifact, 'data'), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      (entry.parentPath + '/' + entry.name)
        .replaceAll('\\', '/')
        .split('/data/')
        .at(-1),
    );
  expect(files.sort()).toEqual(expected.sort());
});
