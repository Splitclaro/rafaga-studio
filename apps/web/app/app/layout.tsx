"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import Icon from "../../components/Icon";
import CommandPalette, { type NavItem } from "../../components/CommandPalette";

const NAV: (NavItem & { glyph: string })[] = [
  { href: "/app", label: "Inicio", icon: "home", glyph: "⌂", ready: true, group: "" },
  { href: "/app/proyectos", label: "Proyectos", icon: "folder", glyph: "▤", ready: true, group: "" },
  { href: "/app/exports", label: "Exportados", icon: "download", glyph: "⇪", ready: true, group: "" },
  { href: "/app/calendario", label: "Calendario", icon: "calendar", glyph: "▦", ready: true, group: "" },
  { href: "/app/analitica", label: "Analítica", icon: "chart", glyph: "▥", ready: true, group: "" },
  { href: "/app/brand-kits", label: "Brand kit", icon: "brand", glyph: "◈", ready: true, group: "" },
  { href: "/app/entregas", label: "Compartidos conmigo", icon: "share", glyph: "⇩", ready: true, group: "" },
  { href: "/app/lyric-studio", label: "Lyric Studio", icon: "music", glyph: "♪", ready: true, group: "" },
  { href: "/app/conexiones", label: "Conexiones", icon: "link", glyph: "⚭", ready: true, group: "" },
];
const OTHER: NavItem[] = [
  { href: "/app/style-studio", label: "Style Studio", icon: "type", ready: true, group: "Marca" },
  { href: "/app/automatizaciones", label: "Automatizaciones", icon: "bolt", ready: true, group: "Publicar" },
  { href: "/app/demos", label: "Demos", icon: "play", ready: true, group: "Ayuda" },
  { href: "/app/director", label: "Director IA", icon: "wand", ready: true, group: "Ayuda" },
];
type Ws = { id: string; name: string; role: string; personal: boolean; active: boolean; members: number };
const ROLE: Record<string, string> = { owner: "Propietario", admin: "Admin", editor: "Editor", reviewer: "Revisor", viewer: "Lector", member: "Editor" };
type Note = { id: string; status: string; kind: string; updated_at: string; error_message: string | null };

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [ws, setWs] = useState("");
  const [spaces, setSpaces] = useState<Ws[]>([]);
  const [role, setRole] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const [running, setRunning] = useState(0);
  const [notes, setNotes] = useState<Note[]>([]);
  const [bell, setBell] = useState(false);
  const [seen, setSeen] = useState(0);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);

  const poll = useCallback(async () => {
    const { data } = await supabase.from("jobs").select("id,status,kind,updated_at,error_message").order("updated_at", { ascending: false }).limit(15);
    const list = (data ?? []) as Note[];
    setRunning(list.filter((j) => !["done", "failed", "cancelled"].includes(j.status)).length);
    setNotes(list.filter((j) => ["done", "failed"].includes(j.status)).slice(0, 8));
  }, []);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("rafaga.sidebar") === "1"); setSeen(Number(localStorage.getItem("rafaga.seen") ?? 0)); } catch {}
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      setEmail(data.session.user.email ?? "");
      const { data: list } = await supabase.rpc("my_workspaces");
      const l = (list ?? []) as Ws[]; setSpaces(l);
      const cur = l.find((x) => x.active) ?? l[0];
      setWs(cur?.name ?? "Mi espacio"); setRole(cur?.role ?? "");
      poll();
      const { data: u } = await supabase.rpc("ai_usage_summary");
      const us = u as { week_source_minutes?: number; limits?: { weekly_source_minutes?: number } } | null;
      if (us?.limits?.weekly_source_minutes) setUsage({ used: Number(us.week_source_minutes ?? 0), limit: Number(us.limits.weekly_source_minutes) });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { if (!s) router.replace("/login"); });
    const t = setInterval(poll, 8000);
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); } };
    window.addEventListener("keydown", k);
    return () => { sub.subscription.unsubscribe(); clearInterval(t); window.removeEventListener("keydown", k); };
  }, [router, poll]);

  async function switchTo(id: string) {
    const { error } = await supabase.rpc("set_active_workspace", { p_ws: id });
    if (!error) window.location.assign("/app");   // recarga completa: ninguna lista conserva datos del espacio anterior
  }
  async function newSpace() {
    const name = prompt("Nombre del nuevo espacio (cliente, marca, artista o producción):")?.trim();
    if (!name) return;
    const { error } = await supabase.rpc("create_workspace", { p_name: name });
    if (error) return alert(error.message);
    window.location.assign("/app");
  }
  const toggle = () => { const v = !collapsed; setCollapsed(v); try { localStorage.setItem("rafaga.sidebar", v ? "1" : "0"); } catch {} };
  const unread = notes.filter((n) => new Date(n.updated_at).getTime() > seen).length;
  const openBell = () => { setBell((b) => !b); const now = Date.now(); setSeen(now); try { localStorage.setItem("rafaga.seen", String(now)); } catch {} };
  if (email === null) return <div className="grid min-h-screen place-items-center"><span className="pulse" aria-label="Cargando" /></div>;
  const active = (h: string) => (h === "/app" ? path === "/app" : path.startsWith(h));
  const current = NAV.find((n) => active(n.href))?.label ?? (path.startsWith("/app/c/") ? "Editor de clip" : path.startsWith("/app/r/") ? "Revisión" : path.startsWith("/app/director") ? "Director IA" : path.startsWith("/app/p/") ? "Proyecto" : path.startsWith("/app/ajustes") ? "Uso y ajustes" : "");

  const initials = ((email.split("@")[0] ?? "").slice(0, 2) || "?").toUpperCase();
  const act = spaces.find((x) => x.active);
  const itm = "flex shrink-0 items-center gap-3 rounded-[10px] px-3 py-2 text-sm min-h-11";
  return (
    <div className="min-h-screen bg-[var(--bg)] md:flex">
      <nav aria-label="Principal" className="z-20 flex shrink-0 flex-col gap-3.5 border-b border-[#ECECF1] bg-[var(--bg)] px-3 py-3 md:sticky md:top-0 md:h-screen md:w-64 md:border-b-0 md:border-r md:py-[18px]">
        <Link href="/app" className="flex items-center gap-2 px-2 pb-1" aria-label="Ráfaga, inicio">
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-[9px] bg-[linear-gradient(135deg,#2A55F5,#5B8CFF)]"><Icon n="bolt" className="h-[15px] w-[15px] text-white" /></span>
          <span className="font-display text-2xl font-extrabold tracking-[-0.03em] text-[#22254A]">ráfaga</span>
        </Link>
        <div className="relative hidden md:block">
          <button onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="Cambiar de espacio de trabajo" className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left hover:bg-[var(--hover)]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[9px] bg-[#C1274F] text-lg font-bold text-white">{(ws[0] ?? "A").toUpperCase()}</span>
            <span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-sm font-semibold text-[var(--ink)]">{ws}</b><span className="text-xs text-[var(--muted)]">{ROLE[role] ?? "Gratis"} · {act?.members ?? 1} miembro{(act?.members ?? 1) === 1 ? "" : "s"}</span></span>
            <Icon n="chevR" className="h-3.5 w-3.5 text-[var(--muted)]" />
          </button>
          {menu && (
            <div role="menu" className="card-raised absolute z-10 mt-1 w-full p-1 text-sm">
              <div className="px-3 pb-1 pt-2 text-xs font-medium text-[var(--muted)]">Espacios</div>
              <ul className="max-h-56 overflow-auto">{spaces.map((x) => (
                <li key={x.id}><button role="menuitemradio" aria-checked={x.active} onClick={() => !x.active && switchTo(x.id)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-[var(--hover)] ${x.active ? "font-medium" : ""}`}>
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[var(--accent)] text-[10px] text-white">{x.name[0]?.toUpperCase()}</span>
                  <span className="min-w-0 flex-1 truncate">{x.name}</span><span className="text-[11px] text-[var(--muted)]">{ROLE[x.role]}</span>{x.active && <Icon n="check" className="h-3.5 w-3.5" />}</button></li>))}</ul>
              <button role="menuitem" onClick={newSpace} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-[var(--hover)]"><Icon n="plus" className="h-4 w-4" />Nuevo espacio</button>
              <div className="my-1 border-t hairline" />
              <Link role="menuitem" href="/app/equipo" onClick={() => setMenu(false)} className="block rounded-lg px-3 py-2 hover:bg-[var(--hover)]">Equipo y permisos</Link>
              <Link role="menuitem" href="/app/ajustes" onClick={() => setMenu(false)} className="block rounded-lg px-3 py-2 hover:bg-[var(--hover)]">Uso y ajustes</Link>
              <button role="menuitem" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--hover)]" onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>Cerrar sesión</button>
            </div>)}
        </div>
        <div className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5 md:overflow-visible">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={`${itm} ${active(n.href) ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-ink)]" : "text-[var(--ink)] hover:bg-[var(--hover)]"}`}>
              <span aria-hidden className={`w-[18px] text-center ${active(n.href) ? "" : "text-[#4A4F66]"}`}>{n.glyph}</span>{n.label}
            </Link>))}
        </div>
        <div className="hidden flex-col gap-0.5 md:mt-auto md:flex">
          {usage && <Link href="/app/ajustes" className="mb-2 rounded-xl border hairline bg-[var(--card)] px-3 py-2 hover:bg-[var(--hover)]" aria-label={`Consumo esta semana: ${usage.used} de ${usage.limit} minutos`}><span className="tnum flex justify-between text-xs"><span className="text-[var(--muted)]">Esta semana</span><b>{Math.round(usage.used)} / {usage.limit} min</b></span><span className="mt-1 block h-1 overflow-hidden rounded-full bg-[var(--border)]"><span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, (usage.used / usage.limit) * 100)}%` }} /></span></Link>}
          <Link href="/app/style-studio" className={`${itm} text-[var(--ink)] hover:bg-[var(--hover)]`}><span aria-hidden className="w-[18px] text-center">Aa</span>Style Studio</Link>
          <Link href="/app/automatizaciones" className={`${itm} text-[var(--ink)] hover:bg-[var(--hover)]`}><span aria-hidden className="w-[18px] text-center">⟳</span>Automatizaciones</Link>
          <Link href="/app/demos" className={`${itm} text-[var(--ink)] hover:bg-[var(--hover)]`}><span aria-hidden className="w-[18px] text-center">▣</span>Demos y tutoriales</Link>
          <Link href="/app/director" className="mt-2 flex items-center justify-between gap-2 rounded-[14px] border hairline bg-[var(--card)] px-3.5 py-3"><span className="flex items-center gap-2"><span aria-hidden className="text-[var(--accent)]">✦</span><span className="font-display text-base font-bold text-[#22254A]">director IA</span><span className="rounded-md bg-[#F0F1F7] px-1.5 text-[10px] font-semibold text-[var(--muted)]">Beta</span></span><span aria-hidden>→</span></Link>
        </div>
      </nav>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-[var(--bg)]/95 px-4 py-3 backdrop-blur md:px-8">
          <button onClick={() => setPalette(true)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border hairline bg-[var(--card)] px-3.5 text-sm text-[var(--muted)] md:w-[360px] md:flex-none" aria-label="Buscar (Cmd+K)">
            <Icon n="search" className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-left">Buscar</span><span className="kbd hidden md:inline">⌘ K</span>
          </button>
          <span className="ml-auto flex items-center gap-2.5">
            {running > 0 && <Link href="/app/proyectos" className="chip" aria-label={`${running} trabajos en curso`}><span className="pulse" aria-hidden /> <span className="tnum">{running}</span> en curso</Link>}
            {usage && <Link href="/app/ajustes" className="hidden min-h-11 items-center gap-2 rounded-xl border hairline bg-[var(--card)] px-3.5 text-sm font-medium md:inline-flex" aria-label="Consumo del plan"><span aria-hidden className="text-[var(--accent)]">✦</span><span className="tnum">{Math.max(0, Math.round(usage.limit - usage.used))} min restantes</span></Link>}
            <Link href="/app/equipo" className="btn btn-ghost !min-h-11 hidden md:inline-flex"><Icon n="plus" className="h-4 w-4" />Invitar</Link>
            <Link href="/app/conexiones" aria-label="Conexiones" className="card hidden h-11 w-11 place-items-center hover:bg-[var(--hover)] md:grid"><Icon n="link" className="h-[18px] w-[18px]" /></Link>
            <Link href="/app/demos" aria-label="Ayuda" className="card hidden h-11 w-11 place-items-center hover:bg-[var(--hover)] md:grid">?</Link>
            <div className="relative">
              <button onClick={openBell} aria-label={`Notificaciones${unread ? `, ${unread} nuevas` : ""}`} aria-expanded={bell} className="card relative grid h-11 w-11 place-items-center hover:bg-[var(--hover)]">
                <Icon n="bell" className="h-[18px] w-[18px]" />{unread > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-medium text-white">{unread}</span>}
              </button>
              {bell && (
                <div role="region" aria-label="Notificaciones" className="card-raised absolute right-0 z-20 mt-2 w-80 p-2">
                  <div className="px-2 py-1.5 text-sm font-medium">Actividad reciente</div>
                  {!notes.length && <p className="px-2 py-4 text-sm text-[var(--muted)]">Todavía no hay actividad terminada.</p>}
                  <ul>{notes.map((n) => (
                    <li key={n.id} className="flex items-start gap-2 rounded-lg px-2 py-2 text-sm">
                      <Icon n={n.status === "done" ? "check" : "x"} className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="min-w-0"><span className="block font-medium">{n.kind === "lyrics" ? "Vídeos con letra" : n.kind === "render" ? "Exportación" : "Detección de momentos"} {n.status === "done" ? "listo" : "fallido"}</span>
                        <span className="block truncate text-xs text-[var(--muted)]">{n.error_message ?? new Date(n.updated_at).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></span>
                    </li>))}</ul>
                </div>)}
            </div>
            <Link href="/app/ajustes" aria-label="Cuenta y uso" className="grid h-10 w-10 place-items-center rounded-full bg-[#22254A] text-sm font-semibold text-white">{initials}</Link>
          </span>
        </header>
        {children}
      </div>
      <CommandPalette nav={[...NAV, ...OTHER]} open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
