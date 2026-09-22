追加イラスト置き場です。
PNG / WebP / JPG / SVG を配置し、lib/cards.ts の illustration を次のように指定します。

illustration: {
  kind: "image",
  src: "/card-art/example.webp",
  alt: "カードのイラスト",
  fit: "contain"
}

fit は contain / cover、position は "center top" などを指定できます。
