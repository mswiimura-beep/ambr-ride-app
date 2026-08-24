# Supabase本番反映前チェックリスト

この文書と同梱Migrationは提案のみです。この作業コピーから本番変更、実データ削除、Edge Function公開は行っていません。必ず別の検証用Supabaseプロジェクトで復元・動作確認してから、本番の変更承認を取ってください。

## 1. 監査とバックアップ（最初に実施）

1. Supabase SQL Editorで `schema_audit.sql` を読み取り専用で実行します。
2. 所有者欠落、重複、Storage不整合の `problem_count` がすべて0であることを確認します。0でない場合はMigrationを止め、行を削除せず個別に原因を確認します。
3. `midway-photos` が非公開であること、RLSが有効であること、Storageの全INSERT/UPDATE/DELETE policyが `bucket_id = 'midway-photos'` と `auth.uid()` による所有者制限を持つことを確認します。名前の異なる既存policyも含め、広い `authenticated` / `public` 書込許可が1件でもあれば適用を止めます。
4. パスワードやDB URLをリポジトリへ保存せず、端末の保護された一時ディレクトリへ論理バックアップを取得します。

```sh
umask 077
AMBR_BACKUP_DIR="/private/tmp/ambr-supabase-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$AMBR_BACKUP_DIR"
supabase db dump --db-url "$AMBR_DB_URL" -f "$AMBR_BACKUP_DIR/roles.sql" --role-only
supabase db dump --db-url "$AMBR_DB_URL" -f "$AMBR_BACKUP_DIR/schema.sql"
supabase db dump --db-url "$AMBR_DB_URL" -f "$AMBR_BACKUP_DIR/data.sql" --data-only --use-copy
psql "$AMBR_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/schema_audit.sql > "$AMBR_BACKUP_DIR/preflight-audit.txt"
shasum -a 256 "$AMBR_BACKUP_DIR"/* > "$AMBR_BACKUP_DIR/SHA256SUMS"
test -s "$AMBR_BACKUP_DIR/schema.sql" && test -s "$AMBR_BACKUP_DIR/data.sql"
```

`AMBR_DB_URL` はシェル履歴や `.env` へ平文保存せず、そのセッションだけで安全に設定します。バックアップはGitへ追加しません。

データベースのバックアップにはStorageの実ファイル本体は含まれません。今回の統合MigrationはStorageオブジェクトを移動・削除せず、元のキーを維持します。それでもファイル削除まで巻き戻す必要がある運用では、`midway-photos` オブジェクトを別途安全な保管先へ複製し、件数とハッシュを照合してください。

バックアップは取得だけで完了にしません。別の使い捨て/検証用プロジェクトへ `roles.sql`、`schema.sql`、`data.sql` の順で復元し、エラーなく読めることと主要テーブル件数を照合します。本番プロジェクトを復元テスト先にしないでください。

## 2. Migrationの検証と適用順

1. `20260818000100_shared_data_reliability.sql`
2. `20260825000100_anonymous_owner_merge.sql`
3. `post_migration_verify.sql`（読み取り専用。全 `problem_count = 0` を確認）

検証用プロジェクトで `supabase db push --linked --dry-run` の差分をレビューし、次に検証用へだけ適用します。匿名利用者と登録済み利用者を用意し、下記の受入試験が終わるまで本番へ適用しません。

## 3. Supabase Auth設定

DashboardのAuthentication設定で、次を明示的に確認します。

- General Configuration: **Allow anonymous sign-ins** を有効化。
- General Configuration: **Allow manual linking** を有効化。新しいメールを現在の匿名UIDへ結び付ける `updateUser` に必要です。
- Providers > Email: Email providerとConfirm Emailを有効化。
- Email Templates > Magic Link: 既存アカウント統合用に本文へ `{{ .Token }}`（6桁OTP）を含めます。リンクも残す場合は `{{ .ConfirmationURL }}` と用途を混同しない文面にします。
- URL Configuration: Site URLを `https://mswiimura-beep.github.io/ambr-ride-app/`、Redirect URLsへ `https://mswiimura-beep.github.io/ambr-ride-app/**` を登録します。localhostは検証環境だけに限定します。

## 4. Turnstile/CAPTCHA

1. Cloudflare Turnstileで公開ドメイン用widgetを作成します。
2. 公開前の `index.html` にある `ambr-turnstile-site-key` metaの `content` へ**site keyだけ**を設定します。secret keyはコード、HTML、Git、ログへ入れません。
3. フロントエンドがsite key入りで配信されたことを確認してから、Dashboardの **Settings > Authentication > Bot and Abuse Protection > Enable CAPTCHA protection** を開き、Turnstileとsecretを設定します。順番を逆にすると匿名認証やOTP送信が先に止まります。
4. 匿名サインインと既存メールOTPの両方でchallengeが完了し、`captchaToken` がSupabase Authへ渡ることを検証します。

## 5. 匿名データの安全な統合

`merge-anonymous-owner` Edge FunctionをJWT検証有効のままデプロイします。`--no-verify-jwt` は使用しません。`SUPABASE_SERVICE_ROLE_KEY` はSupabaseがFunctionへ供給するサーバー環境だけで使い、ブラウザやリポジトリへ置きません。必要ならFunction secret `AMBR_ALLOWED_ORIGINS` に許可originをカンマ区切りで設定します。

統合時は、現在の匿名アクセストークンと、登録済みメールOTPで得た別セッションのアクセストークンをFunctionがそれぞれAuthへ照会します。RPCへ渡す利用者IDは検証済みJWTからだけ生成され、ブラウザ指定のIDは受け取りません。RPCはservice role以外から実行できません。統合完了後は旧匿名UIDを監査表で無効化し、残った旧JWTによる書込みをRLSで拒否します。旧匿名Auth行は復元・監査のため自動削除しません。削除が必要になった場合は、別途保持期間と承認を定め、全テーブルとStorageの移行完了を再監査してから行います。

### 受入試験

- 正常系: 匿名利用者で投稿、複数写真、リアクション、コメント、イベント、参加予定、共有ルートを作り、既存メールOTPで統合後、すべてを表示・更新・削除できる。
- 新規メール: 「この端末に設定」で同じUIDが維持され、所有データが移動せず使える。
- 競合: 統合先に同じクライアントIDや同じリアクション/参加予定があっても一意制約エラーにならず、重複が増えない。
- Storage: 旧匿名UIDで始まる写真キーを統合先が削除でき、無関係なUIDの写真は削除できない。
- 攻撃系: target tokenだけ、source tokenだけ、同一token、恒久アカウントをsourceにした要求、匿名アカウントをtargetにした要求、許可外Originをすべて拒否する。
- 再利用: 統合後の旧匿名JWTによるINSERT/UPDATE/DELETEを拒否する。
- 障害系: Function失敗時はメインセッションが匿名のまま、送信待ちがある場合は統合開始を拒否し、再試行できる。

問題が出たら本番適用を中止し、Functionを公開しません。本番反映後の問題ではまず統合Functionへの経路を無効化して新規統合を止め、監査表とバックアップを保存してから復元方針を決めます。行やStorageオブジェクトを手作業で削除して帳尻を合わせないでください。
