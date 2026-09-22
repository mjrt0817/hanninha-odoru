# 犯人は踊る Family Browser Edition Ver.0.4

家族のスマホ・タブレット・PCからブラウザで参加する家庭用マルチプレイヤー版です。アプリストアからのインストールは不要です。

## 構成
- Next.js / Vercel
- Supabase Free（Anonymous Auth / PostgreSQL / Realtime）
- カード本体はHTML/CSS描画
- 標準イラストはSVG相当のベクター描画
- 任意のカードだけ PNG / WebP / JPG / SVG 画像へ差し替え可能

## 初回セットアップ
1. Supabaseでプロジェクトを作成
2. Authentication → Sign In / Providers → Allow anonymous sign-ins をON
3. SQL Editorで `supabase/schema.sql` を全文実行
4. VercelにGitHubリポジトリをImport
5. Environment Variables に以下を登録

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx
```

## 既存 Ver.0.3.1 から更新
`supabase/upgrade_v0_4.sql` を1回実行してから、Ver.0.4をGitHubへPushしてください。詳細は `UPDATE_FROM_V0.3.1.md`。

## Ver.0.4で実装済み
- 3〜8人ルーム / QR参加
- 第一発見者 / 事件入力
- 一般人 / アリバイ / たくらみ
- 少年 / 目撃者の秘密情報
- 探偵 / いぬ / 犯人の勝敗判定
- 取り引き / 情報操作 / うわさの複数端末同期
- PCテストモード（3〜4人、全カード効果の確認）
- デジタルカード一覧 `/cards`

## カードに画像イラストを追加する
画像を `public/card-art/` に置きます。

```ts
illustration: {
  kind: "image",
  src: "/card-art/new-role.webp",
  alt: "新しい役割のイラスト",
  fit: "contain",
  position: "center"
}
```

`contain` は全体表示、`cover` は枠いっぱいに表示します。標準ベクターと画像を混在できます。

## テストURL
- `/test` : PCテストモード
- `/cards` : カード一覧
