"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import Icon from "../../components/Icon";
import CommandPalette, { type NavItem } from "../../components/CommandPalette";

const NAV: NavItem[] = [
  { href: "/app", label: "Inicio", icon: "home", ready: true, group: "Crear" },
  { href: "/app/director", label: "Director IA", icon: "wand", ready: true, group: "Crear" },
  { href: "/app/lyric-studio", label: "Lyric Studio", icon: "music", ready: true, group: "Crear" },
  { href: "/app/style-studio", label: "Style Studio", icon: "type", ready: true, group: "Crear" },
  { href: "/app/biblioteca", label: "Biblioteca", icon: "folder", ready: true, group: "Crear" },
  { href: "/app/brand-kits", label: "Brand kit", icon: "brand", ready: true, group: "Crear" },
  { href: "/app/entregas", label: "Entregas", icon: "share", ready: true, group: "Revisar y entregar" },
  { href: "/app/calendario", label: "Calendario", icon: "calendar", ready: true, group: "Revisar y entregar" },
  { href: "/app/conexiones", label: "Conexiones", icon: "link", ready: true, group: "Revisar y entregar" },
  { href: "/app/automatizaciones", label: "Automatizaciones", icon: "bolt", ready: true, group: "Automatizar" },
  { href: "/app/en-vivo", label: "En vivo", icon: "live", ready: true, group: "Automatizar" },
  { href: "/app/analitica", label: "Analítica", icon: "chart", ready: true, group: "Automatizar" },
];
const GROUPS = ["Crear", "Revisar y entregar", "Automatizar"];
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

  return (
    <div className="min-h-screen md:flex">
      <aside className={`z-20 border-b hairline bg-[var(--surface)] md:sticky md:top-0 md:flex md:h-screen md:shrink-0 md:flex-col md:border-b-0 md:border-r ${collapsed ? "md:w-[68px]" : "md:w-64"}`}>
        <div className="flex items-center justify-between gap-2 px-4 py-3 md:px-3 md:py-4">
          <Link href="/app" className="flex min-w-0 items-center gap-2.5 font-semibold" aria-label="Ráfaga Studio, inicio">
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#1D4FFF] text-white"><Icon n="bolt" className="h-4 w-4" /></span>
            <span className={`text-[15px] tracking-tight ${collapsed ? "md:sr-only" : ""}`}>Ráfaga Studio</span>
          </Link>
          <button onClick={toggle} aria-label={collapsed ? "Expandir menú" : "Plegar menú"} aria-expanded={!collapsed} className="hidden rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] md:block"><Icon n={collapsed ? "chevR" : "chevL"} className="h-4 w-4" /></button>
        </div>

        {!collapsed && (
          <div className="relative mx-3 mb-2 hidden md:block">
            <button onClick={() => setMenu(!menu)} aria-expanded={menu} className="card flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--hover)]">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#1D4FFF] text-xs font-semibold text-white">{(email[0] ?? "?").toUpperCase()}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium leading-tight">{ws}</span><span className="block truncate text-xs text-[var(--muted)]">{ROLE[role] ?? ""}{role ? " · " : ""}{email}</span></span>
              <Icon n="chevD" className="h-4 w-4 text-[var(--muted)]" />
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
              </div>
            )}
          </div>
        )}

        <nav aria-label="Principal" className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:flex-1 md:overflow-y-auto md:pb-4">
          {GROUPS.map((g) => (
            <div key={g} className="md:mt-3 md:first:mt-0">
              {!collapsed && <div className="hidden px-3 pb-1 pt-2 text-xs font-medium text-[var(--muted)] md:block">{g}</div>}
              <div className="flex gap-1 md:block md:space-y-0.5">
                {NAV.filter((n) => n.group === g).map((n) => (
                  <Link key={n.href} href={n.href} title={collapsed ? n.label : undefined} aria-current={active(n.href) ? "page" : undefined}
                    className={`group relative flex shrink-0 items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors ${active(n.href) ? "bg-white font-semibold text-[var(--accent)] ring-1 ring-[var(--border)]" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"}`}>
                                        <Icon n={n.icon} className="h-[18px] w-[18px] shrink-0" /><span className={collapsed ? "md:sr-only" : ""}>{n.label}</span>
                    {!n.ready && !collapsed && <span className="ml-auto hidden rounded-md border hairline px-1.5 text-[10px] text-[var(--muted)] md:inline">Pronto</span>}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="hidden border-t hairline p-3 md:block">
          <Link href="/app/ajustes" aria-current={path.startsWith("/app/ajustes") ? "page" : undefined} className="flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"><Icon n="gear" className="h-[18px] w-[18px]" /><span className={collapsed ? "sr-only" : ""}>Uso y ajustes</span></Link>
          <a href="https://github.com/Splitclaro/rafaga-studio#readme" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"><Icon n="help" className="h-[18px] w-[18px]" /><span className={collapsed ? "sr-only" : ""}>Ayuda</span></a>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b hairline bg-white/90 px-4 py-2.5 backdrop-blur md:px-8">
          <span className="hidden text-sm text-[var(--muted)] md:block">{current}</span>
          <button onClick={() => setPalette(true)} className="card ml-auto flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--hover)] md:ml-6 md:w-72" aria-label="Buscar o ir a (Cmd+K)">
            <Icon n="search" className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-left">Buscar o ir a…</span><span className="kbd hidden md:inline">⌘K</span>
          </button>
          {running > 0 && <Link href="/app/biblioteca" className="chip" aria-label={`${running} trabajos en curso`}><span className="pulse" aria-hidden /> <span className="tnum">{running}</span> en curso</Link>}
          <div className="relative">
            <button onClick={openBell} aria-label={`Notificaciones${unread ? `, ${unread} nuevas` : ""}`} aria-expanded={bell} className="card relative grid h-9 w-9 place-items-center hover:bg-[var(--hover)]">
              <Icon n="bell" className="h-4 w-4" />{unread > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--ink)] px-1 text-[10px] font-medium text-white">{unread}</span>}
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
              </div>
            )}
          </div>
        </header>
        {children}
      </div>
      <CommandPalette nav={NAV} open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
