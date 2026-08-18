import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../guide.html', import.meta.url), 'utf8');
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
assert.match(guide, /自分の投稿には「編集」と「削除」/, '説明書に投稿編集・削除を記載する');

console.log('community posts: 16 checks passed');
