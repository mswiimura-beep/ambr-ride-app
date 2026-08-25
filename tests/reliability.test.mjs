import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20260818000100_shared_data_reliability.sql', import.meta.url),
  'utf8',
);
const mergeMigration = readFileSync(
  new URL('../supabase/migrations/20260825000100_anonymous_owner_merge.sql', import.meta.url),
  'utf8',
);
const mergeFunction = readFileSync(
  new URL('../supabase/functions/merge-anonymous-owner/index.ts', import.meta.url),
  'utf8',
);
const rollout = readFileSync(new URL('../supabase/PRODUCTION_ROLLOUT.md', import.meta.url), 'utf8');
const functionConfig = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.trim());

test('all inline JavaScript parses', () => {
  assert.ok(scripts.length > 0);
  scripts.forEach((source) => assert.doesNotThrow(() => new Function(source)));
});

test('shared post upload is owner-bound and retry-safe', () => {
  assert.match(html, /user_id:user\.id,client_post_id:record\.clientPostId/);
  assert.match(html, /record\.ownerId&&record\.ownerId!==user\.id/);
  assert.match(html, /ownerId:user\.id,authorName/);
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
  assert.match(html, /retryMutationOutbox/);
  assert.match(html, /item\.ownerId!==user\.id/);
  assert.match(html, /if\(mutationRetryPromise\)return mutationRetryPromise/);
  assert.match(html, /retryStorageCleanup/);
  assert.match(html, /owned=items\.filter\(item=>item\.ownerId===user\.id\)/);
  assert.match(html, /addEventListener\('unhandledrejection'/);
  assert.match(html, /addEventListener\('error'/);
});

test('all shared mutations have owner-bound offline operations', () => {
  for (const type of [
    'reaction-set', 'comment-insert', 'comment-delete', 'post-update', 'post-delete',
    'event-upsert', 'event-delete', 'participant-set', 'route-upsert', 'route-delete',
  ]) assert.match(html, new RegExp(`case '${type}'`));
  assert.match(html, /queueMutation\('event-upsert'/);
  assert.match(html, /queueMutation\('participant-set'/);
  assert.match(html, /queueMutation\('route-delete'/);
  assert.match(html, /ownerId:midwayUser\?\.id|ownerId=midwayUser\?\.id/);
});

test('owners can edit posts and events without changing ownership', () => {
  assert.match(html, /function updateMidwayPostRecord/);
  assert.match(html, /\.update\(values\)\.eq\('id',record\.id\)\.eq\('user_id',user\.id\)/);
  assert.match(html, /function editActiveEvent/);
  assert.match(html, /\.eq\('id',existing\.id\)\.eq\('creator_id',user\.id\)/);
  assert.match(html, /record\.creator_id!==midwayUser\?\.id/);
});

test('anonymous ownership can be linked to and restored from email', () => {
  assert.match(html, /auth\.updateUser\(\{email\}/);
  assert.match(html, /auth\.signInWithOtp\(\{email,options:\{shouldCreateUser:false/);
  assert.match(html, /if\(!user\.is_anonymous\)throw new Error\('source must be anonymous'\)/);
  assert.match(html, /detectSessionInUrl:true/);
  assert.match(html, /persistSession:false,autoRefreshToken:false,detectSessionInUrl:false/);
  assert.match(html, /auth\.verifyOtp\(\{email,token,type:'email'\}\)/);
  assert.match(html, /sourceAccessToken:ownershipMergeSourceToken/);
  assert.match(html, /auth\.setSession\(\{access_token:targetSession\.access_token/);
  assert.doesNotMatch(html, /SERVICE_ROLE/i);
});

test('anonymous sign-in and existing-email OTP support Turnstile tokens', () => {
  assert.match(html, /ambr-turnstile-site-key" content="0x4A/);
  assert.match(html, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(html, /signInAnonymously\(captchaToken\?\{options:\{captchaToken\}\}:undefined\)/);
  assert.match(html, /signInWithOtp\(\{email,options:\{shouldCreateUser:false,\.\.\.\(captchaToken\?\{captchaToken\}:\{\}\)\}\}\)/);
  assert.match(html, /TURNSTILE_SITE_KEY\?120000:20000/);
});

test('server-side merge derives both owners from verified tokens', () => {
  assert.match(mergeFunction, /auth\.getUser\(sourceAccessToken\)/);
  assert.match(mergeFunction, /auth\.getUser\(targetAccessToken\)/);
  assert.match(mergeFunction, /if \(!sourceUser\.is_anonymous\)/);
  assert.match(mergeFunction, /if \(targetUser\.is_anonymous\)/);
  assert.match(mergeFunction, /source_user: sourceUser\.id/);
  assert.match(mergeFunction, /target_user: targetUser\.id/);
  assert.doesNotMatch(mergeFunction, /body\?\.(sourceUserId|targetUserId)/);
  assert.match(mergeFunction, /Origin not allowed/);
  assert.doesNotMatch(mergeFunction, /Access-Control-Allow-Origin"\s*:\s*"\*"/);
  assert.match(mergeFunction, /Unexpected server failure/);
  assert.match(mergeFunction, /rawBody\.length > 16_384/);
  assert.match(mergeFunction, /sourceAccountRetainedForAudit: true/);
  assert.doesNotMatch(mergeFunction, /deleteUser\(/);
  assert.match(functionConfig, /verify_jwt\s*=\s*true/);
});

test('merge RPC is service-only, transactional, race-safe, and idempotent', () => {
  assert.match(mergeMigration, /revoke all on function public\.ambr_owner_active\(uuid\) from public, anon, authenticated/);
  assert.match(mergeMigration, /revoke all on function public\.ambr_can_manage_storage_prefix\(text, uuid\) from public, anon, authenticated/);
  assert.match(mergeMigration, /revoke all on function public\.merge_anonymous_user_data\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(mergeMigration, /grant execute on function public\.merge_anonymous_user_data\(uuid, uuid\) to service_role/);
  assert.match(mergeMigration, /users\.is_anonymous is true/);
  assert.match(mergeMigration, /users\.is_anonymous is false/);
  assert.match(mergeMigration, /pg_advisory_xact_lock/);
  assert.match(mergeMigration, /lock table[\s\S]+storage\.objects in share row exclusive mode/);
  assert.match(mergeMigration, /'alreadyMerged', true/);
  assert.match(mergeMigration, /ambr_owner_active\(auth\.uid\(\)\)/);
  assert.match(mergeMigration, /ambr_can_manage_storage_prefix/);
  assert.match(mergeMigration, /delete from public\.midway_post_reactions[\s\S]+target\.reaction = source\.reaction/);
  assert.match(mergeMigration, /delete from public\.event_participants[\s\S]+target\.event_id = source\.event_id/);
});

test('production rollout is gated by audit, backup restore, and Auth settings', () => {
  assert.match(rollout, /schema_audit\.sql/);
  assert.match(rollout, /supabase db dump/);
  assert.match(rollout, /使い捨て\/検証用プロジェクトへ/);
  assert.match(rollout, /Storageの実ファイル本体は含まれません/);
  assert.match(rollout, /Allow manual linking/);
  assert.match(rollout, /\{\{ \.Token \}\}/);
  assert.match(rollout, /Redirect URLs/);
  assert.match(rollout, /Bot and Abuse Protection/);
  assert.match(rollout, /--no-verify-jwt/);
});

test('migration enforces authenticated reads and owner writes', () => {
  assert.match(migration, /revoke all[\s\S]+from anon;/i);
  assert.match(migration, /midway_posts for delete to authenticated using \(user_id = auth\.uid\(\)\)/);
  assert.match(migration, /events for update to authenticated using \(creator_id = auth\.uid\(\)\)/);
  assert.match(migration, /shared_routes for update to authenticated using \(user_id = auth\.uid\(\)\)/);
  assert.match(migration, /midway_post_reactions_identity_key unique \(post_id, user_id, reaction\)/);
  assert.match(migration, /event_participants_identity_key unique \(event_id, user_id\)/);
  assert.match(migration, /midway_comments_user_client_key unique \(user_id, client_comment_id\)/);
  assert.match(migration, /events_creator_client_key unique \(creator_id, client_event_id\)/);
  assert.match(migration, /add column if not exists updated_at timestamptz not null default now\(\)/);
  assert.match(migration, /storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
  assert.doesNotMatch(migration, /pg_get_serial_sequence\('public\.midway_post_reactions', 'id'\)/);
});
