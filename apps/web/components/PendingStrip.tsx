"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";
import Icon from "./Icon";

/** Pendientes reales: solo se muestra lo que existe (piezas por revisar, cambios solicitados, incidencias, procesos en curso). */
export default function PendingStrip() {
  const [c, setC] = useState<{ review: number; changes: number; failed: number; running: number; deliveries: number } | null>(null);
  useEffect(() => { (async () => {
    const head = { count: "exact" as const, head: true };
    const [r, ch, f, ru, d] = await Promise.all([
      supabase.from("clips").select("id", head).eq("discarded", false).eq("review_status", "pending").not("thumb_path", "is", null),
      supabase.from("clips").select("id", head).eq("discarded", false).eq("review_status", "changes_requested"),
      supabase.from("jobs").select("id", head).eq("status", "failed").gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
      supabase.from("jobs").select("id", head).not("status", "in", "(done,failed,cancelled)"),
      supabase.from("deliveries").select("id", head),
    ]);
    setC({ review: r.count ?? 0, changes: ch.count ?? 0, failed: f.count ?? 0, running: ru.count ?? 0, deliveries: d.count ?? 0 });
  })(); }, []);
  if (!c) return null;
  const items: { n: number; label: string; href: string; icon: string }[] = [
    { n: c.running, label: c.running === 1 ? "proceso en curso" : "procesos en curso", href: "/app/proyectos", icon: "bolt" },
    { n: c.review, label: c.review === 1 ? "clip por revisar" : "clips por revisar", href: "/app/proyectos", icon: "clock" },
    { n: c.changes, label: c.changes === 1 ? "pieza con cambios solicitados" : "piezas con cambios solicitados", href: "/app/proyectos", icon: "wand" },
    { n: c.failed, label: c.failed === 1 ? "incidencia reciente" : "incidencias recientes", href: "/app/analitica", icon: "x" },
  ].filter((x) => x.n > 0);
  if (!items.length) return null;
  return (
    <section aria-label="Pendientes" className="mt-10">
      <h2 className="mb-3 text-lg tracking-tight">Pendientes</h2>
      <ul className="flex flex-wrap gap-2">{items.map((x) => <li key={x.label}><Link href={x.href} className="chip !px-3.5 !py-2 text-sm"><Icon n={x.icon} className="h-4 w-4" /><strong className="tnum">{x.n}</strong> {x.label}</Link></li>)}</ul>
      {c.deliveries > 0 && <p className="mt-2 text-sm text-[var(--muted)]"><Link href="/app/entregas" className="underline">{c.deliveries} entrega{c.deliveries === 1 ? "" : "s"}</Link> preparada{c.deliveries === 1 ? "" : "s"}.</p>}
    </section>
  );
}
