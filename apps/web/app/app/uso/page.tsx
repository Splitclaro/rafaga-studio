"use client";
// Uso y almacenamiento: espacio, saldo de unidades, cómputo del mes frente al presupuesto (aviso al 90 %), caducidades y qué pasa al borrar.
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

type Summary = { used_bytes: number; quota_bytes: number; units_balance: number; compute: { month_usd: number; budget_usd: number | null; pct: number | null; rate_card_set: boolean; blocked: boolean }; expiring: { key: string; kind: string; bytes: number; expires_at: string }[] };
const gb = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${(n / 1048576).toFixed(1)} MB`);
const KIND: Record<string, string> = { export: "Exportación", zip: "Descarga por lotes", sidecar: "Subtítulos o texto" };
const days = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

export default function Uso() {
  const [s, setS] = useState<Summary | null>(null), [err, setErr] = useState<string | null>(null);
  useEffect(() => { (async () => {
    const { data: m, error: e1 } = await supabase.from("workspace_members").select("workspace_id").limit(1);
    const ws = m?.[0]?.workspace_id;
    if (e1 || !ws) return setErr("No se encontró tu espacio de trabajo.");
    const { data, error } = await supabase.rpc("storage_summary", { p_ws: ws });
    if (error) return setErr("No se pudo cargar el uso. Vuelve a intentarlo en unos segundos.");
    setS(data as Summary);
  })(); }, []);

  if (err) return <main className="mx-auto max-w-3xl p-6"><p role="alert" className="card p-4 text-sm">{err}</p></main>;
  if (!s) return <main className="mx-auto max-w-3xl p-6"><p className="text-sm text-[var(--muted)]" aria-live="polite">Cargando uso…</p></main>;
  const pct = Math.min(100, (100 * s.used_bytes) / s.quota_bytes), cp = s.compute.pct, warn = s.compute.blocked || (cp != null && cp >= 90);
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Uso y almacenamiento</h1>

      <section className="card p-5" aria-labelledby="h-sto">
        <h2 id="h-sto" className="font-semibold">Almacenamiento</h2>
        <p className="tnum mt-1 text-sm">{gb(s.used_bytes)} de {gb(s.quota_bytes)} ({pct.toFixed(1)} %)</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--hairline)]" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Espacio usado"><div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} /></div>
        {pct >= 90 && <p className="mt-2 text-sm" role="status">Queda poco espacio. Envía a la papelera los proyectos que ya no uses para poder subir más vídeo.</p>}
      </section>

      <section className="card p-5" aria-labelledby="h-bal">
        <h2 id="h-bal" className="font-semibold">Saldo de unidades</h2>
        <p className="tnum mt-1 text-2xl font-bold">{Number(s.units_balance).toLocaleString("es-ES", { maximumFractionDigits: 2 })}</p>
        <p className="text-sm text-[var(--muted)]">Se reservan antes de analizar y se devuelve lo no usado. Descargar de nuevo o reintentar un fallo interno no consume.</p>
      </section>

      <section className="card p-5" aria-labelledby="h-cmp">
        <h2 id="h-cmp" className="font-semibold">Cómputo gratuito de este mes</h2>
        {!s.compute.rate_card_set ? <p className="mt-1 text-sm" role="status">El procesamiento aún no está configurado: falta la tarifa de cómputo. No se aceptan trabajos nuevos hasta entonces.</p> : <>
          <p className="tnum mt-1 text-sm">{s.compute.month_usd.toFixed(2)} USD de {s.compute.budget_usd ?? "—"} USD{cp != null ? ` (${cp} %)` : ""}</p>
          {warn && <p className="mt-2 text-sm" role="status">Se alcanzó el 90 % del presupuesto: los trabajos nuevos se rechazan hasta el mes siguiente. Lo que ya está en marcha termina.</p>}
        </>}
      </section>

      <section className="card p-5" aria-labelledby="h-exp">
        <h2 id="h-exp" className="font-semibold">Próximas caducidades</h2>
        {!s.expiring.length ? <p className="mt-1 text-sm text-[var(--muted)]">No hay archivos con fecha de caducidad.</p> :
          <ul className="mt-2 divide-y hairline text-sm">{s.expiring.map((e) => <li key={e.key} className="flex justify-between gap-3 py-2"><span>{KIND[e.kind] ?? e.kind} · {gb(e.bytes)}</span><span className="tnum text-[var(--muted)]">{days(e.expires_at) < 0 ? "Caducado" : `en ${days(e.expires_at)} d`}</span></li>)}</ul>}
        <p className="mt-3 text-xs text-[var(--muted)]">Una exportación caducada se puede renovar desde Exportados: se vuelve a preparar desde su versión, sin coste.</p>
      </section>

      <section className="card p-5" aria-labelledby="h-del">
        <h2 id="h-del" className="font-semibold">Qué pasa al borrar</h2>
        <dl className="mt-2 space-y-2 text-sm">
          <div><dt className="font-medium">Archivar</dt><dd className="text-[var(--muted)]">Oculta el proyecto de la biblioteca. Conserva todos los archivos y sigue ocupando espacio.</dd></div>
          <div><dt className="font-medium">Enviar a la papelera</dt><dd className="text-[var(--muted)]">Se puede restaurar durante 30 días con sus clips y versiones. Pasado ese plazo se borran los archivos y se libera el espacio.</dd></div>
          <div><dt className="font-medium">Eliminar definitivamente</dt><dd className="text-[var(--muted)]">No se puede deshacer. Se borran vídeo, análisis, clips y exportaciones del proyecto.</dd></div>
          <div><dt className="font-medium">Original</dt><dd className="text-[var(--muted)]">Se sustituye por una copia de edición equivalente cuando termina la preparación del vídeo.</dd></div>
        </dl>
      </section>
    </main>
  );
}
