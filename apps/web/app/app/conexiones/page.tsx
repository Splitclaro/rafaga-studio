"use client";
import { useMemo, useState } from "react";
import Icon from "../../../components/Icon";
import { PLATFORMS, CAPS, METHOD, type Cap, type Platform } from "../../../lib/platforms";

const GROUPS: Platform["group"][] = ["Redes de vídeo", "Directos", "Protocolos y propios", "Mensajería", "Otros"];

export default function Conexiones() {
  const [q, setQ] = useState("");
  const [cap, setCap] = useState<Cap | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => PLATFORMS.filter((p) => (cap === "all" || p.caps.includes(cap)) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))), [q, cap]);
  const verified = PLATFORMS.filter((p) => p.verified).length;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:px-8">
      <header className="mb-6"><h1 className="text-3xl">Conexiones</h1><p className="mt-1 max-w-3xl text-[var(--muted)]">Aquí verás a qué redes y servicios puedes conectar tu cuenta y qué podrás hacer con cada uno. Hoy publicas descargando tus clips; la publicación directa llegará cuando cada conector esté implementado y aprobado por su plataforma.</p></header>

      <section aria-label="Resumen" className="mb-6 grid gap-3 sm:grid-cols-4">
        {[["Conectadas", "0"], ["Catalogadas", String(PLATFORMS.length)], ["Conectores implementados", "0"], ["Requisitos verificados", `${verified}/${PLATFORMS.length}`]].map(([k, v]) => (
          <div key={k} className="card p-4"><div className="mono text-2xl">{v}</div><div className="text-sm text-[var(--muted)]">{k}</div></div>))}
      </section>

      <div className="card mb-6 flex gap-3 p-4 text-sm"><Icon n="help" className="mt-0.5 h-4 w-4 shrink-0" /><p>Los requisitos son <strong>orientativos</strong>: se resumen de las plataformas y se marcan «por verificar» mientras no se comprueben contra su documentación oficial vigente. La existencia de un destino en el catálogo no implica que tenga API abierta ni que acepte vídeos cortos. «Probar conexión» nunca publicará ni emitirá nada.</p></div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <label className="card flex w-full items-center gap-2 px-3 py-2 sm:w-64"><Icon n="search" className="h-4 w-4 text-[var(--muted)]" /><span className="sr-only">Buscar destino</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar destino" className="w-full bg-transparent text-sm outline-none" /></label>
        <div role="group" aria-label="Filtrar por capacidad" className="flex flex-wrap gap-1.5"><button className="chip" aria-pressed={cap === "all"} onClick={() => setCap("all")}>Todas</button>{(Object.keys(CAPS) as Cap[]).map((c) => <button key={c} className="chip" aria-pressed={cap === c} onClick={() => setCap(c)}>{CAPS[c]}</button>)}</div>
      </div>

      {GROUPS.map((g) => {
        const items = list.filter((p) => p.group === g); if (!items.length) return null;
        return (
          <section key={g} className="mb-8" aria-labelledby={`g-${g}`}>
            <h2 id={`g-${g}`} className="mb-3 text-lg">{g} <span className="mono text-sm text-[var(--muted)]">{items.length}</span></h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((p) => (
                <li key={p.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2"><h3 className="text-base">{p.name}</h3><span className="chip !py-0.5 text-xs">No configurado</span></div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{METHOD[p.method]}{p.verified ? "" : " · por verificar"}</div>
                  <div className="mt-3 flex flex-wrap gap-1">{p.caps.length ? p.caps.map((c) => <span key={c} className="rounded-md border hairline px-1.5 py-0.5 text-[11px]">{CAPS[c]}</span>) : <span className="text-xs text-[var(--muted)]">Sin capacidades conocidas</span>}</div>
                  <button onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id} className="mt-3 flex items-center gap-1 text-sm underline underline-offset-4"><Icon n={open === p.id ? "chevD" : "chevR"} className="h-3.5 w-3.5" />Qué hace falta</button>
                  {open === p.id && (<div className="mt-2 space-y-2 text-sm"><p>{p.needs}</p>{p.docs && <a href={p.docs} target="_blank" rel="noreferrer" className="text-xs underline">Documentación oficial</a>}
                    <p className="rounded-lg bg-[var(--surface)] p-2 text-xs text-[var(--muted)]">Estado en Ráfaga: conector no implementado. {p.shortVideo ? "Mientras tanto, descarga el clip en el formato adecuado desde el editor (Social)." : ""}</p></div>)}
                  <button disabled className="btn btn-ghost mt-3 w-full !py-1.5 !text-xs" title="Aún no hay conector para este destino">Conectar (próximamente)</button>
                </li>))}
            </ul>
          </section>);
      })}
      {!list.length && <p className="card border-dashed p-8 text-center text-[var(--muted)]">Ningún destino coincide con el filtro.</p>}
    </main>
  );
}
