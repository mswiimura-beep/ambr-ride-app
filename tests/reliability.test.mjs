import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20260818000100_shared_data_reliability.sql', import.meta.url),
  'utf8',
);
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.trim());

test('all inline JavaScript parses', () => {
  assert.ok(scripts.length > 0);
  scripts.forEach((source) => assert.doesNotThrow(() => new Function(source)));
});

test('shared post upload is owner-bound and retry-safe', () => {
  assert.match(html, /user_id:user\.id,client_post_id:record\.clientPostId/);
  assert.match(html, /upsert:false/);
  assert.match(html, /\.eq\('user_id',user\.id\)\.eq\('client_post_id',record\.clientPostId\)/);
  assert.match(html, /if\(newPaths\.length\)/);
  assert.match(html, /if\(items\.length>5\)throw new Error\('送信待ちは5件までです'\)/);
  assert.doesNotMatch(html, /storage\.upload\([^\n]+upsert:true/);
});

test('destructive remote operations verify owner and affected rows', () => {
  assert.match(html, /from\('midway_posts'\)\.delete\(\)\.eq\('id',id\)\.eq\('user_id',user\.id\)\.select\('id'\)/);
  assert.match(html, /from\('events'\)\.delete\(\)\.eq\('id',record\.id\)\.eq\('creator_id',user\.id\)\.select\('id'\)/);
  assert.match(html, /from\('event_participants'\)\.delete\(\)[^;]+\.select\('event_id'\)/);
  assert.match(html, /queueStorageCleanup\(targets\)/);
});

test('refreshes coalesce without losing a later refresh request', () => {
  assert.match(html, /midwayRefreshVersion\+\+/);
  assert.match(html, /while\(handled!==midwayRefreshVersion\)/);
  assert.match(html, /eventsRefreshVersion\+\+/);
  assert.match(html, /while\(handled!==eventsRefreshVersion\)/);
  assert.match(html, /sharedRoutesRefreshVersion\+\+/);
});

test('runtime handles auth changes, offline retries, and uncaught failures', () => {
  assert.match(html, /onAuthStateChange/);
  assert.match(html, /retryStorageCleanup/);
  assert.match(html, /addEventListener\('unhandledrejection'/);
  assert.match(html, /addEventListener\('error'/);
});

test('migration enforces authenticated reads and owner writes', () => {
  assert.match(migration, /revoke all[\s\S]+from anon;/i);
  assert.match(migration, /midway_posts for delete to authenticated using \(user_id = auth\.uid\(\)\)/);
  assert.match(migration, /events for update to authenticated using \(creator_id = auth\.uid\(\)\)/);
  assert.match(migration, /shared_routes for update to authenticated using \(user_id = auth\.uid\(\)\)/);
  assert.match(migration, /midway_post_reactions_identity_key unique \(post_id, user_id, reaction\)/);
  assert.match(migration, /event_participants_identity_key unique \(event_id, user_id\)/);
  assert.match(migration, /storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
});
