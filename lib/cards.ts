export type CardType =
  | "culprit"
  | "first-discoverer"
  | "dog"
  | "boy"
  | "rumor"
  | "alibi"
  | "detective"
  | "scheme"
  | "civilian"
  | "witness"
  | "info"
  | "trade";

export type CardDef = {
  id: string;
  type: CardType;
  name: string;
  image: string;
  shortEffect: string;
};

const defs: Array<[string, CardType, string, string]> = [
  ["culprit-01", "culprit", "犯人", "最後の1枚で出せれば犯人側の勝利。"],
  ["first-discoverer-01", "first-discoverer", "第一発見者", "事件を発表してゲームを始める。"],
  ["dog-01", "dog", "いぬ", "誰かの手札1枚を公開。犯人なら発見。"],
  ["boy-01", "boy", "少年", "犯人カードを持っている人を秘密に確認。"],
  ...Array.from({ length: 4 }, (_, i) => [`rumor-${String(i + 1).padStart(2, "0")}`, "rumor", "うわさ", "全員で右隣の人からカードを1枚取る。"] as [string, CardType, string, string]),
  ...Array.from({ length: 5 }, (_, i) => [`alibi-${String(i + 1).padStart(2, "0")}`, "alibi", "アリバイ", "手札にある間、探偵に指名されても守られる。"] as [string, CardType, string, string]),
  ...Array.from({ length: 4 }, (_, i) => [`detective-${String(i + 1).padStart(2, "0")}`, "detective", "探偵", "2周目以降、犯人だと思う人を指名。"] as [string, CardType, string, string]),
  ...Array.from({ length: 2 }, (_, i) => [`scheme-${String(i + 1).padStart(2, "0")}`, "scheme", "たくらみ", "以後、犯人側として勝利を目指す。"] as [string, CardType, string, string]),
  ...Array.from({ length: 2 }, (_, i) => [`civilian-${String(i + 1).padStart(2, "0")}`, "civilian", "一般人", "効果なし。"] as [string, CardType, string, string]),
  ...Array.from({ length: 3 }, (_, i) => [`witness-${String(i + 1).padStart(2, "0")}`, "witness", "目撃者", "誰か1人の手札を秘密に確認。"] as [string, CardType, string, string]),
  ...Array.from({ length: 3 }, (_, i) => [`info-${String(i + 1).padStart(2, "0")}`, "info", "情報操作", "全員が左隣へカードを1枚渡す。"] as [string, CardType, string, string]),
  ...Array.from({ length: 5 }, (_, i) => [`trade-${String(i + 1).padStart(2, "0")}`, "trade", "取り引き", "誰か1人と手札を1枚交換。"] as [string, CardType, string, string]),
];

export const CARDS: CardDef[] = defs.map(([id, type, name, shortEffect]) => ({
  id,
  type,
  name,
  shortEffect,
  image: `/cards/${id}.webp`,
}));

export const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card]));
