import { supabase } from "./supabase";

export async function ensureAnonymousSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;

  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!signedIn.session) throw new Error("匿名セッションを開始できませんでした。");
  return signedIn.session;
}
