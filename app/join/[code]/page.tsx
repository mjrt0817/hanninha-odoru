"use client";

import { FormEvent, use, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureAnonymousSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("名前を入力してください。");
    setBusy(true); setError("");
    try {
      await ensureAnonymousSession();
      const { error } = await supabase.rpc("join_room", { p_code: code, p_display_name: name.trim().slice(0, 20) });
      if (error) throw error;
      localStorage.setItem("hannin:lastRoomCode", code);
      router.push(`/room/${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "参加できませんでした。");
    } finally { setBusy(false); }
  }

  return <main className="page"><div className="shell"><div className="brand"><div className="brandMark">🎴</div><h1>ゲームに参加</h1><p className="subtitle">ルーム {code}</p></div><form className="panel stack" onSubmit={submit}><div><label className="label">あなたの名前</label><input className="input" autoFocus value={name} onChange={(e)=>setName(e.target.value)} maxLength={20} placeholder="例：あかり" /></div>{error && <div className="message">{error}</div>}<button className="button" disabled={busy}>{busy ? "参加中…" : "参加する！"}</button><a className="button secondary" href={`/room/${code}`}>参加済みならゲームへ戻る</a></form></div></main>;
}
