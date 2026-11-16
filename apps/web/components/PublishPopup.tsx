"use client";
// «Publicar en redes» abre directamente la ventana de programación de TikTok con ESTE vídeo ya elegido (sin pasar por otras pantallas).
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { localZone } from "../lib/tz";
import TikTokScheduleDialog, { type TtAccount } from "./TikTokScheduleDialog";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export default function PublishPopup({ renderId, clipId, title, onClose, onDone }: { renderId: string; clipId?: string; title: string; onClose: () => void; onDone?: (msg: string) => void }) {
  const [accounts, setAccounts] = useState<TtAccount[] | null>(null);
  useEffect(() => {
    let stop = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const r = await fetch("/api/tiktok", { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } }).then((x) => (x.ok ? x.json() : { accounts: [] })).catch(() => ({ accounts: [] }));
      if (!stop) setAccounts(((r.accounts ?? []) as TtAccount[]).filter((a) => a.status === "connected"));
    })();
    return () => { stop = true; };
  }, []);
  if (accounts === null) return <div role="status" className="fixed inset-0 z-40 grid place-items-center bg-black/30 text-sm text-white">Cargando cuentas…</div>;
  return <TikTokScheduleDialog accounts={accounts} videos={[{ id: renderId, title, clipId }]} day={ymd(new Date())} tz={localZone()} onClose={onClose} onDone={(m) => { onDone?.(m); onClose(); }} />;
}
