"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { ensureAnonymousSession } from "@/lib/auth";
import { CARD_BY_ID, type CardDef } from "@/lib/cards";
import { DigitalCard, DigitalCardBack } from "@/components/cards/DigitalCard";
import { supabase } from "@/lib/supabase";
import { playSfx, setAmbient, unlockAudio } from "@/lib/audio";

type Room = { id: string; code: string; host_user_id: string; status: "waiting" | "playing" | "finished"; game_id: string | null };
type Player = { id: string; room_id: string; user_id: string; display_name: string; seat: number };
type Game = {
  id: string; room_id: string; current_turn_player_id: string | null; round_no: number; status: "playing" | "finished";
  phase?: "awaiting_incident" | "turn" | "action" | "finished"; incident_text?: string | null; last_public_message?: string | null; result_text?: string | null;
};
type HandRow = { id: string; game_id: string; player_id: string; card_id: string; sort_order: number };
type PlayedRow = { id: string; game_id: string; player_id: string; card_id: string };
type GameAction = { id: string; game_id: string; action_type: "trade" | "info" | "rumor"; actor_player_id: string; target_player_id: string | null; status: "active" | "completed"; updated_at?: string };
type ActionSelection = { id: string; action_id: string; player_id: string; hand_id: string };
type ActionProgress = { player_id: string; required: boolean; selected: boolean };
type TargetRequest = { cardId: string; effect: "witness" | "detective" | "dog" | "trade" } | null;
type PrivateReveal = { title: string; message: string; cards?: string[] } | null;
type SummaryPlayer = { player_id: string; display_name: string; seat: number; accomplice: boolean; hand: string[] };
type CulpritTrail = { event_id: string; from_player_id: string | null; from_name: string | null; to_player_id: string | null; to_name: string | null; action_type: string | null; detail: string | null; created_at: string };
type GameSummary = { result_text?: string | null; incident_text?: string | null; players: SummaryPlayer[]; culprit_trail: CulpritTrail[] };

function safeMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String((error as { message?: unknown }).message);
  return "処理できませんでした。";
}

function actionLabel(action: string | null) {
  if (action === "trade") return "取り引き";
  if (action === "info") return "情報操作";
  if (action === "rumor") return "うわさ";
  if (action === "deal") return "配札";
  if (action === "snapshot") return "記録開始";
  return "カード移動";
}

