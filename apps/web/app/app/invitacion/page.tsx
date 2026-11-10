"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function Accept() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  async function accept() {
    setState("busy");
    const { error } = await supabase.rpc("accept_invite", { p_token: token });
    if (error) { setState("error"); setMsg(error.message); return; }
    window.location.assign("/app");
  }
  return (
    <main className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-4">
      <div className="card w-full p-6 text-center">
        <h1 className="text-2xl">Invitación a un espacio</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Al aceptar, el espacio aparecerá en tu menú de espacios y pasará a ser el activo. Tu espacio personal no cambia.</p>
        {!/^[0-9a-f]{64}$/.test(token) ? <p className="mt-4 text-sm">El enlace no es válido. Pide uno nuevo a quien te invitó.</p> : (
          <button onClick={accept} disabled={state === "busy"} className="btn btn-primary mt-5 w-full">{state === "busy" ? "Aceptando…" : "Aceptar invitación"}</button>)}
        {msg && <p role="alert" className="mt-3 text-sm">{msg}</p>}
      </div>
    </main>
  );
}
export default function Invitacion() { return <Suspense><Accept /></Suspense>; }
