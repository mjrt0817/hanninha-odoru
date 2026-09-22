# Ver.0.3.1 → Ver.0.4 更新手順

## 1. Supabase SQL を実行
Supabase Dashboard → SQL Editor → New query で、`supabase/upgrade_v0_4.sql` を全文貼り付けて Run してください。

追加される主な機能:
- 一般人 / アリバイ / たくらみ
- 少年（使用者だけに犯人の現在地を表示）
- 目撃者（使用者だけに相手の手札を表示）
- 探偵 / いぬ / 犯人の勝敗判定
- 取り引き（当事者2名が各1枚選択）
- 情報操作（全員が左隣へ1枚）
- うわさ（全員が右隣から裏向きで1枚）
- 複数端末での選択待ち状態

## 2. GitHub を Ver.0.4 の内容で上書き
既存リポジトリへこのZIPの内容を反映して Push してください。Vercel は自動再デプロイされます。

環境変数の追加・変更はありません。

## 3. PCテスト
`/test` で3〜4人分を1画面で操作できます。Ver.0.4では12種類のカード効果を一通り試せます。

## 画像イラストの追加
`public/card-art/` に PNG / WebP / JPG / SVG を置き、`lib/cards.ts` の該当カードを次の形式にします。

```ts
illustration: {
  kind: "image",
  src: "/card-art/my-card.webp",
  alt: "イラスト説明",
  fit: "contain", // または cover
  position: "center"
}
```

既存カードは `kind: "builtin"` のまま使えます。画像カードとの混在も可能です。
