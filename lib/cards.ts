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
  shortEffect: string;
  accent: string;
  accent2: string;
  symbol: string;
};

const THEMES: Record<CardType, Pick<CardDef, "accent" | "accent2" | "symbol">> = {
  culprit: { accent: "#ef4444", accent2: "#7f1d1d", symbol: "!" },
  "first-discoverer": { accent: "#f59e0b", accent2: "#92400e", symbol: "!" },
  dog: { accent: "#14b8a6", accent2: "#115e59", symbol: "🐾" },
  boy: { accent: "#38bdf8", accent2: "#075985", symbol: "★" },
  rumor: { accent: "#a78bfa", accent2: "#5b21b6", symbol: "…" },
  alibi: { accent: "#34d399", accent2: "#065f46", symbol: "✓" },
  detective: { accent: "#60a5fa", accent2: "#1e3a8a", symbol: "?" },
  scheme: { accent: "#f472b6", accent2: "#831843", symbol: "♟" },
  civilian: { accent: "#94a3b8", accent2: "#334155", symbol: "○" },
  witness: { accent: "#fb923c", accent2: "#9a3412", symbol: "◉" },
  info: { accent: "#a3e635", accent2: "#3f6212", symbol: "↻" },
  trade: { accent: "#22d3ee", accent2: "#155e75", symbol: "⇄" },
};

const defs: Array<[string, CardType, string, string]> = [
  ["culprit-01", "culprit", "犯人", "最後の1枚のときだけ出せる。出せれば犯人側の勝利。"],
  ["first-discoverer-01", "first-discoverer", "第一発見者", "事件を発表してゲームを始める。"],
  ["dog-01", "dog", "いぬ", "誰かの手札を1枚公開。犯人なら発見！"],
  ["boy-01", "boy", "少年", "犯人カードを持っている人を自分だけ確認する。"],
  ...Array.from({ length: 4 }, (_, i) => [`rumor-${String(i + 1).padStart(2, "0")}`, "rumor", "うわさ", "全員で右隣の人から手札を1枚取る。"] as [string, CardType, string, string]),
  ...Array.from({ length: 5 }, (_, i) => [`alibi-${String(i + 1).padStart(2, "0")}`, "alibi", "アリバイ", "手札にある間、探偵に指名されても守られる。"] as [string, CardType, string, string]),
  ...Array.from({ length: 4 }, (_, i) => [`detective-${String(i + 1).padStart(2, "0")}`, "detective", "探偵", "2周目以降、犯人だと思う人を1人指名する。"] as [string, CardType, string, string]),
  ...Array.from({ length: 2 }, (_, i) => [`scheme-${String(i + 1).padStart(2, "0")}`, "scheme", "たくらみ", "このカードを出した後は犯人側として勝利を目指す。"] as [string, CardType, string, string]),
  ...Array.from({ length: 2 }, (_, i) => [`civilian-${String(i + 1).padStart(2, "0")}`, "civilian", "一般人", "効果はない。静かに場へ出す。"] as [string, CardType, string, string]),
  ...Array.from({ length: 3 }, (_, i) => [`witness-${String(i + 1).padStart(2, "0")}`, "witness", "目撃者", "誰か1人の手札を自分だけ確認する。"] as [string, CardType, string, string]),
  ...Array.from({ length: 3 }, (_, i) => [`info-${String(i + 1).padStart(2, "0")}`, "info", "情報操作", "全員が左隣の人へ手札を1枚渡す。"] as [string, CardType, string, string]),
  ...Array.from({ length: 5 }, (_, i) => [`trade-${String(i + 1).padStart(2, "0")}`, "trade", "取り引き", "誰か1人を選び、手札を1枚ずつ交換する。"] as [string, CardType, string, string]),
];

export const CARDS: CardDef[] = defs.map(([id, type, name, shortEffect]) => ({
  id,
  type,
  name,
  shortEffect,
  ...THEMES[type],
}));

export const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card]));

export const CARD_COUNTS = CARDS.reduce<Record<CardType, number>>((acc, card) => {
  acc[card.type] = (acc[card.type] ?? 0) + 1;
  return acc;
}, {} as Record<CardType, number>);
