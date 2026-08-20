const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

async function checkedFetch(name, url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), ...options });
  assert.ok(response.ok, `${name}: HTTP ${response.status}`);
  return response;
}

async function run() {
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const match = html.match(/const SUPABASE_URL='([^']+)',SUPABASE_PUBLISHABLE_KEY='([^']+)'/);
  assert.ok(match, 'Supabase public configuration was not found');
  const [, supabaseUrl, publishableKey] = match;

  const weather = await checkedFetch('Open-Meteo', 'https://api.open-meteo.com/v1/forecast?latitude=40.824&longitude=140.74&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=Asia%2FTokyo&forecast_days=7');
  const weatherData = await weather.json();
  assert.equal(weatherData.daily.time.length, 7, 'Open-Meteo did not return seven forecast days');

  const tile = await checkedFetch('OpenStreetMap tile', 'https://tile.openstreetmap.org/0/0/0.png');
  assert.match(tile.headers.get('content-type') || '', /^image\/png\b/, 'OpenStreetMap did not return a PNG tile');

  const restHeaders = { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` };
  const supabaseAccess = {};
  for (const table of ['midway_posts', 'shared_routes', 'events']) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id&limit=1`, {
      headers: restHeaders,
      signal: AbortSignal.timeout(15000),
    });
    assert.ok(response.ok || response.status === 401, `Supabase ${table}: HTTP ${response.status}`);
    const data = await response.json();
    if (response.ok) assert.ok(Array.isArray(data), `Supabase ${table} did not return a JSON array`);
    supabaseAccess[table] = response.ok ? 'readable with publishable key' : 'authentication required';
  }

  const edge = await checkedFetch('google-maps-to-gpx preflight', `${supabaseUrl}/functions/v1/google-maps-to-gpx`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,apikey',
    },
  });
  assert.match(edge.headers.get('access-control-allow-methods') || '', /POST/i, 'Edge Function preflight does not allow POST');

  console.log(JSON.stringify({
    passed: true,
    checks: ['Open-Meteo forecast', 'OpenStreetMap tile', 'Supabase REST authorization boundaries', 'google-maps-to-gpx OPTIONS'],
    supabaseAccess,
    writes: 0,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
