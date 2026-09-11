import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Optional browser tooling lives outside the project; no runtime dependency.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('file:')) requests.push(request.url()); });
  await page.goto(new URL('./m6.html', import.meta.url).href);
  await page.getByRole('heading', { name: 'A session, in focus.' }).waitFor();
  assert.match(await page.locator('#view').innerText(), /\$4\.82/);
  assert.equal(await page.locator('.metrics > .metric').count(), 4);
  assert.equal(await page.locator('#view > .grid > .card').count(), 2);
  assert.equal(await page.locator('#export.primary').count(), 0);
  assert.equal(await page.locator('.data-scope #scope').count(), 1);
  assert.equal(await page.locator('.data-scope #time-range').count(), 1);
  assert.match(await page.locator('.metric').nth(0).innerText(), /Child.*\$0\.90/s);
  assert.match(await page.locator('.metric').nth(1).innerText(), /Input.*Output.*Cache/s);
  assert.equal(await page.locator('.bars .track').count(), 5);
  await page.screenshot({ path: '/tmp/inspector-m6-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Full tree', exact: true }).click();
  assert.match(await page.locator('#view').innerText(), /\$6\.02/);
  assert.ok(await page.evaluate(() => {const d=data();return d.input+d.output+d.cache===d.tokens;}));
  for (const tab of ['Models','Tools','Commands','Agents','Skills','Integrations','Errors','Ledger']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    assert.ok((await page.locator('#view').innerText()).length > 50);
  }
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByLabel('Search rows').fill('bash');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.getByLabel('Search rows').fill('<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('#view img').count(), 0);
  assert.match(await page.locator('#view').innerText(), /No matching rows/);
  await page.getByLabel('Search rows').fill('');
  await page.getByLabel('Sort order').selectOption('name');
  assert.equal(await page.locator('tbody tr').first().locator('td').first().innerText(), 'bash');
  await page.getByRole('button', { name: 'Session history', exact: true }).click();
  assert.deepEqual(await page.locator('thead th').allTextContents(), ['Session','Duration','Tokens','Generations','Agents','Status','Full-tree cost','Inspect']);
  assert.match(await page.locator('tbody').innerText(), /Unavailable/);
  await page.screenshot({ path: '/tmp/inspector-m6-history.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Open demo-session-002', exact: true }).click();
  assert.match(await page.locator('#view').innerText(), /\$3\.36/);
  assert.equal(await page.locator('#session-label').innerText(), 'demo-session-002');
  await page.getByRole('button', { name: 'Global report', exact: true }).click();
  await page.getByLabel('Chart metric').selectOption('tokens');
  assert.equal(await page.locator('.line-point').count(), 7);
  assert.equal(await page.locator('.chart .column').count(), 0);
  assert.deepEqual(await page.locator('#chart-metric option').allTextContents(), ['Cost','Tokens','Generations','Tool calls']);
  const paths = new Set();
  for (const metric of ['cost','tokens','generations','tools']) {
    await page.getByLabel('Chart metric').selectOption(metric);
    paths.add(await page.locator('.activity-line').getAttribute('points'));
    assert.equal(await page.locator('.line-point').count(), 7);
  }
  assert.ok(paths.size > 1, 'metric selector changes line geometry');
  await page.getByLabel('Chart metric').selectOption('tokens');
  await page.getByText('View chart data', { exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export sample JSON' }).click();
  const download = await downloadEvent;
  const json = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(json.preview, true);
  assert.equal(json.scope, 'tree');
  assert.equal(json.usage.cost, 15.34);
  assert.equal(json.usage.input+json.usage.output+json.usage.cache, json.usage.tokens);
  assert.deepEqual(json.period, { preset: 14, from: '2026-08-25', to: '2026-09-07' });
  assert.equal(await page.locator('#range-name').innerText(), 'Last 14 days');
  for (const [preset, from] of [['7D','2026-09-01'],['30D','2026-08-09'],['14D','2026-08-25']]) {
    await page.getByRole('button', { name: preset, exact: true }).click();
    assert.equal(await page.locator('#range-dates').innerText(), `${from} → 2026-09-07`);
  }
  await page.getByRole('button', { name: 'Custom…', exact: true }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-09-07');
  await page.getByLabel('To', { exact: true }).fill('2026-09-06');
  await page.getByRole('button', { name: 'Apply range', exact: true }).click();
  assert.match(await page.locator('#date-error').innerText(), /From must be/);
  assert.equal(await page.locator('#range-name').innerText(), 'Last 14 days');
  await page.getByLabel('From', { exact: true }).fill('2026-09-05');
  await page.getByRole('button', { name: 'Apply range', exact: true }).click();
  assert.equal(await page.locator('#range-dates').innerText(), '2026-09-05 → 2026-09-06');
  assert.match(await page.locator('#view').innerText(), /\$5\.20/);
  assert.equal(await page.locator('.line-point').count(), 2);
  await page.getByRole('button', { name: 'Session history', exact: true }).click();
  assert.equal(await page.locator('tbody tr').count(), 2);
  assert.equal(await page.locator('#range-dates').innerText(), '2026-09-05 → 2026-09-06');
  await page.getByRole('button', { name: 'Custom…', exact: true }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-08-01');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.locator('#range-dates').innerText(), '2026-09-05 → 2026-09-06');
  await page.getByRole('button', { name: 'Current session', exact: true }).click();
  assert.equal(await page.locator('#time-range').isVisible(), false);
  assert.match(await page.locator('#view').innerText(), /\$2\.16/);
  await page.getByRole('button', { name: 'Global report', exact: true }).click();
  assert.equal(await page.locator('#range-dates').innerText(), '2026-09-05 → 2026-09-06');
  await page.getByRole('button', { name: 'Custom…', exact: true }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-08-01');
  await page.getByLabel('To', { exact: true }).fill('2026-08-01');
  await page.getByRole('button', { name: 'Apply range', exact: true }).click();
  assert.match(await page.locator('#view').innerText(), /No samples in this range/);
  // A single zero-valued day must render a finite point, not an invalid SVG path.
  await page.getByRole('button', { name: 'Custom…', exact: true }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-09-02');
  await page.getByLabel('To', { exact: true }).fill('2026-09-02');
  await page.getByRole('button', { name: 'Apply range', exact: true }).click();
  assert.equal(await page.locator('.line-point').count(), 1);
  assert.equal(await page.locator('.activity-line').getAttribute('points'), '400.00,172.00');
  await page.getByRole('button', { name: '14D', exact: true }).click();
  await page.screenshot({ path: '/tmp/inspector-m6-date-range.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Current session', exact: true }).click();
  await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await page.screenshot({ path: '/tmp/inspector-m6-dark.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Light theme', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [375, 667, 768]) {
    await page.setViewportSize({ width, height: width === 667 ? 375 : 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
    await page.getByRole('button', { name: 'Global report', exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `range overflow at ${width}`);
    assert.equal(await page.getByRole('button', { name: 'Custom…', exact: true }).isVisible(), true);
    assert.equal(await page.locator('.line-chart').isVisible(), true);
    await page.getByRole('button', { name: 'Session history', exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `history overflow at ${width}`);
    await page.getByRole('button', { name: 'Current session', exact: true }).click();
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: '/tmp/inspector-m6-mobile.png', fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Tab');
  assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'BODY');
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log('PASS: file://, nine sections, scopes, history drill-down, charts, search escaping, sort, JSON export, themes, 375/667/768px overflow, reduced motion, no external requests or browser errors.');
  console.log('Screenshots: /tmp/inspector-m6-{desktop,dark,mobile}.png');
} finally {
  await browser.close();
}
