"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { supabase } from "../lib/supabase";
import { pkce, randomState, type Capability, type OAuthProvider } from "@rafaga/providers/oauth";

type Conn = { provider: OAuthProvider; account_label: string | null; scopes: string[]; expires_at: string | null; status: string; last_error: string | null; last_checked_at: string | null };
const CARDS: { capability: Capability; provider: OAuthProvider; name: string; what: string; allowed: string[]; notAllowed: string; list: string }[] = [
  { capability: "import_youtube", provider: "google", name: "YouTube", what: "Importar tus vídeos subidos para cortarlos.", allowed: ["Ver tus vídeos y listas (solo lectura)"], notAllowed: "Publicar en YouTube requiere el permiso «youtube.upload» y la revisión de Google de la aplicación: no se solicita hasta que esté aprobada.", list: "youtube" },
  { capability: "import_drive", provider: "google", name: "Google Drive", what: "Importar vídeos guardados en tu Drive.", allowed: ["Leer tus archivos de vídeo (solo lectura)"], notAllowed: "No escribe ni borra nada en Drive.", list: "drive" },
  { capability: "import_dropbox", provider: "dropbox", name: "Dropbox", what: "Importar vídeos guardados en tu Dropbox.", allowed: ["Buscar y leer tus archivos de vídeo", "Ver el nombre de la cuenta"], notAllowed: "No escribe ni borra nada en Dropbox.", list: "dropbox" },
];
const STATUS: Record<string, string> = { connected: "Conectada", expired: "Caducada: vuelve a conectar", revoked: "Revocada", error: "Con error" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

async function authed(url: string, body: unknown) {
  const { data } = await supabase.auth.getSession();
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` }, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) as Record<string, unknown> };
}

/** Conexiones reales (OAuth 2.0 + PKCE). Los tokens se guardan en el servidor; aquí solo se ve el estado y se lanzan acciones permitidas. */
export default function OAuthConnections() {
  const [conns, setConns] = useState<Conn[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [items, setItems] = useState<Record<string, { id?: string; title?: string; name?: string; path?: string; size?: number; publishedAt?: string }[]>>({});
  const load = useCallback(async () => { const { data, error } = await supabase.rpc("oauth_status"); setConns(error ? [] : ((data as Conn[]) ?? [])); }, []);
  useEffect(() => { load(); }, [load]);
  const say = (k: string, t: string) => setMsg((m) => ({ ...m, [k]: t }));

  async function connect(c: (typeof CARDS)[number]) {
    setBusy(c.capability); say(c.capability, "");
    const { verifier, challenge } = await pkce(); const state = randomState();
    try { sessionStorage.setItem("rafaga.oauth", JSON.stringify({ state, verifier, capability: c.capability })); } catch { setBusy(null); return say(c.capability, "Tu navegador bloquea el almacenamiento de sesión: no se puede completar la conexión de forma segura."); }
    const r = await authed("/api/oauth/start", { capability: c.capability, state, challenge });
    setBusy(null);
    if (!r.ok) return say(c.capability, (r.j.message as string) ?? "No se pudo iniciar la conexión.");
    window.location.assign(r.j.url as string);
  }
  async function act(c: (typeof CARDS)[number], action: "test" | "list" | "disconnect") {
    if (action === "disconnect" && !confirm(`¿Desconectar ${c.name}? Se revoca el acceso en el proveedor y se borra de Ráfaga.`)) return;
    setBusy(c.capability + action); say(c.capability, "");
    const r = await authed("/api/oauth/action", { provider: c.provider, action, what: c.list });
    setBusy(null);
    if (!r.ok) { say(c.capability, (r.j.message as string) ?? "La acción falló."); return load(); }
    if (action === "test") say(c.capability, `Comprobada: ${r.j.account_label as string} · ${when(r.j.checked_at as string)}`);
    if (action === "list") { setItems((x) => ({ ...x, [c.capability]: r.j.items as never })); say(c.capability, `${(r.j.items as unknown[]).length} vídeos encontrados`); }
    if (action === "disconnect") { say(c.capability, "Desconectada."); setItems((x) => ({ ...x, [c.capability]: [] })); }
    load();
  }

  return (
    <section aria-label="Cuentas conectadas" className="mb-8">
      <h2 className="mb-1 text-lg">Cuentas conectadas</h2>
      <p className="mb-3 text-sm text-[var(--muted)]">Conexiones oficiales con permisos mínimos. Solo un responsable del espacio puede conectar o desconectar. Las claves de acceso nunca llegan al navegador.</p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => {
          const conn = conns?.find((x) => x.provider === c.provider && (c.provider !== "google" || x.scopes.some((s) => s.includes(c.capability === "import_youtube" ? "youtube" : "drive"))));
          const ok = conn && conn.status === "connected";
          return (
            <li key={c.capability} className="card p-4">
              <div className="flex items-start justify-between gap-2"><h3 className="text-base">{c.name}</h3>
                <span className={`chip !py-0.5 text-xs ${ok ? "border-[var(--accent)] text-[var(--accent)]" : ""}`}>{conns === null ? "…" : conn ? STATUS[conn.status] ?? conn.status : "Sin conectar"}</span></div>
              <p className="mt-1 text-sm text-[var(--muted)]">{c.what}</p>
              {conn && <p className="mt-2 text-xs">{conn.account_label ?? "Cuenta"}{conn.last_checked_at ? ` · comprobada ${when(conn.last_checked_at)}` : ""}{conn.last_error ? ` · ${conn.last_error}` : ""}</p>}
              <details className="mt-2 text-xs text-[var(--muted)]"><summary className="cursor-pointer">Permisos</summary><ul className="mt-1 list-disc pl-4">{c.allowed.map((a) => <li key={a}>{a}</li>)}</ul><p className="mt-1">{c.notAllowed}</p></details>
              <div className="mt-3 flex flex-wrap gap-2">
                {!ok && <button onClick={() => connect(c)} disabled={busy === c.capability} className="btn btn-primary !py-1.5 !text-xs">{conn ? "Volver a conectar" : "Conectar"}</button>}
                {ok && <>
                  <button onClick={() => act(c, "test")} disabled={!!busy} className="btn btn-ghost !py-1.5 !text-xs">Probar</button>
                  <button onClick={() => act(c, "list")} disabled={!!busy} className="btn btn-ghost !py-1.5 !text-xs">Ver mis vídeos</button>
                  <button onClick={() => act(c, "disconnect")} disabled={!!busy} className="btn btn-ghost !py-1.5 !text-xs">Desconectar</button>
                </>}
              </div>
              {msg[c.capability] && <p role="status" className="mt-2 text-xs text-[var(--muted)]">{msg[c.capability]}</p>}
              {!!items[c.capability]?.length && <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs">{items[c.capability].map((it, i) => <li key={i} className="truncate"><Icon n="film" className="mr-1 inline h-3 w-3" />{it.title ?? it.name}{it.size ? ` · ${(it.size / 1048576).toFixed(1)} MB` : ""}</li>)}</ul>}
            </li>);
        })}
      </ul>
    </section>
  );
}
