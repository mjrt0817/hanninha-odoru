"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CARD_BY_ID } from "@/lib/cards";
import { dealMvpHands } from "@/lib/deck";
import { DigitalCard, DigitalCardBack } from "@/components/cards/DigitalCard";

type TestPlayer = {
  name: string;
  hand: string[];
  hidden: boolean;
};

const DEFAULT_NAMES = ["プレイヤー1", "プレイヤー2", "プレイヤー3", "プレイヤー4"];

export default function TestPage() {
  const [playerCount, setPlayerCount] = useState<3 | 4>(4);
  const [players, setPlayers] = useState<TestPlayer[]>([]);
  const [phase, setPhase] = useState<"idle" | "awaiting_incident" | "turn">("idle");
  const [currentSeat, setCurrentSeat] = useState<number | null>(null);
  const [incident, setIncident] = useState("");
  const [incidentDraft, setIncidentDraft] = useState("");
  const [incidentEditorSeat, setIncidentEditorSeat] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  function deal() {
    const hands = dealMvpHands(playerCount);
    const nextPlayers = hands.map((hand, index) => ({ name: DEFAULT_NAMES[index], hand, hidden: false }));
    const firstSeat = nextPlayers.findIndex((p) => p.hand.includes("first-discoverer-01"));
    setPlayers(nextPlayers);
    setCurrentSeat(firstSeat);
    setPhase("awaiting_incident");
    setIncident("");
    setIncidentDraft("");
    setIncidentEditorSeat(null);
    setMessage("第一発見者のカードをタップして事件を発表してください。");
  }

  function tapCard(seat: number, cardId: string) {
    if (phase === "awaiting_incident" && seat === currentSeat && cardId === "first-discoverer-01") {
      setIncidentEditorSeat(seat);
      setMessage("");
      return;
    }
    if (phase === "turn" && seat === currentSeat) {
      setMessage(`${CARD_BY_ID.get(cardId)?.name ?? "カード"}の効果処理は次の実装対象です。クリック判定は正常です。`);
      return;
    }
    setMessage("今はこのカードを使う番ではありません。");
  }

  function announceIncident() {
    if (incidentEditorSeat === null) return;
    const text = incidentDraft.trim() || "大切なおやつがなくなった！";
    setIncident(text);
    setPlayers((prev) => prev.map((p, idx) => idx === incidentEditorSeat ? { ...p, hand: p.hand.filter((id) => id !== "first-discoverer-01") } : p));
    setCurrentSeat((incidentEditorSeat + 1) % playerCount);
    setPhase("turn");
    setIncidentEditorSeat(null);
    setMessage("第一発見者を出しました。次のプレイヤーへ進みました。");
  }

  const firstPlayerName = useMemo(() => currentSeat === null ? "" : players[currentSeat]?.name ?? "", [players, currentSeat]);

  return (
    <main className="page testPage">
      <div className="testShell">
        <div className="testToolbar">
          <div>
            <Link className="topLink" href="/">← トップへ</Link>
            <h1 className="testTitle">PCテストモード</h1>
            <p className="small">1台のPCで最大4名分の画面を同時確認します。Supabaseは使用しません。</p>
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
        {players.length > 0 && phase === "awaiting_incident" && <div className="turnBanner">第一発見者：{firstPlayerName}</div>}

        {incidentEditorSeat !== null && (
          <div className="testIncidentEditor">
            <h2>🚨 事件を発表</h2>
            <p className="small">第一発見者として家族に伝える事件を書きます。</p>
            <input className="input" value={incidentDraft} onChange={(e) => setIncidentDraft(e.target.value)} placeholder="例：冷蔵庫のプリンがなくなった！" autoFocus />
            <div className="inlineButtons">
              <button className="button" onClick={announceIncident}>この事件で始める</button>
              <button className="button secondary" onClick={() => setIncidentEditorSeat(null)}>キャンセル</button>
            </div>
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
                  <div className="testDeviceHeader">
                    <div>
                      <div className="small">端末 {seat + 1}</div>
                      <input
                        className="testNameInput"
                        value={player.name}
                        onChange={(e) => setPlayers((prev) => prev.map((p, idx) => idx === seat ? { ...p, name: e.target.value } : p))}
                      />
                    </div>
                    <button className="miniButton" onClick={() => setPlayers((prev) => prev.map((p, idx) => idx === seat ? { ...p, hidden: !p.hidden } : p))}>{player.hidden ? "手札を見る" : "手札を隠す"}</button>
                  </div>
                  {isCurrent && <div className="currentLabel">▶ 現在の手番</div>}
                  <div className="testHand">
                    {player.hand.map((cardId) => {
                      const def = CARD_BY_ID.get(cardId);
                      if (!def) return null;
                      const canTap = (phase === "awaiting_incident" && isCurrent && cardId === "first-discoverer-01") || (phase === "turn" && isCurrent);
                      return (
                        <button className={`testCard digitalTestCard ${canTap ? "playable" : ""}`} key={cardId} onClick={() => tapCard(seat, cardId)}>
                          {player.hidden ? <DigitalCardBack compact /> : <DigitalCard card={def} compact />}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
