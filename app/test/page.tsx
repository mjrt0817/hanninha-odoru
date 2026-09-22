"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CARD_BY_ID, type CardType } from "@/lib/cards";
import { dealMvpHands } from "@/lib/deck";
import { DigitalCard, DigitalCardBack } from "@/components/cards/DigitalCard";

type TestPlayer = {
  name: string;
  hand: string[];
  hidden: boolean;
  playedCount: number;
  accomplice: boolean;
};

type Pending =
  | { kind: "target"; actorSeat: number; cardId: string; effect: "witness" | "detective" | "dog" | "trade" }
  | { kind: "dog-slot"; actorSeat: number; cardId: string; targetSeat: number }
  | { kind: "trade"; actorSeat: number; targetSeat: number; actorChoice?: string; targetChoice?: string }
  | { kind: "info"; actorSeat: number; selections: Record<number, string> }
  | { kind: "rumor"; actorSeat: number; selections: Record<number, string> };

type Reveal = { title: string; message: string; cards?: string[] } | null;
type TestTrail = { fromSeat: number | null; toSeat: number; action: string };

const DEFAULT_NAMES = ["プレイヤー1", "プレイヤー2", "プレイヤー3", "プレイヤー4"];

function cardName(cardId: string) {
  return CARD_BY_ID.get(cardId)?.name ?? cardId;
}

