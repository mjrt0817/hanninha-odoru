"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureAnonymousSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createRoom(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("名前を入力してください。");
    setBusy(true); setError("");
    try {
      await ensureAnonymousSession();
      const { data, error } = await supabase.rpc("create_room", { p_display_name: name.trim().slice(0, 20) });
      if (error) throw error;
      router.push(`/room/${data}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "部屋を作成できませんでした。");
    } finally { setBusy(false); }
  }

  async function joinRoom(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("名前を入力してください。");
    if (code.length !== 4) return setError("4桁のルーム番号を入力してください。");
    setBusy(true); setError("");
    try {
      await ensureAnonymousSession();
      const { error } = await supabase.rpc("join_room", { p_code: code, p_display_name: name.trim().slice(0, 20) });
      if (error) throw error;
      router.push(`/room/${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "参加できませんでした。");
    } finally { setBusy(false); }
  }

  return (
    <main className="page">
      <div className="shell">
        <header className="brand">
          <div className="brandMark">🕵️‍♀️</div>
          <h1>犯人は踊る</h1>
          <p className="subtitle">Family Browser Edition</p>
        </header>
        <div className="panel stack">
          <div>
            <label className="label">あなたの名前</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：あかり" maxLength={20} />
          </div>
          {error && <div className="message">{error}</div>}
          <form className="stack" onSubmit={createRoom}>
            <button className="button" disabled={busy}>{busy ? "準備中…" : "新しい部屋を作る"}</button>
          </form>
          <div className="divider" />
          <form className="stack" onSubmit={joinRoom}>
            <div>
              <label className="label">ルーム番号</label>
              <input className="input" inputMode="numeric" pattern="[0-9]*" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="4桁" />
            </div>
            <button className="button secondary" disabled={busy}>家族の部屋に参加</button>
          </form>
          <div className="divider" />
          <a className="button testModeButton" href="/test">🖥️ PCテストモード（最大4人）</a>
          <p className="hint">アプリのインストールは不要です。QRコードからブラウザで参加できます。端末内部では匿名セッションだけを作り、他の人の手札を直接読めないようにします。</p>
        </div>
      </div>
    </main>
  );
}
