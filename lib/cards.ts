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
  ruleText: string;
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

const RULES: Record<CardType, { shortEffect: string; ruleText: string }> = {
  culprit: {
    shortEffect: "最後の1枚のときだけ出せる。出せれば犯人側の勝利。",
    ruleText: "探偵に当てられてしまうと敗け。\n最後の手札1枚のときだけ出せる。出せたなら勝ち。",
  },
  "first-discoverer": {
    shortEffect: "事件を発表してゲームを始める。",
    ruleText: "このカードを出してゲームを始める。\n今回起こった事件を考えて、全員に伝えよう。",
  },
  dog: {
    shortEffect: "誰かの手札を1枚公開。犯人なら発見！",
    ruleText: "他のだれか1人の手札を1枚選ぶ。\n選んだカードを全員に見せる。\nそのカードが犯人なら勝ち。\n犯人でないならもとにもどす。",
  },
  boy: {
    shortEffect: "犯人カードを持っている人を自分だけ確認する。",
    ruleText: "他全員に指示して犯人を知る。\n①「はい みなさん、目を閉じて」\n②「犯人カードを持っている人は目をあけて」\n③「みなさん、目をあけて」",
  },
  rumor: {
    shortEffect: "全員で右隣の人から手札を1枚取る。",
    ruleText: "全員、自分の右どなりの人の手札からこっそり1枚ひく。",
  },
  alibi: {
    shortEffect: "手札にある間、探偵に指名されても守られる。",
    ruleText: "手札にあれば、\n「犯人ではありません。」と答えられる。\n出しても何も起きない。",
  },
  detective: {
    shortEffect: "2周目以降、犯人だと思う人を1人指名する。",
    ruleText: "他のだれか1人に\n「あなたが犯人ですね？」と聞く。\n当たれば勝ち。\n2周目になるまでは使えない。",
  },
  scheme: {
    shortEffect: "このカードを出した後は犯人側として勝利を目指す。",
    ruleText: "出すと、犯人の味方になる。\n犯人が勝つと、同じく勝ち。\n犯人が敗けると、同じく敗け。",
  },
  civilian: {
    shortEffect: "効果はない。静かに場へ出す。",
    ruleText: "出しても何も起きない。",
  },
  witness: {
    shortEffect: "誰か1人の手札を自分だけ確認する。",
    ruleText: "他のだれか1人の手札を、\nこっそりぜんぶ見せてもらう。",
  },
  info: {
    shortEffect: "全員が左隣の人へ手札を1枚渡す。",
    ruleText: "全員、自分の左どなりの人に\n手札の1枚をこっそりわたす。",
  },
  trade: {
    shortEffect: "誰か1人を選び、手札を1枚ずつ交換する。",
    ruleText: "他のだれか1人と、手札の1枚を\nこっそり交換しあう。\n（手札がないなら交換しない）",
  },
};

const defs: Array<[string, CardType, string]> = [
  ["culprit-01", "culprit", "犯人"],
  ["first-discoverer-01", "first-discoverer", "第一発見者"],
  ["dog-01", "dog", "いぬ"],
  ["boy-01", "boy", "少年"],
  ...Array.from({ length: 4 }, (_, i) => [`rumor-${String(i + 1).padStart(2, "0")}`, "rumor", "うわさ"] as [string, CardType, string]),
  ...Array.from({ length: 5 }, (_, i) => [`alibi-${String(i + 1).padStart(2, "0")}`, "alibi", "アリバイ"] as [string, CardType, string]),
  ...Array.from({ length: 4 }, (_, i) => [`detective-${String(i + 1).padStart(2, "0")}`, "detective", "探偵"] as [string, CardType, string]),
  ...Array.from({ length: 2 }, (_, i) => [`scheme-${String(i + 1).padStart(2, "0")}`, "scheme", "たくらみ"] as [string, CardType, string]),
  ...Array.from({ length: 2 }, (_, i) => [`civilian-${String(i + 1).padStart(2, "0")}`, "civilian", "一般人"] as [string, CardType, string]),
  ...Array.from({ length: 3 }, (_, i) => [`witness-${String(i + 1).padStart(2, "0")}`, "witness", "目撃者"] as [string, CardType, string]),
  ...Array.from({ length: 3 }, (_, i) => [`info-${String(i + 1).padStart(2, "0")}`, "info", "情報操作"] as [string, CardType, string]),
  ...Array.from({ length: 5 }, (_, i) => [`trade-${String(i + 1).padStart(2, "0")}`, "trade", "取り引き"] as [string, CardType, string]),
];

export const CARDS: CardDef[] = defs.map(([id, type, name]) => ({
  id,
  type,
  name,
  ...RULES[type],
  ...THEMES[type],
}));

export const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card]));

export const CARD_COUNTS = CARDS.reduce<Record<CardType, number>>((acc, card) => {
  acc[card.type] = (acc[card.type] ?? 0) + 1;
  return acc;
}, {} as Record<CardType, number>);