export default function TestPage() {
  const [playerCount, setPlayerCount] = useState<3 | 4>(4);
  const [players, setPlayers] = useState<TestPlayer[]>([]);
  const [phase, setPhase] = useState<"idle" | "awaiting_incident" | "turn" | "action" | "finished">("idle");
  const [currentSeat, setCurrentSeat] = useState<number | null>(null);
  const [incident, setIncident] = useState("");
  const [incidentDraft, setIncidentDraft] = useState("");
  const [incidentEditorSeat, setIncidentEditorSeat] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [reveal, setReveal] = useState<Reveal>(null);
  const [result, setResult] = useState("");
  const [culpritTrail, setCulpritTrail] = useState<TestTrail[]>([]);

  function deal() {
    const hands = dealMvpHands(playerCount);
    const nextPlayers = hands.map((hand, index) => ({
      name: DEFAULT_NAMES[index], hand, hidden: false, playedCount: 0, accomplice: false,
    }));
    const firstSeat = nextPlayers.findIndex((p) => p.hand.includes("first-discoverer-01"));
    setPlayers(nextPlayers);
    setCurrentSeat(firstSeat);
    setPhase("awaiting_incident");
    setIncident("");
    setIncidentDraft("");
    setIncidentEditorSeat(null);
    setPending(null);
    setReveal(null);
    setResult("");
    const culpritSeat = nextPlayers.findIndex((p) => p.hand.some((id) => CARD_BY_ID.get(id)?.type === "culprit"));
    setCulpritTrail(culpritSeat >= 0 ? [{ fromSeat: null, toSeat: culpritSeat, action: "配札" }] : []);
    setMessage("第一発見者のカードをタップして事件を発表してください。");
  }

  function nextSeat(nextPlayers: TestPlayer[], fromSeat: number) {
    for (let step = 1; step <= nextPlayers.length; step += 1) {
      const seat = (fromSeat + step) % nextPlayers.length;
      if (nextPlayers[seat].hand.length > 0) return seat;
    }
    return null;
  }

  function finish(text: string) {
    setResult(text);
    setMessage(text);
    setPhase("finished");
    setCurrentSeat(null);
    setPending(null);
  }

  function culpritSeatOf(snapshot: TestPlayer[]) {
    return snapshot.findIndex((p) => p.hand.some((id) => CARD_BY_ID.get(id)?.type === "culprit"));
  }

  function recordCulpritMove(before: TestPlayer[], after: TestPlayer[], action: string) {
    const fromSeat = culpritSeatOf(before);
    const toSeat = culpritSeatOf(after);
    if (fromSeat >= 0 && toSeat >= 0 && fromSeat !== toSeat) {
      setCulpritTrail((prev) => [...prev, { fromSeat, toSeat, action }]);
    }
  }

  function advance(nextPlayers: TestPlayer[], fromSeat: number, publicMessage: string) {
    const next = nextSeat(nextPlayers, fromSeat);
    setPlayers(nextPlayers);
    if (next === null) {
      finish("全員の手札がなくなりました。ゲーム終了です。");
      return;
    }
    setCurrentSeat(next);
    setPhase("turn");
    setMessage(publicMessage);
    setPending(null);
  }

  function consume(snapshot: TestPlayer[], seat: number, cardId: string, accomplice = false) {
    return snapshot.map((p, idx) => idx === seat ? {
      ...p,
      hand: p.hand.filter((id) => id !== cardId),
      playedCount: p.playedCount + 1,
      accomplice: p.accomplice || accomplice,
    } : p);
  }

  function tapCard(seat: number, cardId: string) {
    if (phase === "awaiting_incident" && seat === currentSeat && cardId === "first-discoverer-01") {
      setIncidentEditorSeat(seat);
      setMessage("");
      return;
    }
    if (phase !== "turn" || seat !== currentSeat || pending) {
      setMessage("今はこのカードを使う番ではありません。");
      return;
    }

    const def = CARD_BY_ID.get(cardId);
    if (!def) return;

    if (def.type === "detective" && players[seat].playedCount < 1) {
      setMessage("探偵は2周目（このプレイヤーが一度カードを出した後）から使えます。");
      return;
    }
    if (def.type === "culprit" && players[seat].hand.length !== 1) {
      setMessage("犯人は最後の手札1枚になったときだけ出せます。");
      return;
    }

    if (["witness", "detective", "dog", "trade"].includes(def.type)) {
      setPending({ kind: "target", actorSeat: seat, cardId, effect: def.type as "witness" | "detective" | "dog" | "trade" });
      setPhase("action");
      setMessage(`${def.name}：相手を選んでください。`);
      return;
    }

    if (def.type === "boy") {
      const culpritSeat = players.findIndex((p) => p.hand.some((id) => CARD_BY_ID.get(id)?.type === "culprit"));
      const nextPlayers = consume(players, seat, cardId);
      setReveal({ title: `🤫 ${players[seat].name}だけの情報`, message: culpritSeat >= 0 ? `犯人カードを持っているのは「${players[culpritSeat].name}」です。` : "犯人カードはすでに場に出ています。" });
      advance(nextPlayers, seat, `${players[seat].name}が「少年」を使いました。秘密の情報を確認しました。`);
      return;
    }

    if (def.type === "scheme") {
      const nextPlayers = consume(players, seat, cardId, true);
      advance(nextPlayers, seat, `${players[seat].name}が「たくらみ」を出しました。犯人側になりました。`);
      return;
    }

    if (def.type === "info") {
      const nextPlayers = consume(players, seat, cardId);
      const eligible = nextPlayers.map((p, idx) => p.hand.length > 0 ? idx : -1).filter((idx) => idx >= 0);
      if (eligible.length === 0) return advance(nextPlayers, seat, "情報操作を出しましたが、渡せるカードがありませんでした。");
      setPlayers(nextPlayers);
      setPending({ kind: "info", actorSeat: seat, selections: {} });
      setPhase("action");
      setMessage("情報操作：各プレイヤーが左隣へ渡すカードを1枚選んでください。");
      return;
    }

    if (def.type === "rumor") {
      const nextPlayers = consume(players, seat, cardId);
      const hasAnyTarget = nextPlayers.some((_, chooser) => nextPlayers[(chooser - 1 + nextPlayers.length) % nextPlayers.length].hand.length > 0);
      if (!hasAnyTarget) return advance(nextPlayers, seat, "うわさを出しましたが、取れるカードがありませんでした。");
      setPlayers(nextPlayers);
      setPending({ kind: "rumor", actorSeat: seat, selections: {} });
      setPhase("action");
      setMessage("うわさ：全員が右隣の人の手札から1枚選んでください。");
      return;
    }

    if (def.type === "culprit") {
      const nextPlayers = consume(players, seat, cardId);
      setPlayers(nextPlayers);
      const winners = nextPlayers.map((p, idx) => (idx === seat || p.accomplice) ? p.name : null).filter(Boolean);
      finish(`🎉 犯人側の勝利！ 勝者：${winners.join("・")}`);
      return;
    }

    // 一般人・アリバイ
    const nextPlayers = consume(players, seat, cardId);
    advance(nextPlayers, seat, `${players[seat].name}が「${def.name}」を出しました。`);
  }

  function chooseTarget(targetSeat: number) {
    if (!pending || pending.kind !== "target") return;
    const { actorSeat, cardId, effect } = pending;
    const actor = players[actorSeat];
    const target = players[targetSeat];

    if (effect === "dog") {
      if (target.hand.length === 0) { setMessage("その人は手札を持っていません。別の人を選んでください。"); return; }
      setPending({ kind: "dog-slot", actorSeat, cardId, targetSeat });
      setMessage(`いぬ：${target.name}の手札から1枚選んでください。`);
      return;
    }

    if (effect === "trade") {
      const nextPlayers = consume(players, actorSeat, cardId);
      if (nextPlayers[actorSeat].hand.length === 0 || nextPlayers[targetSeat].hand.length === 0) {
        advance(nextPlayers, actorSeat, `${actor.name}が「取り引き」を出しましたが、交換できる手札がありませんでした。`);
        return;
      }
      setPlayers(nextPlayers);
      setPending({ kind: "trade", actorSeat, targetSeat });
      setMessage(`取り引き：${actor.name}と${target.name}が、それぞれ渡すカードを選びます。`);
      return;
    }

    const nextPlayers = consume(players, actorSeat, cardId);
    if (effect === "witness") {
      setReveal({ title: `👁️ ${actor.name}だけの目撃情報`, message: `${target.name}の手札です。`, cards: target.hand });
      advance(nextPlayers, actorSeat, `${actor.name}が${target.name}に「目撃者」を使いました。`);
      return;
    }

    const hasCulprit = target.hand.some((id) => CARD_BY_ID.get(id)?.type === "culprit");
    const hasAlibi = target.hand.some((id) => CARD_BY_ID.get(id)?.type === "alibi");
    setPlayers(nextPlayers);
    if (hasCulprit && !hasAlibi) {
      finish(`🕵️ ${actor.name}の探偵が的中！ ${target.name}から犯人を発見しました。${actor.name}の勝利！`);
    } else {
      advance(nextPlayers, actorSeat, hasCulprit && hasAlibi
        ? `🪪 ${target.name}にはアリバイがありました。探偵の指名は失敗です。`
        : `❌ ${target.name}は犯人ではありませんでした。`);
    }
  }

  function chooseDogSlot(slot: number) {
    if (!pending || pending.kind !== "dog-slot") return;
    const { actorSeat, cardId, targetSeat } = pending;
    const selected = players[targetSeat].hand[slot];
    if (!selected) return;
    const nextPlayers = consume(players, actorSeat, cardId);
    setPlayers(nextPlayers);
    if (CARD_BY_ID.get(selected)?.type === "culprit") {
      finish(`🐶 ${players[actorSeat].name}のいぬが、${players[targetSeat].name}の「犯人」を発見！ ${players[actorSeat].name}の勝利！`);
    } else {
      advance(nextPlayers, actorSeat, `🐶 ${players[targetSeat].name}の手札から「${cardName(selected)}」が公開されました。犯人ではありません。`);
    }
  }

  function chooseTradeCard(seat: number, cardId: string) {
    if (!pending || pending.kind !== "trade") return;
    const next = { ...pending };
    if (seat === pending.actorSeat) next.actorChoice = cardId;
    if (seat === pending.targetSeat) next.targetChoice = cardId;
    setPending(next);
  }

  function applyTrade() {
    if (!pending || pending.kind !== "trade" || !pending.actorChoice || !pending.targetChoice) return;
    const { actorSeat, targetSeat, actorChoice, targetChoice } = pending;
    const nextPlayers = players.map((p, idx) => {
      if (idx === actorSeat) return { ...p, hand: [...p.hand.filter((id) => id !== actorChoice), targetChoice] };
      if (idx === targetSeat) return { ...p, hand: [...p.hand.filter((id) => id !== targetChoice), actorChoice] };
      return p;
    });
    recordCulpritMove(players, nextPlayers, "取り引き");
    advance(nextPlayers, actorSeat, `🔄 ${players[actorSeat].name}と${players[targetSeat].name}がカードを1枚ずつ取り引きしました。`);
  }

  function chooseInfoCard(seat: number, cardId: string) {
    if (!pending || pending.kind !== "info") return;
    setPending({ ...pending, selections: { ...pending.selections, [seat]: cardId } });
  }

  function applyInfo() {
    if (!pending || pending.kind !== "info") return;
    const eligible = players.map((p, idx) => p.hand.length > 0 ? idx : -1).filter((idx) => idx >= 0);
    if (!eligible.every((seat) => pending.selections[seat])) return;
    const nextPlayers = players.map((p) => ({ ...p, hand: [...p.hand] }));
    for (const seat of eligible) {
      const cardId = pending.selections[seat];
      nextPlayers[seat].hand = nextPlayers[seat].hand.filter((id) => id !== cardId);
    }
    for (const seat of eligible) {
      const left = (seat + 1) % players.length;
      nextPlayers[left].hand.push(pending.selections[seat]);
    }
    recordCulpritMove(players, nextPlayers, "情報操作");
    advance(nextPlayers, pending.actorSeat, "📡 情報操作：全員が左隣へカードを1枚渡しました。");
  }

  function chooseRumorCard(chooserSeat: number, cardId: string) {
    if (!pending || pending.kind !== "rumor") return;
    setPending({ ...pending, selections: { ...pending.selections, [chooserSeat]: cardId } });
  }

  function applyRumor() {
    if (!pending || pending.kind !== "rumor") return;
    const eligible = players.map((_, chooser) => {
      const right = (chooser - 1 + players.length) % players.length;
      return players[right].hand.length > 0 ? chooser : -1;
    }).filter((seat) => seat >= 0);
    if (!eligible.every((seat) => pending.selections[seat])) return;
    const nextPlayers = players.map((p) => ({ ...p, hand: [...p.hand] }));
    for (const chooser of eligible) {
      const right = (chooser - 1 + players.length) % players.length;
      nextPlayers[right].hand = nextPlayers[right].hand.filter((id) => id !== pending.selections[chooser]);
    }
    for (const chooser of eligible) nextPlayers[chooser].hand.push(pending.selections[chooser]);
    recordCulpritMove(players, nextPlayers, "うわさ");
    advance(nextPlayers, pending.actorSeat, "📢 うわさ：全員が右隣の人からカードを1枚取りました。");
  }

  function announceIncident() {
    if (incidentEditorSeat === null) return;
    const text = incidentDraft.trim() || "大切なおやつがなくなった！";
    const nextPlayers = consume(players, incidentEditorSeat, "first-discoverer-01");
    setIncident(text);
    setPlayers(nextPlayers);
    setCurrentSeat(nextSeat(nextPlayers, incidentEditorSeat));
    setPhase("turn");
    setIncidentEditorSeat(null);
    setMessage("第一発見者を出しました。次のプレイヤーへ進みました。");
  }

  const firstPlayerName = useMemo(() => currentSeat === null ? "" : players[currentSeat]?.name ?? "", [players, currentSeat]);

  const targetPicker = pending?.kind === "target" ? pending : null;
  const infoReady = pending?.kind === "info" ? players.every((p, seat) => p.hand.length === 0 || Boolean(pending.selections[seat])) : false;
  const rumorEligible = pending?.kind === "rumor" ? players.map((_, chooser) => players[(chooser - 1 + players.length) % players.length].hand.length > 0 ? chooser : -1).filter((x) => x >= 0) : [];
  const rumorReady = pending?.kind === "rumor" ? rumorEligible.every((seat) => Boolean(pending.selections[seat])) : false;

  return (
    <main className="page testPage">
      <div className="testShell">
        <div className="testToolbar">
          <div>
            <Link className="topLink" href="/">← トップへ</Link>
            <h1 className="testTitle">PCテストモード</h1>
            <p className="small">1台のPCで最大4名分を操作できます。Ver.0.5では終了公開・犯人カードの軌跡・リプレイも確認できます。</p>
          </div>
          <div className="testControls">
            <label className="label">人数</label>
            <div className="segmented">
              <button className={playerCount === 3 ? "active" : ""} onClick={() => setPlayerCount(3)}>3人</button>
              <button className={playerCount === 4 ? "active" : ""} onClick={() => setPlayerCount(4)}>4人</button>
            </div>
            <button className="button compact" onClick={deal}>{players.length ? "カードを配り直す" : "テスト開始"}</button>
          </div>
        </div>

        {incident && <div className="incidentBanner">🚨 今回の事件：<strong>{incident}</strong></div>}
        {message && <div className="turnBanner">{message}</div>}
        {result && <div className="resultBanner">{result}</div>}
        {phase === "finished" && players.length > 0 && <section className="finalSummary testFinalSummary">
          <div className="finalSummaryHeader"><div><div className="small">PCテスト・終了公開</div><h2>🎬 エンディング</h2></div><button className="button compact replayInline" onClick={deal}>🔁 もう一度遊ぶ</button></div>
          <div className="summaryPlayers">{players.map((p, seat) => <div className="summaryPlayer" key={seat}><div className="summaryPlayerTitle"><strong>{p.name}</strong>{p.accomplice && <span className="accompliceTag">😈 犯人側</span>}</div>{p.hand.length ? <div className="summaryHand">{p.hand.map((id) => <DigitalCard key={id} card={CARD_BY_ID.get(id)!} compact />)}</div> : <div className="small">残り手札なし</div>}</div>)}</div>
          <div className="culpritTrail"><h3>🕵️ 犯人カードの軌跡</h3><div className="trailList">{culpritTrail.map((e, i) => <div className="trailStep" key={`${i}-${e.toSeat}`}><span className="trailNumber">{i + 1}</span><div>{e.fromSeat === null ? <span>配札 → </span> : <><strong>{players[e.fromSeat]?.name}</strong> → </>}<strong>{players[e.toSeat]?.name}</strong><div className="small">{e.action}</div></div></div>)}</div></div>
        </section>}
        {players.length > 0 && phase === "awaiting_incident" && <div className="turnBanner">第一発見者：{firstPlayerName}</div>}

        {incidentEditorSeat !== null && (
          <div className="testIncidentEditor">
            <h2>🚨 事件を発表</h2>
            <input className="input" value={incidentDraft} onChange={(e) => setIncidentDraft(e.target.value)} placeholder="例：冷蔵庫のプリンがなくなった！" autoFocus />
            <div className="inlineButtons"><button className="button" onClick={announceIncident}>この事件で始める</button><button className="button secondary" onClick={() => setIncidentEditorSeat(null)}>キャンセル</button></div>
          </div>
        )}

        {targetPicker && (
          <div className="actionPanel">
            <h2>相手を選ぶ</h2>
            <div className="targetButtons">{players.map((p, seat) => seat !== targetPicker.actorSeat && <button key={seat} className="button secondary" onClick={() => chooseTarget(seat)}>{p.name}（手札 {p.hand.length}枚）</button>)}</div>
            <button className="miniButton" onClick={() => { setPending(null); setPhase("turn"); }}>キャンセル</button>
          </div>
        )}

        {pending?.kind === "dog-slot" && (
          <div className="actionPanel">
            <h2>🐶 {players[pending.targetSeat].name}のどのカード？</h2>
            <div className="backChoices">{players[pending.targetSeat].hand.map((_, i) => <button key={i} onClick={() => chooseDogSlot(i)}><DigitalCardBack compact /><span>{i + 1}</span></button>)}</div>
          </div>
        )}

        {pending?.kind === "trade" && (
          <div className="actionPanel">
            <h2>🔄 取り引き</h2>
            {[pending.actorSeat, pending.targetSeat].map((seat) => <div className="selectionRow" key={seat}><strong>{players[seat].name}が渡すカード</strong><div className="choiceCards">{players[seat].hand.map((id) => <button key={id} className={(seat === pending.actorSeat ? pending.actorChoice : pending.targetChoice) === id ? "selectedChoice" : ""} onClick={() => chooseTradeCard(seat, id)}><DigitalCard card={CARD_BY_ID.get(id)!} compact /></button>)}</div></div>)}
            <button className="button" disabled={!pending.actorChoice || !pending.targetChoice} onClick={applyTrade}>交換する</button>
          </div>
        )}

        {pending?.kind === "info" && (
          <div className="actionPanel">
            <h2>📡 情報操作</h2><p className="small">各プレイヤーが左隣へ渡すカードを選びます。</p>
            {players.map((p, seat) => p.hand.length > 0 && <div className="selectionRow" key={seat}><strong>{p.name} → {players[(seat + 1) % players.length].name}</strong><div className="choiceCards">{p.hand.map((id) => <button key={id} className={pending.selections[seat] === id ? "selectedChoice" : ""} onClick={() => chooseInfoCard(seat, id)}><DigitalCard card={CARD_BY_ID.get(id)!} compact /></button>)}</div></div>)}
            <button className="button" disabled={!infoReady} onClick={applyInfo}>一斉に渡す</button>
          </div>
        )}

        {pending?.kind === "rumor" && (
          <div className="actionPanel">
            <h2>📢 うわさ</h2><p className="small">各プレイヤーが右隣の人の裏向き手札から1枚選びます。</p>
            {rumorEligible.map((chooser) => { const right = (chooser - 1 + players.length) % players.length; return <div className="selectionRow" key={chooser}><strong>{players[chooser].name} ← {players[right].name}</strong><div className="backChoices">{players[right].hand.map((id, i) => <button key={`${chooser}-${i}`} className={pending.selections[chooser] === id ? "selectedChoice" : ""} onClick={() => chooseRumorCard(chooser, id)}><DigitalCardBack compact /><span>{i + 1}</span></button>)}</div></div>; })}
            <button className="button" disabled={!rumorReady} onClick={applyRumor}>一斉に取る</button>
          </div>
        )}

        {players.length === 0 ? (
          <div className="panel testEmpty">上の「テスト開始」を押すと、3〜4人分の手札を一度に確認できます。</div>
        ) : (
          <div className={`testPlayers count${playerCount}`}>
            {players.map((player, seat) => {
              const isCurrent = seat === currentSeat;
              return (
                <section className={`testDevice ${isCurrent ? "current" : ""}`} key={seat}>
                  <div className="testDeviceHeader"><div><div className="small">端末 {seat + 1}{player.accomplice ? " ・😈犯人側" : ""}</div><input className="testNameInput" value={player.name} onChange={(e) => setPlayers((prev) => prev.map((p, idx) => idx === seat ? { ...p, name: e.target.value } : p))} /></div><button className="miniButton" onClick={() => setPlayers((prev) => prev.map((p, idx) => idx === seat ? { ...p, hidden: !p.hidden } : p))}>{player.hidden ? "手札を見る" : "手札を隠す"}</button></div>
                  {isCurrent && <div className="currentLabel">▶ 現在の手番</div>}
                  <div className="testHand">
                    {player.hand.map((cardId) => {
                      const def = CARD_BY_ID.get(cardId); if (!def) return null;
                      const specialBlocked = (def.type === "detective" && player.playedCount < 1) || (def.type === "culprit" && player.hand.length !== 1);
                      const canTap = !pending && ((phase === "awaiting_incident" && isCurrent && cardId === "first-discoverer-01") || (phase === "turn" && isCurrent && !specialBlocked));
                      return <button className={`testCard digitalTestCard ${canTap ? "playable" : ""}`} key={cardId} onClick={() => tapCard(seat, cardId)} disabled={!canTap}><DigitalCard card={def} compact />{isCurrent && def.type === "detective" && player.playedCount < 1 && <span className="cardLock">2周目から</span>}{isCurrent && def.type === "culprit" && player.hand.length !== 1 && <span className="cardLock">最後の1枚で</span>}</button>;
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {reveal && <div className="modalBackdrop" role="dialog" aria-modal="true"><div className="modalCard"><h2>{reveal.title}</h2><p>{reveal.message}</p>{reveal.cards && <div className="revealCards">{reveal.cards.map((id) => <DigitalCard key={id} card={CARD_BY_ID.get(id)!} compact />)}</div>}<button className="button" onClick={() => setReveal(null)}>確認した</button></div></div>}
    </main>
  );
}
