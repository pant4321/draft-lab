import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const artifact = resolve('build/pages');
const read = (path: string) => readFileSync(resolve(artifact, path));
const hash = (path: string) =>
  createHash('sha256').update(read(path)).digest('hex');

test('the production app and privacy page load at both site paths', async ({
  page,
}) => {
  for (const base of ['/', '/draft-lab/']) {
    await test.step(base, async () => {
      await page.goto(base);
      await expect(
        page.getByRole('button', { name: /^Inspect / }).first(),
      ).toBeVisible();
      await page.getByRole('link', { name: 'Privacy' }).click();
      await expect(page).toHaveURL(base + 'privacy.html');
      await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
    });
  }
});

test('the artifact contains only verified public datasets and their portraits', () => {
  const index = JSON.parse(read('data/datasets.json').toString());
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
        expect(hash(file), file).toBe(checksum);
      }
    }
    const catalog = JSON.parse(read(dataset.base + '/catalog.json').toString());
    for (const champion of catalog.champions) {
      expect(read('assets/' + champion.key + '.png').length).toBeGreaterThan(0);
    }
  }

  const data = resolve(artifact, 'data');
  const files = readdirSync(data, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(data, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/'),
    );
  expect(files.sort()).toEqual(expected.sort());
});
