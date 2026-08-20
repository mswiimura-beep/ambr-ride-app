# AMBRアプリ

青森をバイクで巡る仲間向けの、スマートフォン用ブラウザアプリです。

- 公開アプリ: https://mswiimura-beep.github.io/ambr-ride-app/
- 利用者向け説明書: https://mswiimura-beep.github.io/ambr-ride-app/guide.html

## ファイル構成

- `index.html` — アプリ本体
- `guide.html` — 初めて使う人向け説明書
- `supabase/functions/google-maps-to-gpx/` — Googleマップ共有リンクを予定ルートGPXへ変換するEdge Function
- `supabase/migrations/20260825000100_require_permanent_community_writers.sql` — 「みんなの投稿」の匿名書き込みを拒否する未適用のRLS／Storage案
- `tests/` — GPX導線、共有地図、Google短縮URLと始点・終点検査のローカルテスト
- `supabase/schema_audit_events.sql` — イベント関連テーブル・RLS・権限の読み取り専用監査
- `tests/event-write-results.test.mjs` — 更新・削除が0件のとき成功扱いしない回帰テスト
- `README.md` — この管理用メモ

アプリは1ページ構成で、GitHub Pagesから公開しています。投稿、写真、イベント、参加・合流予定の共有にはSupabaseを使用します。Googleマップの短縮URL展開とGPX変換にはSupabase Edge Function、道路ルートの再計算にはOSRMを使用します。現在地周辺の天気にはOpen-Meteoを使用し、位置情報は天気取得にだけ利用して保存しません。名前とアイコン、完走記録は利用者の端末内に保存され、完走記録へ連動した元のGPXファイルはIndexedDBに保存されます。

## 利用前の注意

公開URLを知っている人はアプリを開け、匿名セッションで「みんなの投稿」を閲覧できます。投稿の作成・編集・削除、写真アップロード、リアクション、コメントは、匿名ではない本人確認済みの参加者ログインが必要です。端末内の名前・アイコン登録はログインの代わりにはなりません。投稿やイベントへ、自宅住所、電話番号、ナンバープレートなどの個人情報を載せないでください。

現状のアプリには匿名セッションを本人確認済みアカウントへ切り替えるログイン画面がありません。そのため、上記マイグレーションを本番へ適用する前にLINE Loginなどの恒久ログイン／アカウント連携を実装する必要があります。適用後は既存の匿名投稿者が以前の投稿を編集・削除できなくなるため、所有権の引き継ぎ方も決めてください。このリポジトリへの追加だけでは本番Supabaseの設定は変わりません。

## 公開方法

`main` ブランチへ反映すると、GitHub Pagesの公開処理が始まります。公開後は、スマートフォン幅で入口、メニュー、投稿、イベント、地図を確認してください。

## ローカル確認

`npm test` で、HTML内JavaScriptの構文と共有データ処理の重要な安全条件を確認できます。Migrationはテスト実行だけでは本番へ適用されません。

テストは外部サービスへ書き込まず、短縮URLや道路ルートの応答をローカルで再現します。

みんなの投稿まわりの構文・写真選択・作成／編集／削除の確認処理は、`node tests/community-posts.test.mjs` で確認できます。

本番反映前に `supabase/schema_audit.sql` を読み取り専用で実行し、問題件数が0であること、既存Storage policyが `midway-photos` へ広い書込権限を与えていないことを確認してください。その後、バックアップを取得してMigrationをレビューします。

### モバイルUI検査

`npm install` のあと `npm run test:mobile` を実行すると、初回入口、共通ナビ、メニューへ戻る操作、全11モーダルのフォーカス、キーボード相当の短い画面、横スクロール、44px以上の押下領域を自動検査します。対象viewportは 320x568、375x667、375x500、375x420、393x852、667x375 です。全モーダルは 320x568、375x420、667x375 で検査します。

Playwright用ブラウザをプロジェクト内だけへ用意する場合は、次を実行します。

```sh
PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers npm run test:mobile
```

`npm run test:external:readonly` は、Open-Meteo、OpenStreetMap、Supabase RESTの認可境界、`google-maps-to-gpx`のCORS応答を読み取り専用で検査します。投稿、認証ユーザー、GPXなどの本番データは作成・変更しません。

実機iPhoneでは、Safariで入口を押したあと、縦向きと横向きの両方で下部ナビ、右上プロフィール、記録フォームを開きます。フォーム入力中に表示が拡大しないこと、キーボード表示中も閉じる操作へスクロールできること、回転後に画面外や横スクロールがないことを公開前に確認してください。
