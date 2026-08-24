import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../guide.html', import.meta.url), 'utf8');
const permanentWriterMigration = readFileSync(new URL('../supabase/migrations/20260825000100_require_permanent_community_writers.sql', import.meta.url), 'utf8');
const inlineScript = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/)?.[1];

assert.ok(inlineScript, 'アプリ本体のインラインスクリプトを取得できる');
assert.doesNotThrow(() => new Function(inlineScript), 'アプリのJavaScriptに構文エラーがない');

assert.match(html, /id="midwayPhotoInput"[^>]*multiple/, '写真ライブラリから複数選択できる');
assert.match(html, /id="midwayCameraInput"[^>]*capture="environment"/, 'スマホの背面カメラを自然に開ける');
assert.match(html, /currentCount\+files\.length>5/, '既存写真と追加写真の合計を5枚に制限する');
assert.match(html, /\.midway-photo-preview-item img\{[^}]*object-fit:contain/, '選択写真を切り取らず全体表示する');
assert.match(html, /\.shared-post-media\{[^}]*grid-template-columns:1fr 1fr/, '投稿カードを地図と写真の2列で表示する');
assert.match(html, /openMidwayGallery\(photoUrls,index,place\)/, '投稿写真から全写真ギャラリーを開ける');

assert.match(html, /edit\.textContent='編集'/, '自分の投稿に編集操作を表示する');
assert.match(html, /from\('midway_posts'\)\.update\(payload\)[\s\S]*?select\([^\n]+\)\.maybeSingle\(\)/, '編集後の実データを読み戻す');
assert.match(html, /from\('midway_posts'\)\.delete\(\)[\s\S]*?select\('id'\)\.maybeSingle\(\)/, '削除後の実データ状態を確認する');
assert.match(html, /midwaySavedRecordMatches\(saved,user,record,paths\)/, '新規投稿後に本文・場所・写真を照合する');
assert.match(html, /未共有です。通信できないため送信待ちに保存しました/, '未送信を共有済みと表示しない');

assert.match(html, /fetchPlaceCandidates\(query,controller\.signal\)/, '地名・施設名の候補検索を使う');
assert.match(html, /place\+'をGoogleマップで開く/, '施設名を示した地図リンクを作る');
assert.match(html, /midwayReactionTypes=.*いいね.*いい写真.*行ってみたい/, '3種類のリアクションを提供する');
assert.match(html, /midway_post_comments/, '投稿コメントをSupabaseと同期する');
assert.match(guide, /自分の投稿に.*「編集」と「削除」/, '説明書に投稿編集・削除を記載する');

const permanentUserHelper = inlineScript.match(/function isPermanentMidwayUser\(user\)\{[^}]+\}/)?.[0];
assert.ok(permanentUserHelper, '恒久ログイン判定を取得できる');
const isPermanentMidwayUser = new Function(`${permanentUserHelper}; return isPermanentMidwayUser;`)();
assert.equal(isPermanentMidwayUser({ is_anonymous: true }), false, '匿名Auth利用者は見る専として拒否する');
assert.equal(isPermanentMidwayUser({ is_anonymous: false }), true, '匿名でないAuth利用者は投稿可能と判定する');
assert.equal(isPermanentMidwayUser({}), false, '匿名属性がない場合も安全側に拒否する');
assert.match(html, /async function sendMidwayRecord\(record\)\{\s*const user=await ensureMidwayWriteSession\(\)/, '新規投稿と再送の共通経路で参加者ログインを検査する');
assert.match(html, /async function updateMidwayRecord\(record\)\{\s*const user=await ensureMidwayWriteSession\(\)/, '投稿編集で参加者ログインを検査する');
assert.match(html, /async function deleteMidwayPost[\s\S]*?ensureMidwayWriteSession\(\)/, '投稿削除で参加者ログインを検査する');
assert.match(html, /toggleMidwayReaction[\s\S]*?ensureMidwayWriteSession\(\)/, 'リアクションで参加者ログインを検査する');
assert.match(html, /submitMidwayComment[\s\S]*?ensureMidwayWriteSession\(\)/, 'コメント送信で参加者ログインを検査する');
assert.match(html, /deleteMidwayComment[\s\S]*?ensureMidwayWriteSession\(\)/, 'コメント削除で参加者ログインを検査する');
assert.match(html, /catch\(e\)\{if\(isMidwayWriteAuthError\(e\)\)\{[^}]+return\}try\{queueMidwayRecord/, '認証拒否を通信障害として送信待ちに保存しない');
assert.match(html, /textarea\.disabled=!canWrite/, '見る専のコメント入力欄を無効にする');

assert.equal((permanentWriterMigration.match(/as restrictive/g) || []).length, 10, '投稿・反応・コメント・写真の全変更操作にrestrictive policyを置く');
assert.match(permanentWriterMigration, /public\.midway_posts[\s\S]*?is_anonymous/, '投稿RLSで匿名Authを拒否する');
assert.match(permanentWriterMigration, /public\.midway_post_reactions[\s\S]*?is_anonymous/, 'リアクションRLSで匿名Authを拒否する');
assert.match(permanentWriterMigration, /public\.midway_post_comments[\s\S]*?is_anonymous/, 'コメントRLSで匿名Authを拒否する');
assert.match(permanentWriterMigration, /bucket_id <> 'midway-photos'[\s\S]*?is_anonymous/, 'Storage制限をmidway-photosだけに安全に限定する');

console.log('community posts: 33 checks passed');
