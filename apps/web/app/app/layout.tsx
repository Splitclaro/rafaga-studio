"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import Icon from "../../components/Icon";

const NAV = [
  { href: "/app", label: "Inicio", icon: "home", ready: true },
  { href: "/app/proyectos", label: "Proyectos", icon: "film", ready: true },
  { href: "/app/lyric-studio", label: "Lyric Studio", icon: "music", ready: false },
  { href: "/app/style-studio", label: "Style Studio", icon: "type", ready: false },
  { href: "/app/en-vivo", label: "En vivo", icon: "live", ready: false },
  { href: "/app/automatizaciones", label: "Automatizaciones", icon: "bolt", ready: false },
  { href: "/app/biblioteca", label: "Biblioteca", icon: "download", ready: false },
  { href: "/app/brand-kits", label: "Brand kits", icon: "brand", ready: true },
  { href: "/app/calendario", label: "Calendario", icon: "calendar", ready: false },
  { href: "/app/conexiones", label: "Conexiones", icon: "link", ready: false },
  { href: "/app/analitica", label: "Analítica", icon: "chart", ready: true },
  { href: "/app/ajustes", label: "Uso y ajustes", icon: "gear", ready: true },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [ws, setWs] = useState<string>("");
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("rafaga.sidebar") === "1"); } catch {}
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return router.replace("/login");
      setEmail(data.session.user.email ?? "");
      const { data: w } = await supabase.from("workspaces").select("name").limit(1).maybeSingle();
      setWs(w?.name ?? "Mi espacio");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { if (!s) router.replace("/login"); });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  const toggle = () => { const v = !collapsed; setCollapsed(v); try { localStorage.setItem("rafaga.sidebar", v ? "1" : "0"); } catch {} };
  if (email === null) return <div className="grid min-h-screen place-items-center text-[var(--muted)]">Cargando…</div>;
  const active = (h: string) => (h === "/app" ? path === "/app" : path.startsWith(h));

  return (
    <div className="min-h-screen md:flex">
      <aside className={`border-b border-[var(--border)] bg-[var(--surface)] md:sticky md:top-0 md:flex md:h-screen md:shrink-0 md:flex-col md:border-b-0 md:border-r ${collapsed ? "md:w-16" : "md:w-60"}`}>
        <div className="flex items-center justify-between gap-2 px-4 py-3 md:px-3 md:py-4">
          <Link href="/app" className="flex min-w-0 items-center gap-2 font-semibold"><span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#111] text-white">R</span><span className={collapsed ? "md:sr-only" : ""}>Ráfaga Studio</span></Link>
          <button onClick={toggle} aria-label={collapsed ? "Expandir menú" : "Plegar menú"} aria-expanded={!collapsed} className="hidden rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] md:block"><Icon n={collapsed ? "chevR" : "chevL"} className="h-4 w-4" /></button>
        </div>
        {!collapsed && (
          <div className="relative mx-3 mb-3 hidden md:block">
            <button onClick={() => setMenu(!menu)} aria-expanded={menu} className="flex w-full items-center justify-between rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-left text-sm">
              <span className="min-w-0"><span className="block truncate font-medium">{ws}</span><span className="block truncate text-xs text-[var(--muted)]">{email}</span></span><Icon n="chevD" className="h-4 w-4" />
            </button>
            {menu && (
              <div role="menu" className="absolute z-10 mt-1 w-full rounded-lg border border-[var(--border)] bg-white p-1 text-sm shadow-sm">
                <div className="px-3 py-2 text-xs text-[var(--muted)]">Workspace activo: {ws}. Por ahora hay uno por cuenta.</div>
                <Link role="menuitem" href="/app/ajustes" className="block rounded px-3 py-2 hover:bg-[var(--hover)]">Uso y ajustes</Link>
                <button role="menuitem" className="block w-full rounded px-3 py-2 text-left hover:bg-[var(--hover)]" onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>Cerrar sesión</button>
              </div>
            )}
          </div>
        )}
        <nav aria-label="Principal" className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:flex-1 md:space-y-0.5 md:overflow-y-auto md:pb-4">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} title={collapsed ? n.label : undefined} aria-current={active(n.href) ? "page" : undefined}
              className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm ${active(n.href) ? "bg-black/[0.06] font-medium text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"}`}>
              <Icon n={n.icon} className="h-[18px] w-[18px] shrink-0" /><span className={collapsed ? "md:sr-only" : ""}>{n.label}</span>
              {!n.ready && !collapsed && <span className="ml-auto hidden rounded border border-[var(--border)] px-1.5 text-[10px] uppercase tracking-wide text-[var(--muted)] md:inline">Pronto</span>}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
