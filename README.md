# AMBRアプリ

青森をバイクで巡る仲間向けの、スマートフォン用ブラウザアプリです。

- 公開アプリ: https://mswiimura-beep.github.io/ambr-ride-app/
- 利用者向け説明書: https://mswiimura-beep.github.io/ambr-ride-app/guide.html

## ファイル構成

- `index.html` — アプリ本体
- `guide.html` — 初めて使う人向け説明書
- `supabase/functions/google-maps-to-gpx/` — Googleマップ共有リンクを予定ルートGPXへ変換するEdge Function
- `supabase/schema_audit.sql` — 共有データの現行スキーマ・権限・重複・写真整合性を確認する読み取り専用SQL
- `supabase/migrations/` — 本番未適用の提案Migration。監査SQLとバックアップ確認後にレビューして適用する
- `tests/` — Supabase連携の所有者確認、再試行、重複防止、例外処理の回帰テスト
- `README.md` — この管理用メモ

アプリは1ページ構成で、GitHub Pagesから公開しています。投稿、写真、イベント、参加・合流予定の共有にはSupabaseを使用します。Googleマップの短縮URL展開とGPX変換にはSupabase Edge Function、道路ルートの再計算にはOSRMを使用します。現在地周辺の天気にはOpen-Meteoを使用し、位置情報は天気取得にだけ利用して保存しません。名前とアイコン、完走記録は利用者の端末内に保存され、完走記録へ連動した元のGPXファイルはIndexedDBに保存されます。

## 利用前の注意

公開URLを知っている人はアプリを開けます。投稿やイベントへ、自宅住所、電話番号、ナンバープレートなどの個人情報を載せないでください。

## 公開方法

`main` ブランチへ反映すると、GitHub Pagesの公開処理が始まります。公開後は、スマートフォン幅で入口、メニュー、投稿、イベント、地図を確認してください。

## ローカル確認

`npm test` で、HTML内JavaScriptの構文と共有データ処理の重要な安全条件を確認できます。Migrationはテスト実行だけでは本番へ適用されません。
