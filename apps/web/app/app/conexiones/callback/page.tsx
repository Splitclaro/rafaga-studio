"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";

/** Retorno de OAuth: valida el estado, canjea el código en el servidor (el navegador nunca ve tokens) y vuelve a Conexiones. */
export default function OAuthCallback() {
  const [msg, setMsg] = useState("Confirmando la conexión…");
  const [done, setDone] = useState<"ok" | "err" | null>(null);
  useEffect(() => {
    (async () => {
      const q = new URLSearchParams(window.location.search);
      const code = q.get("code"), state = q.get("state"), err = q.get("error");
      let saved: { state: string; verifier: string; capability: string } | null = null;
      try { saved = JSON.parse(sessionStorage.getItem("rafaga.oauth") ?? "null"); sessionStorage.removeItem("rafaga.oauth"); } catch { saved = null; }
      if (err) { setMsg(err === "access_denied" ? "Has cancelado la conexión. No se ha guardado nada." : `El proveedor devolvió un error: ${err}`); return setDone("err"); }
      if (!code || !state || !saved || saved.state !== state) { setMsg("La respuesta no coincide con la petición iniciada aquí. Vuelve a intentarlo desde Conexiones."); return setDone("err"); }
      const { data: s } = await supabase.auth.getSession();
      const r = await fetch("/api/oauth/exchange", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` }, body: JSON.stringify({ capability: saved.capability, code, verifier: saved.verifier }) });
      const j = await r.json();
      if (!r.ok) { setMsg(j.message ?? "No se pudo completar la conexión."); return setDone("err"); }
      setMsg(`Conectado: ${j.account_label}.`); setDone("ok");
      setTimeout(() => window.location.replace("/app/conexiones"), 900);
    })();
  }, []);
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <p role="status" aria-live="polite" className="text-base">{msg}</p>
      {done === "err" && <Link href="/app/conexiones" className="btn btn-ghost mt-6">Volver a Conexiones</Link>}
    </main>
  );
}
