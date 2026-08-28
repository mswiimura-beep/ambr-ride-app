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
const modalViewports = [
  { width: 320, height: 568 },
  { width: 375, height: 420 },
  { width: 667, height: 375 },
];
const modalIds = [
  'midwayPostModal',
  'rideFormModal',
  'eventFormModal',
  'eventDetailModal',
  'eventJoinModal',
  'profileModal',
  'midwayGalleryModal',
  'midwayMapModal',
  'rideModal',
  'weatherModal',
];

function serveFile(request, response) {
  const requestUrl = new URL(request.url, 'http://127.0.0.1');
  const pathname = requestUrl.pathname;
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
            signInAnonymously: async () => ({ data: { user: { id: 'local-ui-test', is_anonymous: true }, session: { user: { id: 'local-ui-test', is_anonymous: true } } } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          },
          from: () => window.__ambrChain,
          functions: { invoke: async () => ({ data: null, error: { message: 'disabled in UI test' } }) },
        }; }};
      `;
      let html = body.toString('utf8')
        .replace(/<link[^>]+href="https:\/\/[^\"]+"[^>]*>/g, '')
        .replace(/<script src="https:\/\/[^\"]+"><\/script>/g, '');
      html = html.replace('<script>', `<script>${supabaseStub}</script><script>`);
      const requestedModal = requestUrl.searchParams.get('open-modal');
      if (modalIds.includes(requestedModal)) {
        const autoOpen = `<script>addEventListener('DOMContentLoaded', () => {
          setTimeout(() => {
            document.getElementById('enterButton').click();
            setTimeout(() => window.openModal(${JSON.stringify(requestedModal)}), 500);
          }, 0);
        });</script>`;
        html = html.replace('</body>', `${autoOpen}</body>`);
      }
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

async function checkModalMatrix(page, baseUrl) {
  const results = [];
  for (const viewport of modalViewports) {
    await page.setViewportSize(viewport);
    await page.goto(`${baseUrl}/?modal-matrix=${viewport.width}x${viewport.height}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#enterButton').click();
    await page.waitForTimeout(480);
    for (const modalId of modalIds) {
      await page.evaluate((id) => window.openModal(id), modalId);
      await page.waitForTimeout(30);
      const state = await page.evaluate((id) => {
        const modal = document.getElementById(id);
        const sheet = modal.firstElementChild;
        const rect = sheet.getBoundingClientRect();
        const focusables = [...modal.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
          .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length);
        const undersized = focusables.filter((element) => {
          if (/^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) return false;
          const target = element.getBoundingClientRect();
          return target.width < 44 || target.height < 44;
        }).map((element) => ({ tag: element.tagName, id: element.id, className: element.className, text: element.textContent.trim().slice(0, 30) }));
        return {
          open: modal.classList.contains('open'),
          ariaHidden: modal.getAttribute('aria-hidden'),
          appInert: document.querySelector('.app').hasAttribute('inert'),
          focusInside: modal.contains(document.activeElement),
          sheet: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, scrollHeight: sheet.scrollHeight, clientHeight: sheet.clientHeight, overflowY: getComputedStyle(sheet).overflowY },
          documentWidth: document.documentElement.scrollWidth,
          undersized,
        };
      }, modalId);
      assert.equal(state.open, true, `${modalId} did not open at ${viewport.width}x${viewport.height}`);
      assert.equal(state.ariaHidden, 'false', `${modalId} is hidden from assistive technology`);
      assert.equal(state.appInert, true, `${modalId} did not make the background inert`);
      assert.equal(state.focusInside, true, `${modalId} did not contain initial focus`);
      assert.equal(state.documentWidth, viewport.width, `${modalId} caused horizontal page overflow`);
      assert.ok(state.sheet.top >= 0 && state.sheet.bottom <= viewport.height, `${modalId} is outside the viewport`);
      assert.ok(state.sheet.left >= 0 && state.sheet.right <= viewport.width, `${modalId} overflows horizontally`);
      assert.equal(state.undersized.length, 0, `${modalId} has controls below 44px: ${JSON.stringify(state.undersized)}`);
      if (state.sheet.overflowY === 'hidden') {
        assert.ok(state.sheet.scrollHeight <= state.sheet.clientHeight + 1, `${modalId} clips content in a non-scrollable sheet`);
      }
      await page.locator(`#${modalId} button:not([disabled]),#${modalId} a[href],#${modalId} input:not([disabled]),#${modalId} select:not([disabled]),#${modalId} textarea:not([disabled])`).last().press('Tab');
      assert.equal(await page.evaluate((id) => document.getElementById(id).contains(document.activeElement), modalId), true, `Tab escaped ${modalId}`);
      await page.evaluate((id) => window.hideModal(id), modalId);
      results.push({ modalId, viewport });
    }
  }
  return results;
}

async function run() {
  const server = http.createServer(serveFile);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browserCandidates = process.env.PLAYWRIGHT_BROWSERS_PATH ? [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  ].filter(Boolean) : [
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
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    for (const viewport of viewports) {
      console.log(`checking ${viewport.width}x${viewport.height}`);
      await page.setViewportSize(viewport);
      await page.goto(`${baseUrl}/?viewport=${viewport.width}x${viewport.height}`, { waitUntil: 'domcontentloaded' });
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
    await page.goto(`${baseUrl}/?interaction=1`, { waitUntil: 'domcontentloaded' });
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
    await page.locator('#rideSaveButton').scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    const routeSaveActions = await page.evaluate(() => {
      window.updateRideFormSaveActions({ hasGpx: true });
      return ['rideSaveButton', 'rideSaveAndShareButton'].map((id) => {
        const button = document.getElementById(id);
        const rect = button.getBoundingClientRect();
        const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          id,
          text: button.textContent.trim(),
          hidden: button.hidden,
          width: rect.width,
          height: rect.height,
          hit: target === button || button.contains(target),
        };
      });
    });
    assert.match(routeSaveActions[0].text, /自分の記録に保存/, 'local route save action is unclear');
    assert.match(routeSaveActions[1].text, /保存して共有を更新|保存して、みんなにも共有/, 'one-step share action is unclear');
    routeSaveActions.forEach((button) => {
      assert.equal(button.hidden, false, `${button.id}: route save action is hidden`);
      assert.ok(button.width >= 44 && button.height >= 44, `${button.id}: route save action is below 44px`);
      assert.equal(button.hit, true, `${button.id}: route save action center is covered`);
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375, 'route save actions cause horizontal overflow');
    await page.locator('#rideFormModal .entry-cancel').press('Tab');
    assert.equal(await page.evaluate(() => document.getElementById('rideFormModal').contains(document.activeElement)), true, 'Tab escaped the open modal');

    console.log('checking all modal layouts and focus traps');
    const modalResults = await checkModalMatrix(page, baseUrl);

    console.log(JSON.stringify({ passed: true, viewports: results.map((item) => item.viewport), modalChecks: modalResults.length }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv.includes('--serve')) {
  const port = Number(process.env.PORT || 4319);
  http.createServer(serveFile).listen(port, '127.0.0.1', () => {
    console.log(`AMBR UI test server: http://127.0.0.1:${port}`);
  });
} else {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
