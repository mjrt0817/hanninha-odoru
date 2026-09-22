# 犯人は踊る Family Browser Edition Ver.0.6

家族のスマホ・タブレット・PCからブラウザで参加する家庭用マルチプレイヤー版です。アプリストアからのインストールは不要です。

## 構成
- Next.js / Vercel
- Supabase Free（Anonymous Auth / PostgreSQL / Realtime）
- カード本体はHTML/CSS描画
- 標準イラストはSVG相当のベクター描画
- 任意のカードだけ PNG / WebP / JPG / SVG 画像へ差し替え可能
- 効果音/BGMはWeb Audio APIで生成（音声ファイルの通信不要）

## 初回セットアップ
1. Supabaseでプロジェクトを作成
2. Authentication → Sign In / Providers → Allow anonymous sign-ins をON
3. SQL Editorで `supabase/schema.sql` を全文実行（新規導入ではこれだけでVer.0.5のDB機能まで入ります）
4. VercelにGitHubリポジトリをImport
5. Environment Variables に以下を登録

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx
```

## 既存 Ver.0.4 から更新
`supabase/upgrade_v0_5.sql` を1回実行してから、Ver.0.6をGitHubへPushしてください。詳細は `UPDATE_FROM_V0.4.md`。

## Ver.0.6で実装済み
- 3〜8人ルーム / QR参加
- 第一発見者 / 事件入力
- 全カード効果
- 取り引き / 情報操作 / うわさの複数端末同期
- 二重タップによるRPC多重実行をクライアント側でも抑止
- 自分の手番と各プレイヤーの手札枚数を見やすく表示
- 複数人カード効果で「誰の選択待ちか」を表示
- ブラウザを閉じても同じ端末から「前回のゲームに戻る」
- オンライン復帰 / 画面復帰時に状態を再取得
- ゲーム終了後に全員の残り手札を公開
- 犯人カードが誰から誰へ移動したかを終了後だけ表示
- ホストによるゲームリセット / 同じメンバーでリプレイ
- 効果音ON/OFF
- ホスト端末限定BGM ON/OFF
- 自分の手番通知
- 犯人カード到着時の本人限定演出・振動
- 終了時のアニメーション
- PCテストモード（3〜4人、終了公開とリプレイ対応）
- デジタルカード一覧 `/cards`

## サウンド
ブラウザの自動再生制限に対応するため、各端末で最初に「効果音 ON」を1回タップします。
BGMは複数端末でズレて鳴らないよう、ホスト端末だけで鳴らします。
音声ファイルは配信せずWeb Audio APIで生成するため、通信量はほぼ増えません。

## カードに画像イラストを追加する
画像を `public/card-art/` に置き、`lib/cards.ts` の `ILLUSTRATION_OVERRIDES` に追加します。

```ts
"detective-01": {
  kind: "image",
  src: "/card-art/detective-family.webp",
  alt: "探偵のイラスト",
  fit: "contain",
  position: "center"
}
```

`contain` は全体表示、`cover` は枠いっぱいに表示します。標準ベクターと画像を混在できます。

## テストURL
- `/test` : PCテストモード
- `/cards` : カード一覧
