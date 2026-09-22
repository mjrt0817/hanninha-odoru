import { CARDS } from "@/lib/cards";

const REQUIRED_CARD_IDS = [
  "culprit-01",
  "first-discoverer-01",
  "detective-01",
  "alibi-01",
  "scheme-01",
];

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function createMvpDeck(playerCount: number): string[] {
  if (playerCount < 3 || playerCount > 8) {
    throw new Error("3〜8人で遊んでください。");
  }
  const target = playerCount * 4;
  const rest = CARDS.map((card) => card.id).filter((id) => !REQUIRED_CARD_IDS.includes(id));
  return shuffle([...REQUIRED_CARD_IDS, ...shuffle(rest).slice(0, target - REQUIRED_CARD_IDS.length)]);
}

export function dealMvpHands(playerCount: number): string[][] {
  const deck = createMvpDeck(playerCount);
  return Array.from({ length: playerCount }, (_, seat) => deck.slice(seat * 4, seat * 4 + 4));
}
