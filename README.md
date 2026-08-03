# AMBRアプリ

青森をバイクで巡る仲間向けの、スマートフォン用ブラウザアプリです。

- 公開アプリ: https://mswiimura-beep.github.io/ambr-ride-app/
- 利用者向け説明書: https://mswiimura-beep.github.io/ambr-ride-app/guide.html

## ファイル構成

- `index.html` — アプリ本体
- `guide.html` — 初めて使う人向け説明書
- `supabase/functions/google-maps-to-gpx/` — Googleマップ共有リンクを予定ルートGPXへ変換するEdge Function
- `README.md` — この管理用メモ

アプリは1ページ構成で、GitHub Pagesから公開しています。投稿、写真、イベント、参加・合流予定の共有にはSupabaseを使用します。Googleマップの短縮URL展開とGPX変換にはSupabase Edge Function、道路ルートの再計算にはOSRMを使用します。名前とアイコン、完走記録は利用者の端末内に保存され、完走記録へ連動した元のGPXファイルはIndexedDBに保存されます。

## 利用前の注意

公開URLを知っている人はアプリを開けます。投稿やイベントへ、自宅住所、電話番号、ナンバープレートなどの個人情報を載せないでください。

## 公開方法

`main` ブランチへ反映すると、GitHub Pagesの公開処理が始まります。公開後は、スマートフォン幅で入口、メニュー、投稿、イベント、地図を確認してください。
