import assert from 'node:assert/strict';
import test from 'node:test';

let edgeHandler;
globalThis.Deno = { serve(handler) { edgeHandler = handler; } };
const edge = await import('../supabase/functions/google-maps-to-gpx/index.ts');
const originalFetch = globalThis.fetch;

test.afterEach(() => { globalThis.fetch = originalFetch; });

test('accepts only supported Google Maps hosts', () => {
  assert.equal(edge.isGoogleMapsUrl(new URL('https://maps.app.goo.gl/abc')), true);
  assert.equal(edge.isGoogleMapsUrl(new URL('https://www.google.com/maps/dir/A/B')), true);
  assert.equal(edge.isGoogleMapsUrl(new URL('https://example.com/maps/dir/A/B')), false);
});

test('extracts explicit coordinates only when they match named endpoints', () => {
  const url = new URL('https://www.google.com/maps/dir/A/B/data=!2m2!1d140.1!2d40.1!2m2!1d141.1!2d41.1');
  const names = edge.extractPlaces(url);
  assert.deepEqual(names, ['A', 'B']);
  assert.deepEqual(edge.extractExplicitRoutePoints(url, names).map(({ lat, lon }) => [lat, lon]), [[40.1, 140.1], [41.1, 141.1]]);
  assert.deepEqual(edge.extractExplicitRoutePoints(url, ['A', 'B', 'C']), []);
});

test('invalid short URL returns a concrete HTTP error', async () => {
  globalThis.fetch = async () => new Response('', { status: 404 });
  await assert.rejects(
    edge.expandGoogleUrl(new URL('https://maps.app.goo.gl/expired')),
    /短縮リンクを開けませんでした（HTTP 404）/,
  );
  const response = await edgeHandler(new Request('https://local.test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://maps.app.goo.gl/expired' }),
  }));
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /HTTP 404/);
});

test('short URL network failure gives a retry and recopy instruction', async () => {
  globalThis.fetch = async () => { throw new TypeError('network failed'); };
  await assert.rejects(
    edge.expandGoogleUrl(new URL('https://maps.app.goo.gl/network-error')),
    /通信状態を確認するか、Googleマップの「共有」からリンクをコピーし直してください/,
  );
});

async function endpointMismatch(routeCoordinates) {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('router.project-osrm.org')) {
      return Response.json({ code: 'Ok', routes: [{ distance: 1000, duration: 600, geometry: { coordinates: routeCoordinates } }] });
    }
    return new Response('', { status: 200 });
  };
  return edgeHandler(new Request('https://local.test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.google.com/maps/dir/?api=1&origin=40,140&destination=41,141' }),
  }));
}

test('rejects a generated route whose explicit start or end does not match', async () => {
  const startResponse = await endpointMismatch([[0, 0], [141, 41]]);
  assert.equal(startResponse.status, 422);
  assert.match((await startResponse.json()).error, /^出発地と作成された道路ルートが一致しませんでした/);

  const endResponse = await endpointMismatch([[140, 40], [0, 0]]);
  assert.equal(endResponse.status, 422);
  assert.match((await endResponse.json()).error, /^目的地と作成された道路ルートが一致しませんでした/);
});
