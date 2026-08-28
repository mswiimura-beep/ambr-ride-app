# イベントRLS適用前の確認

このフォルダのSQLは提案のみで、本番には未適用です。

1. Supabaseでバックアップを取得する。
2. `schema_audit_events.sql`をSQL Editorで実行し、所有者なし・参加者重複がすべて0件であることを確認する。
3. 現在の`events`、`event_participants`ポリシーとGRANTを保存する。
4. AuthenticationでAnonymous Sign-Insが有効か確認する。
5. `20260825000100_event_ownership_rls.sql`をレビューしてから適用する。
6. 別々の匿名利用者A・Bで、閲覧は両者可、自分の作成・編集・削除と自分の参加変更だけ可、他人の変更は0件になることを確認する。
7. iPhone Safariで作成、途中合流、編集、削除、再読み込み後の表示を確認する。

監査結果やバックアップを確認せずに適用しないでください。移行SQLは既存のイベント関連ポリシーを置き換えます。
