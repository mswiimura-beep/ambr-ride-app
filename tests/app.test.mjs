import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const guide = await readFile(new URL('../guide.html', import.meta.url), 'utf8');

test('inline application script parses as JavaScript', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  assert.doesNotThrow(() => new Function(scripts.at(-1)[1]));
});

test('GPX import and export controls are visible user actions', () => {
  assert.match(html, /GPXを読み込む<input type="file"/);
  assert.match(html, /id="exportAllRideGpxButton"[^>]*>保存済みGPXを書き出す/);
  assert.doesNotMatch(html, /#rideModalGpxExport,#exportAllRideGpxButton\{display:none/);
  assert.match(html, /id="rideModalGpxExport"[^>]*onclick="exportActiveRideGpx\(\)"/);
});

test('route records can be saved locally or saved and shared in one step', () => {
  assert.match(html, /id="rideSaveButton"[^>]*onclick="saveRidePost\(false\)"[^>]*>自分の記録に保存する/);
  assert.match(html, /id="rideSaveAndShareButton"[^>]*onclick="saveRidePost\(true\)"[^>]*>保存して、みんなにも共有/);
  assert.match(html, /async function saveRidePost\(shareAfterSave=false\)/);
  assert.match(html, /pendingRideShareAfterProfile=true;openProfileSetup\(\)/);
  assert.match(html, /setTimeout\(\(\)=>saveRidePost\(true\),0\)/);
  assert.match(guide, /「自分の記録に保存する」か「保存して、みんなにも共有」/);
});

test('removed route-comparison features stay removed', () => {
  for (const removed of ['比べるルート', 'どの道をよく使う', 'まだ走っていない道', 'routeComparison', 'trailStats']) {
    assert.equal(html.includes(removed), false, `${removed} must not be present`);
  }
});

test('retired 3D playback and video dependencies stay removed', () => {
  for (const removed of ['maplibre-gl', 'route3d', '3D再生', '動画を保存', 'MediaRecorder']) {
    assert.equal(html.includes(removed), false, `${removed} must not be present`);
  }
  assert.equal(guide.includes('3D'), false);
});

test('shared map explains identity, route kind, direction and tile fallback', () => {
  for (const expected of ['自分・実走', '自分・予定', 'ほかの人・実走', 'ほかの人・予定', 'trail-flow', 'addResilientTiles']) {
    assert.ok(html.includes(expected), `${expected} should be present`);
  }
  assert.match(guide, /自分はオレンジ、ほかの人は青、実走は実線、予定は破線/);
});

test('GPX parser rejects out-of-range latitude and longitude', () => {
  assert.match(html, /Math\.abs\(p\.lat\)<=90&&Math\.abs\(p\.lon\)<=180/);
});