export function RoomClient({ code }: { code: string }) {
  const [uid, setUid] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [game, setGame] = useState<Game | null>(null);
  const [hand, setHand] = useState<HandRow[]>([]);
  const [played, setPlayed] = useState<PlayedRow[]>([]);
  const [activeAction, setActiveAction] = useState<GameAction | null>(null);
  const [mySelection, setMySelection] = useState<ActionSelection | null>(null);
  const [actionProgress, setActionProgress] = useState<ActionProgress[]>([]);
  const [handCounts, setHandCounts] = useState<Record<string, number>>({});
  const [finalSummary, setFinalSummary] = useState<GameSummary | null>(null);
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentDraft, setIncidentDraft] = useState("");
  const [targetRequest, setTargetRequest] = useState<TargetRequest>(null);
  const [dogTarget, setDogTarget] = useState<Player | null>(null);
  const [privateReveal, setPrivateReveal] = useState<PrivateReveal>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [bgmEnabled, setBgmEnabled] = useState(false);
  const [culpritNotice, setCulpritNotice] = useState(false);
  const rpcLock = useRef(false);
  const prevTurnRef = useRef<string | null | undefined>(undefined);
  const prevRoomStatusRef = useRef<Room["status"] | undefined>(undefined);
  const prevMessageRef = useRef<string | null | undefined>(undefined);
  const prevCulpritRef = useRef<boolean | undefined>(undefined);

  const load = useCallback(async () => {
    const session = await ensureAnonymousSession();
    setUid(session.user.id);
    const { data: roomData, error: roomError } = await supabase.from("rooms").select("*").eq("code", code).maybeSingle();
    if (roomError) throw roomError;
    if (!roomData) throw new Error("このルームに参加していないか、部屋が見つかりません。");
    setRoom(roomData);
    if (typeof window !== "undefined") localStorage.setItem("hannin:lastRoomCode", code);

    const { data: playerData, error: playerError } = await supabase.from("players").select("*").eq("room_id", roomData.id).order("seat");
    if (playerError) throw playerError;
    setPlayers(playerData || []);

    if (!roomData.game_id) {
      setGame(null); setHand([]); setPlayed([]); setActiveAction(null); setMySelection(null); setActionProgress([]); setHandCounts({}); setFinalSummary(null); return;
    }

    const [{ data: gameData, error: gameError }, { data: handData, error: handError }, { data: playedData }] = await Promise.all([
      supabase.from("games").select("*").eq("id", roomData.game_id).maybeSingle(),
      supabase.from("hands").select("*").eq("game_id", roomData.game_id).order("sort_order"),
      supabase.from("played_cards").select("id,game_id,player_id,card_id").eq("game_id", roomData.game_id),
    ]);
    if (gameError) throw gameError;
    if (handError) throw handError;
    setGame(gameData || null);
    setHand(handData || []);
    setPlayed(playedData || []);

    const { data: actionData } = await supabase.from("game_actions").select("*").eq("game_id", roomData.game_id).eq("status", "active").maybeSingle();
    setActiveAction(actionData || null);
    if (actionData) {
      const [{ data: selectionData }, progressRes] = await Promise.all([
        supabase.from("action_selections").select("*").eq("action_id", actionData.id).maybeSingle(),
        supabase.rpc("get_action_progress", { p_action_id: actionData.id }),
      ]);
      setMySelection(selectionData || null);
      setActionProgress(Array.isArray(progressRes.data) ? progressRes.data as ActionProgress[] : []);
    } else {
      setMySelection(null);
      setActionProgress([]);
    }

    const { data: countData } = await supabase.rpc("get_hand_counts", { p_game_id: roomData.game_id });
    if (Array.isArray(countData)) {
      setHandCounts(Object.fromEntries(countData.map((x: { player_id: string; hand_count: number | string }) => [x.player_id, Number(x.hand_count)])));
    }

    if (gameData?.status === "finished" || roomData.status === "finished") {
      const { data: summaryData } = await supabase.rpc("get_game_summary", { p_game_id: roomData.game_id });
      setFinalSummary(summaryData && typeof summaryData === "object" ? summaryData as GameSummary : null);
    } else setFinalSummary(null);
  }, [code]);

  useEffect(() => {
    setOrigin(window.location.origin);
    setOnline(navigator.onLine);
    setSoundEnabled(localStorage.getItem("hannin:sound") === "on");
    setBgmEnabled(localStorage.getItem("hannin:bgm") === "on");
    load().catch((e) => setError(safeMessage(e)));
  }, [load]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); load().catch(() => {}); };
    const onOffline = () => setOnline(false);
    const onVisibility = () => { if (document.visibilityState === "visible") load().catch(() => {}); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
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

  useEffect(() => {
    if (!game?.id) return;
    const channel = supabase.channel(`game-ui:${game.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "hands", filter: `game_id=eq.${game.id}` }, () => load().catch(() => {}))
      .on("postgres_changes", { event: "*", schema: "public", table: "played_cards", filter: `game_id=eq.${game.id}` }, () => load().catch(() => {}))
      .on("postgres_changes", { event: "*", schema: "public", table: "game_actions", filter: `game_id=eq.${game.id}` }, () => load().catch(() => {}))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [game?.id, load]);

  async function runRpc<T = unknown>(name: string, args: Record<string, unknown>) {
    if (rpcLock.current) return null;
    rpcLock.current = true;
    setBusy(true); setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc(name, args);
      if (rpcError) throw rpcError;
      await load();
      return data as T;
    } catch (e) {
      const msg = safeMessage(e);
      if (msg.includes("get_game_summary") || msg.includes("get_action_progress") || msg.includes("reset_room") || msg.includes("game_events")) {
        setError("SupabaseにVer.0.5用SQLがまだ反映されていません。supabase/upgrade_v0_5.sql を実行してください。");
      } else if (msg.includes("function") || msg.includes("game_actions") || msg.includes("get_hand_counts")) {
        setError("Supabaseの更新SQLが不足しています。Ver.0.4 → Ver.0.5 の順に適用してください。");
      } else setError(msg);
      return null;
    } finally {
      setBusy(false);
      rpcLock.current = false;
    }
  }

  async function startGame() { if (room) await runRpc("start_game", { p_room_id: room.id }); }
  async function resetRoom(force = false) {
    if (!room || !isHost) return;
    if (room.status === "playing" && !force && !window.confirm("進行中のゲームをリセットして待機室へ戻しますか？")) return;
    await runRpc("reset_room", { p_room_id: room.id });
  }
  async function toggleSound() {
    if (soundEnabled) {
      setSoundEnabled(false);
      setBgmEnabled(false);
      localStorage.setItem("hannin:sound", "off");
      localStorage.setItem("hannin:bgm", "off");
      setAmbient(false);
      return;
    }
    const ok = await unlockAudio();
    if (ok) {
      setSoundEnabled(true);
      localStorage.setItem("hannin:sound", "on");
      playSfx("start");
    }
  }

  async function toggleBgm() {
    if (!soundEnabled) {
      const ok = await unlockAudio();
      if (!ok) return;
      setSoundEnabled(true);
      localStorage.setItem("hannin:sound", "on");
    }
    const next = !bgmEnabled;
    setBgmEnabled(next);
    localStorage.setItem("hannin:bgm", next ? "on" : "off");
  }

  async function playFirstDiscoverer() {
    if (!game) return;
    const result = await runRpc("play_first_discoverer", { p_game_id: game.id, p_incident_text: incidentDraft.trim() || "大切なおやつがなくなった！" });
    if (result !== null) { setIncidentOpen(false); setIncidentDraft(""); }
  }

  const me = players.find((p) => p.user_id === uid);
  const current = players.find((p) => p.id === game?.current_turn_player_id);
  const isHost = room?.host_user_id === uid;
  const isMyTurn = current?.id === me?.id;
  const cards = useMemo(() => hand.map((h) => ({ row: h, def: CARD_BY_ID.get(h.card_id) })).filter((x): x is { row: HandRow; def: CardDef } => Boolean(x.def)), [hand]);
  const awaitingIncident = (game?.phase ?? "awaiting_incident") === "awaiting_incident";
  const actionPhase = game?.phase === "action";
  const myPlayedCount = me ? played.filter((p) => p.player_id === me.id).length : 0;
  const selectedAction = activeAction && mySelection?.action_id === activeAction.id ? mySelection : null;

  const sortedPlayers = useMemo(() => [...players].sort((a, b) => a.seat - b.seat), [players]);
  function neighborOf(playerId: string, direction: "left" | "right") {
    const idx = sortedPlayers.findIndex((p) => p.id === playerId);
    if (idx < 0 || !sortedPlayers.length) return null;
    const next = direction === "left" ? (idx + 1) % sortedPlayers.length : (idx - 1 + sortedPlayers.length) % sortedPlayers.length;
    return sortedPlayers[next];
  }

  function normalPlayable(def: CardDef) {
    if (!isMyTurn || game?.phase !== "turn") return false;
    if (def.type === "detective" && myPlayedCount < 1) return false;
    if (def.type === "culprit" && hand.length !== 1) return false;
    return true;
  }

  async function onCardClick(cardId: string) {
    if (!game || !me || busy || rpcLock.current) return;
    const def = CARD_BY_ID.get(cardId); if (!def) return;
    if (awaitingIncident && isMyTurn && def.type === "first-discoverer") { setIncidentOpen(true); return; }
    if (!normalPlayable(def)) return;
    if (soundEnabled) playSfx("card");

    if (def.type === "civilian" || def.type === "alibi" || def.type === "scheme") {
      await runRpc("play_simple_card", { p_game_id: game.id, p_card_id: cardId }); return;
    }
    if (def.type === "boy") {
      const data = await runRpc<{ secret?: string }>("play_boy", { p_game_id: game.id, p_card_id: cardId });
      if (data?.secret) { setPrivateReveal({ title: "🤫 少年が見たもの", message: data.secret }); if (soundEnabled) playSfx("secret"); }
      return;
    }
    if (def.type === "culprit") { await runRpc("play_culprit", { p_game_id: game.id, p_card_id: cardId }); return; }
    if (def.type === "info") { await runRpc("start_info", { p_game_id: game.id, p_card_id: cardId }); return; }
    if (def.type === "rumor") { await runRpc("start_rumor", { p_game_id: game.id, p_card_id: cardId }); return; }
    if (["witness", "detective", "dog", "trade"].includes(def.type)) {
      setTargetRequest({ cardId, effect: def.type as "witness" | "detective" | "dog" | "trade" });
    }
  }

  async function chooseTarget(target: Player) {
    if (!targetRequest || !game || busy) return;
    const req = targetRequest;
    setTargetRequest(null);
    if (req.effect === "dog") { setDogTarget(target); return; }
    if (req.effect === "witness") {
      const data = await runRpc<{ target_name?: string; cards?: string[] }>("play_witness", { p_game_id: game.id, p_card_id: req.cardId, p_target_player_id: target.id });
      if (data) { setPrivateReveal({ title: "👁️ 目撃者だけの情報", message: `${data.target_name ?? target.display_name}の手札`, cards: data.cards ?? [] }); if (soundEnabled) playSfx("secret"); }
      return;
    }
    if (req.effect === "detective") { await runRpc("play_detective", { p_game_id: game.id, p_card_id: req.cardId, p_target_player_id: target.id }); return; }
    await runRpc("start_trade", { p_game_id: game.id, p_card_id: req.cardId, p_target_player_id: target.id });
  }

  async function chooseDogSlot(slot: number) {
    if (!game || !dogTarget || busy) return;
    const dog = cards.find((c) => c.def.type === "dog");
    if (!dog) return;
    await runRpc("play_dog", { p_game_id: game.id, p_card_id: dog.def.id, p_target_player_id: dogTarget.id, p_slot: slot });
    setDogTarget(null);
  }

  async function submitActionHand(handId: string) {
    if (!activeAction || busy) return;
    if (activeAction.action_type === "trade") await runRpc("submit_trade", { p_action_id: activeAction.id, p_hand_id: handId });
    else if (activeAction.action_type === "info") await runRpc("submit_info", { p_action_id: activeAction.id, p_hand_id: handId });
  }
  async function submitRumor(slot: number) { if (activeAction && !busy) await runRpc("submit_rumor", { p_action_id: activeAction.id, p_slot: slot }); }

  const actionNeedsMe = (() => {
    if (!activeAction || !me || selectedAction) return false;
    if (activeAction.action_type === "trade") return me.id === activeAction.actor_player_id || me.id === activeAction.target_player_id;
    if (activeAction.action_type === "info") return (handCounts[me.id] ?? hand.length) > 0;
    const right = neighborOf(me.id, "right");
    return Boolean(right && (handCounts[right.id] ?? 0) > 0);
  })();

  const actionNeighbor = me && activeAction?.action_type === "info" ? neighborOf(me.id, "left") : me && activeAction?.action_type === "rumor" ? neighborOf(me.id, "right") : null;
  const tradeOther = activeAction?.action_type === "trade" && me ? players.find((p) => p.id === (me.id === activeAction.actor_player_id ? activeAction.target_player_id : activeAction.actor_player_id)) : null;
  const requiredProgress = actionProgress.filter((p) => p.required);
  const waitingProgress = requiredProgress.filter((p) => !p.selected);
  const waitingNames = waitingProgress.map((state) => players.find((p) => p.id === state.player_id)?.display_name).filter(Boolean) as string[];
  const hasCulprit = hand.some((h) => CARD_BY_ID.get(h.card_id)?.type === "culprit");

  useEffect(() => {
    if (!soundEnabled || !isHost || room?.status !== "playing" || !bgmEnabled) { setAmbient(false); return; }
    unlockAudio().then(() => setAmbient(true)).catch(() => {});
    return () => setAmbient(false);
  }, [soundEnabled, bgmEnabled, isHost, room?.status]);

  useEffect(() => {
    const previous = prevRoomStatusRef.current;
    if (previous !== undefined && room?.status && previous !== room.status && soundEnabled && isHost) {
      if (room.status === "playing") playSfx("start");
      if (room.status === "finished") playSfx("finish");
    }
    prevRoomStatusRef.current = room?.status;
  }, [room?.status, soundEnabled, isHost]);

  useEffect(() => {
    const previous = prevTurnRef.current;
    if (previous !== undefined && game?.current_turn_player_id && previous !== game.current_turn_player_id && game.current_turn_player_id === me?.id && soundEnabled) {
      playSfx("turn");
      if (navigator.vibrate) navigator.vibrate(60);
    }
    prevTurnRef.current = game?.current_turn_player_id;
  }, [game?.current_turn_player_id, me?.id, soundEnabled]);

  useEffect(() => {
    const previous = prevMessageRef.current;
    const message = game?.last_public_message ?? null;
    if (previous !== undefined && message && previous !== message && soundEnabled && isHost && room?.status === "playing") {
      if (message.includes("取り引き") || message.includes("情報操作") || message.includes("うわさ")) playSfx("transfer");
      else if (message.includes("探偵")) playSfx("detective");
      else if (message.includes("いぬ")) playSfx("dog");
    }
    prevMessageRef.current = message;
  }, [game?.last_public_message, soundEnabled, isHost, room?.status]);

  useEffect(() => {
    const previous = prevCulpritRef.current;
    if (previous !== undefined && !previous && hasCulprit && room?.status === "playing") {
      setCulpritNotice(true);
      if (soundEnabled) playSfx("culprit");
      if (navigator.vibrate) navigator.vibrate([80, 70, 140]);
      const timer = window.setTimeout(() => setCulpritNotice(false), 1600);
      prevCulpritRef.current = hasCulprit;
      return () => window.clearTimeout(timer);
    }
    prevCulpritRef.current = hasCulprit;
  }, [hasCulprit, room?.status, soundEnabled]);

  return <main className="page"><div className="shell">
    <Link className="topLink" href="/">← トップへ</Link>
    <div className="panel stack">
      <div className="roomHeader"><div><div className="small">ルーム番号</div><div className="roomCode">{code}</div></div><div className="statusPill">{room?.status === "playing" ? "ゲーム中" : room?.status === "finished" ? "終了" : "待機中"}</div></div>
      <div className="soundControls"><button className={`soundToggle ${soundEnabled ? "on" : ""}`} onClick={toggleSound}>{soundEnabled ? "🔊 効果音 ON" : "🔇 効果音 OFF"}</button>{isHost && <button className={`soundToggle ${bgmEnabled ? "on" : ""}`} onClick={toggleBgm} disabled={!soundEnabled && bgmEnabled}>{bgmEnabled ? "🎵 BGM ON" : "🎵 BGM OFF"}</button>}</div>
      {!online && <div className="offlineBanner">📴 オフラインです。通信が戻ると自動でゲーム状態を再読込します。</div>}
      {error && <div className="message">{error}</div>}

      {room?.status === "waiting" && <>
        <div className="grid2"><div><h2 className="sectionTitle">参加メンバー</h2><div className="players">{players.map((p)=><div className="player" key={p.id}><div className="avatar">{p.display_name.slice(0,1)}</div><div className="playerName">{p.display_name}{p.user_id===uid && <span className="youTag">あなた</span>}</div>{p.user_id===room.host_user_id && <div className="host">HOST</div>}</div>)}</div><div className="small">{players.length}/8人（ゲーム開始は3人から）</div></div>
        <div><h2 className="sectionTitle">QRで参加</h2>{origin && <div className="qrWrap"><QRCodeSVG value={`${origin}/join/${code}`} size={190} /></div>}<div className="small">家族の端末で読み取るだけ。インストール不要です。</div></div></div>
        {isHost ? <button className="button" disabled={busy || players.length < 3} onClick={startGame}>{busy ? "カードを配っています…" : "ゲーム開始！"}</button> : <div className="turnBanner">ホストがゲームを開始するのを待っています…</div>}
      </>}

      {(room?.status === "playing" || room?.status === "finished") && <>
        <div className="playerStatusStrip">{sortedPlayers.map((p) => <div key={p.id} className={`playerStatusChip ${p.id===game?.current_turn_player_id ? "current" : ""} ${p.id===me?.id ? "mine" : ""}`}><span className="statusDot"/><strong>{p.display_name}</strong><span>{handCounts[p.id] ?? (p.id===me?.id ? hand.length : "?")}枚</span></div>)}</div>
        {game?.incident_text && <div className="incidentBanner">🚨 今回の事件：<strong>{game.incident_text}</strong></div>}
        {game?.last_public_message && <div className="publicEvent eventPop" key={game.last_public_message}>{game.last_public_message}</div>}
        {room.status === "finished" && <><div className="resultBanner finishPop">{game?.result_text || "ゲーム終了"}</div><div className="confetti" aria-hidden="true">{Array.from({length:12},(_,i)=><span key={i} style={{"--i":i} as CSSProperties}>★</span>)}</div></>}

        {room.status === "playing" && <div className={`turnBanner ${isMyTurn ? "myTurnBanner" : ""}`}>
          {awaitingIncident ? (isMyTurn ? "🎉 あなたが第一発見者です。第一発見者カードをタップしてください！" : `第一発見者：${current?.display_name || "確認中…"}`)
            : actionPhase ? (waitingNames.length ? `⏳ ${waitingNames.join("・")} の選択を待っています…` : "⏳ カード効果を処理しています…")
            : (isMyTurn ? "👉 あなたの番です！ カードを1枚選んでください。" : `現在の手番：${current?.display_name || "確認中…"}`)}
        </div>}

        {activeAction && room.status === "playing" && <div className="actionPanel liveActionPanel">
          <h2>{activeAction.action_type === "trade" ? "🔄 取り引き" : activeAction.action_type === "info" ? "📡 情報操作" : "📢 うわさ"}</h2>
          {requiredProgress.length > 0 && <div className="actionProgress"><strong>{requiredProgress.filter((p)=>p.selected).length}/{requiredProgress.length}人 選択済み</strong>{waitingNames.length > 0 && <span>待ち：{waitingNames.join("・")}</span>}</div>}
          {selectedAction ? <p>あなたの選択は完了しました。ほかの人を待っています。</p> : actionNeedsMe ? <>
            {activeAction.action_type === "trade" && <p><strong>{tradeOther?.display_name}</strong> と交換するカードを1枚選んでください。</p>}
            {activeAction.action_type === "info" && <p>左隣の <strong>{actionNeighbor?.display_name}</strong> へ渡すカードを1枚選んでください。</p>}
            {activeAction.action_type !== "rumor" ? <div className="liveChoiceCards">{cards.map(({row,def}) => <button key={row.id} onClick={() => submitActionHand(row.id)} disabled={busy}><DigitalCard card={def} compact /></button>)}</div>
              : <><p>右隣の <strong>{actionNeighbor?.display_name}</strong> の手札から1枚選んでください。</p><div className="backChoices">{Array.from({length: actionNeighbor ? handCounts[actionNeighbor.id] ?? 0 : 0},(_,i)=><button key={i} onClick={() => submitRumor(i)} disabled={busy}><DigitalCardBack compact/><span>{i+1}</span></button>)}</div></>}
          </> : <p>あなたの操作はありません。ほかのプレイヤーの選択を待っています。</p>}
        </div>}

        {room.status === "playing" && <div><h2 className="sectionTitle">あなたの手札</h2><div className="cards">{cards.map(({row,def}) => {
          const playable = awaitingIncident ? isMyTurn && def.type === "first-discoverer" : normalPlayable(def);
          const locked = isMyTurn && game?.phase === "turn" && ((def.type === "detective" && myPlayedCount < 1) || (def.type === "culprit" && hand.length !== 1));
          return <button className={`card cardButton digitalCardButton ${playable ? "playable" : ""}`} key={row.id} onClick={() => onCardClick(def.id)} disabled={!playable || busy}>
            <DigitalCard card={def} />
            {playable && awaitingIncident && <div className="tapHint overlayHint">タップして事件を発表</div>}
            {locked && <div className="cardLock">{def.type === "detective" ? "2周目から" : "最後の1枚で"}</div>}
          </button>;
        })}</div></div>}

        {room.status === "finished" && finalSummary && <section className="finalSummary">
          <div className="finalSummaryHeader"><div><div className="small">ゲーム終了後の公開情報</div><h2>🎬 エンディング</h2></div></div>
          <div className="summaryPlayers">{finalSummary.players.map((p) => <div className="summaryPlayer" key={p.player_id}><div className="summaryPlayerTitle"><strong>{p.display_name}</strong>{p.accomplice && <span className="accompliceTag">😈 犯人側</span>}</div>{p.hand.length ? <div className="summaryHand">{p.hand.map((id) => { const def=CARD_BY_ID.get(id); return def ? <DigitalCard key={id} card={def} compact/> : null; })}</div> : <div className="small">残り手札なし</div>}</div>)}</div>
          <div className="culpritTrail"><h3>🕵️ 犯人カードの軌跡</h3>{finalSummary.culprit_trail.length ? <div className="trailList">{finalSummary.culprit_trail.map((e, i) => <div className="trailStep" key={e.event_id}><span className="trailNumber">{i+1}</span><div>{e.from_name ? <><strong>{e.from_name}</strong> → </> : <span>配札 → </span>}<strong>{e.to_name || "場"}</strong><div className="small">{actionLabel(e.action_type)}</div></div></div>)}</div> : <div className="small">このゲームでは軌跡ログがありません。</div>}</div>
        </section>}

        {room.status === "finished" && isHost && <button className="button replayButton" onClick={() => resetRoom(true)} disabled={busy}>🔁 もう一度遊ぶ（待機室へ）</button>}
        {room.status === "finished" && !isHost && <div className="turnBanner">ホストが「もう一度遊ぶ」を押すと、そのまま同じメンバーで待機室へ戻ります。</div>}
        {room.status === "playing" && isHost && <button className="miniButton dangerMini" onClick={() => resetRoom(false)} disabled={busy}>ゲームをリセットして待機室へ戻す</button>}
        <div className="hint">画面を閉じても、同じブラウザなら匿名セッションが保持されます。トップ画面の「前回のゲームに戻る」から復帰できます。</div>
      </>}
    </div>

    {culpritNotice && <div className="culpritNotice" role="status"><div className="culpritNoticeInner"><div className="culpritNoticeIcon">!</div><strong>……犯人カードがあなたの手元に来ました</strong><span>顔に出さないように。</span></div></div>}

    {incidentOpen && <div className="modalBackdrop" role="dialog" aria-modal="true"><div className="modalCard"><h2>🚨 第一発見者</h2><p>今回起こった事件を入力してください。</p><input className="input" value={incidentDraft} onChange={(e) => setIncidentDraft(e.target.value)} placeholder="例：冷蔵庫のプリンがなくなった！" autoFocus /><div className="inlineButtons"><button className="button" onClick={playFirstDiscoverer} disabled={busy}>{busy ? "発表中…" : "この事件で始める"}</button><button className="button secondary" onClick={() => setIncidentOpen(false)} disabled={busy}>キャンセル</button></div></div></div>}

    {targetRequest && <div className="modalBackdrop" role="dialog" aria-modal="true"><div className="modalCard"><h2>相手を選ぶ</h2><div className="targetButtons">{players.filter((p)=>p.id!==me?.id).map((p)=><button className="button secondary" key={p.id} onClick={()=>chooseTarget(p)} disabled={busy}>{p.display_name}（手札 {handCounts[p.id] ?? "?"}枚）</button>)}</div><button className="miniButton" onClick={()=>setTargetRequest(null)} disabled={busy}>キャンセル</button></div></div>}

    {dogTarget && <div className="modalBackdrop" role="dialog" aria-modal="true"><div className="modalCard"><h2>🐶 どのカードを調べる？</h2><p>{dogTarget.display_name}の裏向き手札から1枚選んでください。</p><div className="backChoices">{Array.from({length:handCounts[dogTarget.id] ?? 0},(_,i)=><button key={i} onClick={()=>chooseDogSlot(i)} disabled={busy}><DigitalCardBack compact/><span>{i+1}</span></button>)}</div><button className="miniButton" onClick={()=>setDogTarget(null)} disabled={busy}>キャンセル</button></div></div>}

    {privateReveal && <div className="modalBackdrop" role="dialog" aria-modal="true"><div className="modalCard"><h2>{privateReveal.title}</h2><p>{privateReveal.message}</p>{privateReveal.cards && <div className="revealCards">{privateReveal.cards.map((id)=>{ const def=CARD_BY_ID.get(id); return def ? <DigitalCard key={id} card={def} compact/> : null; })}</div>}<button className="button" onClick={()=>setPrivateReveal(null)}>確認した</button></div></div>}
  </div></main>;
}
