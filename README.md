# AMBRアプリ

青森をバイクで巡る仲間向けの、スマートフォン用ブラウザアプリです。

- 公開アプリ: https://mswiimura-beep.github.io/ambr-ride-app/
- 利用者向け説明書: https://mswiimura-beep.github.io/ambr-ride-app/guide.html

## ファイル構成

- `index.html` — アプリ本体
- `guide.html` — 初めて使う人向け説明書
- `supabase/functions/google-maps-to-gpx/` — Googleマップ共有リンクを予定ルートGPXへ変換するEdge Function
- `supabase/schema_audit.sql` — 共有データの現行スキーマ・権限・重複・写真整合性を確認する読み取り専用SQL
- `supabase/post_migration_verify.sql` — Migration適用後の権限・所有者移行を確認する読み取り専用SQL
- `supabase/PRODUCTION_ROLLOUT.md` — 監査、バックアップ、Auth/Turnstile、検証用適用、復元確認の手順
- `supabase/functions/merge-anonymous-owner/` — 2つの検証済みAuthセッションから匿名データを既存アカウントへ統合するEdge Function
- `supabase/migrations/` — 本番未適用の提案Migration。監査SQLとバックアップ確認後にレビューして適用する
- `tests/` — Supabase連携の所有者確認、再試行、重複防止、例外処理の回帰テスト
- `README.md` — この管理用メモ

アプリは1ページ構成で、GitHub Pagesから公開しています。投稿、写真、イベント、参加・合流予定の共有にはSupabaseを使用します。Googleマップの短縮URL展開とGPX変換にはSupabase Edge Function、道路ルートの再計算にはOSRMを使用します。現在地周辺の天気にはOpen-Meteoを使用し、位置情報は天気取得にだけ利用して保存しません。名前とアイコン、完走記録は利用者の端末内に保存され、完走記録へ連動した元のGPXファイルはIndexedDBに保存されます。

共有操作は利用者IDに結び付け、通信失敗時は所有者ID付きの送信待ちへ保存します。プロフィール画面では、新しいメールを同じ匿名UIDへ設定する方法と、登録済みメールの6桁OTPで匿名データをサーバー側統合する方法を分けています。この機能には提案MigrationとEdge Function、Supabase Authの匿名認証・Manual Linking・メールOTP・Redirect URL、CAPTCHAまたはTurnstileの設定が必要です。具体的な順番は `supabase/PRODUCTION_ROLLOUT.md` を参照してください。

## 利用前の注意

公開URLを知っている人はアプリを開けます。投稿やイベントへ、自宅住所、電話番号、ナンバープレートなどの個人情報を載せないでください。

## 公開方法

`main` ブランチへ反映すると、GitHub Pagesの公開処理が始まります。公開後は、スマートフォン幅で入口、メニュー、投稿、イベント、地図を確認してください。

## ローカル確認

`npm test` で、HTML内JavaScriptの構文と共有データ処理の重要な安全条件を確認できます。Migrationはテスト実行だけでは本番へ適用されません。

本番反映前に `supabase/schema_audit.sql` を読み取り専用で実行し、問題件数が0であること、既存Storage policyが `midway-photos` へ広い書込権限を与えていないことを確認してください。その後、バックアップを取得してMigrationをレビューします。
