"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { ensureAnonymousSession } from "@/lib/auth";
import { CARD_BY_ID } from "@/lib/cards";
import { DigitalCard } from "@/components/cards/DigitalCard";
import { supabase } from "@/lib/supabase";

type Room = { id: string; code: string; host_user_id: string; status: "waiting" | "playing" | "finished"; game_id: string | null };
type Player = { id: string; room_id: string; user_id: string; display_name: string; seat: number };
type Game = {
  id: string;
  room_id: string;
  current_turn_player_id: string | null;
  round_no: number;
  status: string;
  phase?: "awaiting_incident" | "turn" | "finished";
  incident_text?: string | null;
};
type HandRow = { id: string; game_id: string; player_id: string; card_id: string; sort_order: number };

export function RoomClient({ code }: { code: string }) {
  const [uid, setUid] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [game, setGame] = useState<Game | null>(null);
  const [hand, setHand] = useState<HandRow[]>([]);
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentDraft, setIncidentDraft] = useState("");

  const load = useCallback(async () => {
    const session = await ensureAnonymousSession();
    setUid(session.user.id);
    const { data: roomData, error: roomError } = await supabase.from("rooms").select("*").eq("code", code).maybeSingle();
    if (roomError) throw roomError;
    if (!roomData) throw new Error("このルームに参加していないか、部屋が見つかりません。");
    setRoom(roomData);
    const { data: playerData, error: playerError } = await supabase.from("players").select("*").eq("room_id", roomData.id).order("seat");
    if (playerError) throw playerError;
    setPlayers(playerData || []);
    if (roomData.game_id) {
      const { data: gameData, error: gameError } = await supabase.from("games").select("*").eq("id", roomData.game_id).maybeSingle();
      if (gameError) throw gameError;
      setGame(gameData || null);
      const { data: handData, error: handError } = await supabase.from("hands").select("*").eq("game_id", roomData.game_id).order("sort_order");
      if (handError) throw handError;
      setHand(handData || []);
    } else {
      setGame(null);
      setHand([]);
    }
  }, [code]);

  useEffect(() => {
    setOrigin(window.location.origin);
    load().catch((e) => setError(e.message));
  }, [load]);

  useEffect(() => {
    if (!room?.id) return;
    const channel = supabase.channel(`room-ui:${room.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${room.id}` }, () => load().catch(() => {}))
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${room.id}` }, () => load().catch(() => {}))
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `room_id=eq.${room.id}` }, () => load().catch(() => {}))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [room?.id, load]);

  async function startGame() {
    if (!room) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("start_game", { p_room_id: room.id });
      if (error) throw error;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "開始できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function playFirstDiscoverer() {
    if (!game) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("play_first_discoverer", {
        p_game_id: game.id,
        p_incident_text: incidentDraft.trim() || "大切なおやつがなくなった！",
      });
      if (error) throw error;
      setIncidentOpen(false);
      setIncidentDraft("");
      await load();
    } catch (e) {
      const message = e instanceof Error
        ? e.message
        : (typeof e === "object" && e && "message" in e ? String((e as { message?: unknown }).message) : "第一発見者を出せませんでした。");
      if (message.includes("function") || message.includes("play_first_discoverer")) {
        setError("SupabaseにVer.0.2用SQLがまだ反映されていません。supabase/upgrade_v0_2.sql を実行してください。");
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  const me = players.find((p) => p.user_id === uid);
  const current = players.find((p) => p.id === game?.current_turn_player_id);
  const isHost = room?.host_user_id === uid;
  const isMyTurn = current?.id === me?.id;
  const cards = useMemo(() => hand.map((h) => ({ row: h, def: CARD_BY_ID.get(h.card_id) })).filter((x) => x.def), [hand]);
  const awaitingIncident = (game?.phase ?? "awaiting_incident") === "awaiting_incident";

  function onCardClick(cardId: string) {
    if (!isMyTurn) return;
    if (awaitingIncident && cardId === "first-discoverer-01") {
      setIncidentOpen(true);
      return;
    }
    if (!awaitingIncident) {
      setError("このカードの効果処理は次の実装で追加します。第一発見者の処理は操作できます。");
    }
  }

  return <main className="page"><div className="shell">
    <Link className="topLink" href="/">← トップへ</Link>
    <div className="panel stack">
      <div className="roomHeader"><div><div className="small">ルーム番号</div><div className="roomCode">{code}</div></div><div className="statusPill">{room?.status === "playing" ? "ゲーム中" : "待機中"}</div></div>
      {error && <div className="message">{error}</div>}
      {room?.status === "waiting" && <>
        <div className="grid2"><div><h2 className="sectionTitle">参加メンバー</h2><div className="players">{players.map((p)=><div className="player" key={p.id}><div className="avatar">{p.display_name.slice(0,1)}</div><div className="playerName">{p.display_name}</div>{p.user_id===room.host_user_id && <div className="host">HOST</div>}</div>)}</div><div className="small">{players.length}/8人（ゲーム開始は3人から）</div></div>
        <div><h2 className="sectionTitle">QRで参加</h2>{origin && <div className="qrWrap"><QRCodeSVG value={`${origin}/join/${code}`} size={190} /></div>}<div className="small">家族の端末で読み取るだけ。インストール不要です。</div></div></div>
        {isHost ? <button className="button" disabled={busy || players.length < 3} onClick={startGame}>{busy ? "カードを配っています…" : "ゲーム開始！"}</button> : <div className="turnBanner">ホストがゲームを開始するのを待っています…</div>}
      </>}

      {room?.status === "playing" && <>
        {game?.incident_text && <div className="incidentBanner">🚨 今回の事件：<strong>{game.incident_text}</strong></div>}
        <div className="turnBanner">
          {awaitingIncident
            ? (isMyTurn ? "🎉 あなたが第一発見者です。第一発見者カードをタップしてください！" : `第一発見者：${current?.display_name || "確認中…"}`)
            : (isMyTurn ? "👉 あなたの番です！" : `現在の手番：${current?.display_name || "確認中…"}`)}
        </div>
        <div><h2 className="sectionTitle">あなたの手札</h2><div className="cards">{cards.map(({row,def}) => {
          if (!def) return null;
          const playable = isMyTurn && ((awaitingIncident && def.id === "first-discoverer-01") || !awaitingIncident);
          return <button className={`card cardButton digitalCardButton ${playable ? "playable" : ""}`} key={row.id} onClick={() => onCardClick(def.id)} disabled={!playable}>
            <DigitalCard card={def} />
            {playable && awaitingIncident && <div className="tapHint overlayHint">タップして事件を発表</div>}
          </button>;
        })}</div></div>
        <div className="hint">Ver.0.3ではカードをデジタル描画へ切り替えています。第一発見者を使用すると、事件発表後に次のプレイヤーへ手番が進みます。他カードの効果は順次追加します。</div>
      </>}
    </div>

    {incidentOpen && <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="modalCard">
        <h2>🚨 第一発見者</h2>
        <p>今回起こった事件を入力してください。</p>
        <input className="input" value={incidentDraft} onChange={(e) => setIncidentDraft(e.target.value)} placeholder="例：冷蔵庫のプリンがなくなった！" autoFocus />
        <div className="inlineButtons">
          <button className="button" onClick={playFirstDiscoverer} disabled={busy}>{busy ? "発表中…" : "この事件で始める"}</button>
          <button className="button secondary" onClick={() => setIncidentOpen(false)} disabled={busy}>キャンセル</button>
        </div>
      </div>
    </div>}
  </div></main>;
}
