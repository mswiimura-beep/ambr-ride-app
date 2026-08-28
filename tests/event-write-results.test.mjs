import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const migration = await readFile(
  new URL('../supabase/migrations/20260825000100_event_ownership_rls.sql', import.meta.url),
  'utf8'
);

const helperSource = html.match(
  /function requireChangedRow\(result,message\)\{[^}]+\}/
)?.[0];
assert.ok(helperSource, 'requireChangedRow helper must exist');
const requireChangedRow = vm.runInNewContext(`(${helperSource})`);
const deleteStart = html.indexOf('async function deleteEvent()');
const deleteEnd = html.indexOf('  function openRideGpxDb()', deleteStart);
assert.ok(deleteStart >= 0 && deleteEnd > deleteStart, 'deleteEvent source must exist');
const deleteSource = html.slice(deleteStart, deleteEnd);

function deleteContext(returnedData) {
  const state = { hidden: false, refreshed: false, toasts: [] };
  const builder = {
    eq() { return builder; },
    select() { return builder; },
    async maybeSingle() { return { data: returnedData, error: null }; }
  };
  const context = vm.createContext({
    activeEventId: 'event-1',
    eventsData: [{ id: 'event-1', creator_id: 'user-1' }],
    confirm: () => true,
    ensureMidwaySession: async () => ({ id: 'user-1' }),
    supabaseClient: { from: () => ({ delete: () => builder }) },
    requireChangedRow,
    hideModal: () => { state.hidden = true; },
    history: { replaceState: () => {} },
    location: { pathname: '/', search: '' },
    showToast: message => state.toasts.push(message),
    refreshEvents: async () => { state.refreshed = true; }
  });
  vm.runInContext(deleteSource, context);
  return { context, state };
}

test('returned update or delete row is accepted', () => {
  assert.deepEqual(requireChangedRow({ data: { id: 'event-1' }, error: null }, 'failed'), {
    id: 'event-1'
  });
});

test('zero-row update or delete is rejected', () => {
  assert.throws(
    () => requireChangedRow({ data: null, error: null }, 'no changed row'),
    /no changed row/
  );
});

test('Supabase errors are preserved', () => {
  const sourceError = new Error('rls denied');
  assert.throws(() => requireChangedRow({ data: null, error: sourceError }, 'fallback'), sourceError);
});

test('event update and delete request returned ids and verify ownership', () => {
  assert.match(
    html,
    /update\(payload\)\.eq\('id',existing\.id\)\.eq\('creator_id',user\.id\)\.select\('id'\)\.maybeSingle\(\)/
  );
  assert.match(
    html,
    /delete\(\)\.eq\('id',record\.id\)\.eq\('creator_id',user\.id\)\.select\('id'\)\.maybeSingle\(\)/
  );
});

test('zero-row event deletion stays open and reports failure', async () => {
  const { context, state } = deleteContext(null);
  await context.deleteEvent();
  assert.equal(state.hidden, false);
  assert.equal(state.refreshed, false);
  assert.deepEqual(state.toasts, [
    'イベントを削除できませんでした。主催者権限または公開設定を確認してください'
  ]);
});

test('event deletion reports success only when a row is returned', async () => {
  const { context, state } = deleteContext({ id: 'event-1' });
  await context.deleteEvent();
  assert.equal(state.hidden, true);
  assert.equal(state.refreshed, true);
  assert.deepEqual(state.toasts, ['イベントを削除しました']);
});

test('event RLS proposal limits writes to each authenticated owner', () => {
  assert.match(migration, /ambr_events_update[\s\S]+creator_id = auth\.uid\(\)/);
  assert.match(migration, /ambr_events_delete[\s\S]+creator_id = auth\.uid\(\)/);
  assert.match(migration, /ambr_participants_update[\s\S]+user_id = auth\.uid\(\)/);
  assert.match(migration, /ambr_participants_delete[\s\S]+user_id = auth\.uid\(\)/);
  assert.match(migration, /revoke all[\s\S]+from anon/);
});
