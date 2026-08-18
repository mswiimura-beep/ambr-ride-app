const assert = require('node:assert/strict');
const http = require('node:http');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 375, height: 500 },
  { width: 375, height: 420 },
  { width: 393, height: 852 },
  { width: 667, height: 375 },
];

function serveFile(request, response) {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(file).then((body) => {
    if (file.endsWith('index.html')) {
      const supabaseStub = `
        window.L = undefined;
        window.maplibregl = undefined;
        window.__ambrResult = { data: [], error: null };
        window.__ambrChain = new Proxy({}, { get(target, property) {
          if (property === 'then') return (resolve) => resolve(window.__ambrResult);
          return () => window.__ambrChain;
        }});
        window.supabase = { createClient() { return {
          auth: {
            getSession: async () => ({ data: { session: null } }),
            signInAnonymously: async () => ({ data: { session: { user: { id: 'local-ui-test' } } } }),
          },
          from: () => window.__ambrChain,
          functions: { invoke: async () => ({ data: null, error: { message: 'disabled in UI test' } }) },
        }; }};
      `;
      let html = body.toString('utf8')
        .replace(/<link[^>]+href="https:\/\/[^\"]+"[^>]*>/g, '')
        .replace(/<script src="https:\/\/[^\"]+"><\/script>/g, '');
      html = html.replace('<script>', `<script>${supabaseStub}</script><script>`);
      body = Buffer.from(html);
    }
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    response.end(body);
  }).catch(() => response.writeHead(404).end());
}

async function metrics(page) {
  return page.evaluate(() => {
    const hit = (element) => {
      const rect = element.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return target === element || element.contains(target);
    };
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { top: value.top, bottom: value.bottom, width: value.width, height: value.height, hit: hit(element) };
    };
    return {
      viewport: [innerWidth, innerHeight],
      documentWidth: document.documentElement.scrollWidth,
      entry: rect(document.getElementById('enterButton')),
      entryFocused: document.activeElement?.id === 'enterButton',
    };
  });
}

async function run() {
  const server = http.createServer(serveFile);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browserCandidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const executablePath = browserCandidates.find((candidate) => fsSync.existsSync(candidate));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.route('https://**/*', (route) => route.abort());
  const results = [];

  try {
    for (const viewport of viewports) {
      console.log(`checking ${viewport.width}x${viewport.height}`);
      await page.setViewportSize(viewport);
      await page.goto(`http://127.0.0.1:${port}/?viewport=${viewport.width}x${viewport.height}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(80);
      const entry = await metrics(page);
      assert.equal(entry.documentWidth, viewport.width, `${viewport.width}x${viewport.height}: horizontal overflow at entry`);
      assert.equal(entry.entry.hit, true, `${viewport.width}x${viewport.height}: entry center is covered`);
      assert.equal(entry.entryFocused, true, `${viewport.width}x${viewport.height}: entry is not initially focused`);
      assert.ok(entry.entry.top >= 0 && entry.entry.bottom <= viewport.height, `${viewport.width}x${viewport.height}: entry is outside viewport`);
      assert.ok(entry.entry.height >= 44, `${viewport.width}x${viewport.height}: entry is below 44px`);

      await page.locator('#enterButton').click();
      await page.waitForTimeout(480);
      const navigation = await page.evaluate(() => {
        const hit = (element) => {
          const rect = element.getBoundingClientRect();
          const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return target === element || element.contains(target);
        };
        return {
          documentWidth: document.documentElement.scrollWidth,
          buttons: [...document.querySelectorAll('nav[aria-label="メインメニュー"] button')].map((button) => {
            const rect = button.getBoundingClientRect();
            return { view: button.dataset.view, width: rect.width, height: rect.height, hit: hit(button) };
          }),
        };
      });
      assert.equal(navigation.documentWidth, viewport.width, `${viewport.width}x${viewport.height}: horizontal overflow after entry`);
      navigation.buttons.forEach((button) => {
        assert.ok(button.width >= 44 && button.height >= 44, `${viewport.width}x${viewport.height}: ${button.view} is below 44px`);
        assert.equal(button.hit, true, `${viewport.width}x${viewport.height}: ${button.view} center is covered`);
      });
      results.push({ viewport, entry: entry.entry, navigation: navigation.buttons });
    }

    await page.setViewportSize({ width: 375, height: 500 });
    console.log('checking navigation and modal behavior');
    await page.goto(`http://127.0.0.1:${port}/?interaction=1`, { waitUntil: 'domcontentloaded' });
    await page.locator('#enterButton').click();
    await page.waitForTimeout(480);
    for (const view of ['mapView', 'trailsView', 'ridesView', 'feedView', 'menuView']) {
      await page.locator(`nav button[data-view="${view}"]`).click();
      assert.equal(await page.locator('.view.active').getAttribute('id'), view, `${view}: navigation did not activate view`);
    }
    await page.locator('nav button[data-view="ridesView"]').click();
    await page.locator('.back-menu').click();
    assert.equal(await page.locator('.view.active').getAttribute('id'), 'menuView', 'toolbar did not return to menu');
    await page.locator('nav button[data-view="feedView"]').click();
    await page.locator('.brand-button').click();
    assert.equal(await page.locator('.view.active').getAttribute('id'), 'menuView', 'header did not return to menu');

    await page.locator('#headerAvatar').click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'profileNameInput', 'profile modal did not focus its form');
    assert.equal(await page.locator('.app').getAttribute('inert'), '', 'background is not inert while modal is open');
    await page.locator('#profileModal .profile-cancel').click();
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'headerAvatar', 'focus did not return after modal close');

    await page.locator('nav button[data-view="ridesView"]').click();
    await page.getByRole('button', { name: '＋ 記録する', exact: true }).click();
    await page.setViewportSize({ width: 375, height: 420 });
    await page.waitForTimeout(100);
    const form = await page.evaluate(() => {
      const sheet = document.querySelector('#rideFormModal .sheet').getBoundingClientRect();
      const sizes = [...document.querySelectorAll('#rideFormModal input,#rideFormModal select,#rideFormModal textarea')]
        .filter((element) => element.type !== 'file')
        .map((element) => Number(getComputedStyle(element).fontSize.replace('px', '')));
      return { top: sheet.top, bottom: sheet.bottom, documentWidth: document.documentElement.scrollWidth, minFontSize: Math.min(...sizes) };
    });
    assert.ok(form.top >= 0 && form.bottom <= 420, 'form modal does not fit keyboard-height viewport');
    assert.equal(form.documentWidth, 375, 'form modal causes horizontal overflow');
    assert.ok(form.minFontSize >= 16, 'form field can trigger iPhone input zoom');
    await page.locator('#rideFormModal .entry-cancel').press('Tab');
    assert.equal(await page.evaluate(() => document.getElementById('rideFormModal').contains(document.activeElement)), true, 'Tab escaped the open modal');

    console.log(JSON.stringify({ passed: true, viewports: results.map((item) => item.viewport) }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
