"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "./Icon";
import { supabase } from "../lib/supabase";

export type NavItem = { href: string; label: string; icon: string; ready: boolean; group: string };
type Hit = { key: string; label: string; hint: string; icon: string; href: string };

const ACTIONS: Hit[] = [
  { key: "a1", label: "Nuevo proyecto de clips", hint: "Subir un vídeo largo", icon: "plus", href: "/app" },
  { key: "a2", label: "Nuevo vídeo con letra", hint: "Lyric Studio", icon: "music", href: "/app/lyric-studio" },
  { key: "a3", label: "Subir una fuente", hint: "Brand kit", icon: "type", href: "/app/brand-kits" },
];

export default function CommandPalette({ nav, open, onClose }: { nav: NavItem[]; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Hit[]>([]);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQ(""); setFound([]); setI(0); setTimeout(() => input.current?.focus(), 20); } }, [open]);
  useEffect(() => {
    if (!open || q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      const like = `%${q.trim().replace(/[%_]/g, "")}%`;
      const [p, s] = await Promise.all([
        supabase.from("projects").select("id,name").ilike("name", like).is("deleted_at", null).limit(5),
        supabase.from("songs").select("id,title").ilike("title", like).limit(5),
      ]);
      setFound([
        ...(p.data ?? []).map((x) => ({ key: `p${x.id}`, label: x.name, hint: "Proyecto", icon: "film", href: `/app/p/${x.id}` })),
        ...(s.data ?? []).map((x) => ({ key: `s${x.id}`, label: x.title, hint: "Canción", icon: "music", href: "/app/lyric-studio" })),
      ]);
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const hits = useMemo<Hit[]>(() => {
    const t = q.trim().toLowerCase();
    const pages = nav.map((n) => ({ key: n.href, label: n.label, hint: n.ready ? "Ir a" : "Ir a (en desarrollo)", icon: n.icon, href: n.href }));
    const base = [...ACTIONS, ...pages].filter((h) => !t || h.label.toLowerCase().includes(t));
    return [...found, ...base].slice(0, 12);
  }, [q, nav, found]);

  useEffect(() => { setI(0); }, [q]);
  if (!open) return null;
  const go = (h: Hit) => { onClose(); router.push(h.href); };
  return (
    <div role="dialog" aria-modal="true" aria-label="Buscar o ir a" className="fixed inset-0 z-50 grid place-items-start bg-black/30 px-4 pt-[14vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card-raised mx-auto w-full max-w-xl overflow-hidden">
        <div className="flex items-center gap-3 border-b hairline px-4 py-3">
          <Icon n="search" className="h-4 w-4 text-[var(--muted)]" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca un proyecto, una canción o una página…" aria-label="Buscar" className="w-full bg-transparent text-[15px] outline-none"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(hits.length - 1, x + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              else if (e.key === "Enter" && hits[i]) go(hits[i]);
              else if (e.key === "Escape") onClose();
            }} />
          <span className="kbd">esc</span>
        </div>
        <ul role="listbox" className="max-h-[50vh] overflow-auto p-2">
          {hits.map((h, k) => (
            <li key={h.key} role="option" aria-selected={k === i}>
              <button onMouseEnter={() => setI(k)} onClick={() => go(h)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${k === i ? "bg-[var(--hover)]" : ""}`}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border hairline bg-white"><Icon n={h.icon} className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{h.label}</span>
                <span className="shrink-0 text-xs text-[var(--muted)]">{h.hint}</span>
              </button>
            </li>
          ))}
          {!hits.length && <li className="px-3 py-6 text-center text-sm text-[var(--muted)]">Sin resultados para «{q}».</li>}
        </ul>
      </div>
    </div>
  );
}
