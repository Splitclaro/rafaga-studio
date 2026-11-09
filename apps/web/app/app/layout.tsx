"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import Icon from "../../components/Icon";

const NAV = [
  { href: "/app", label: "Inicio", icon: "home", ready: true },
  { href: "/app/proyectos", label: "Proyectos", icon: "film", ready: true },
  { href: "/app/exports", label: "Exportaciones", icon: "download", ready: false },
  { href: "/app/automatizaciones", label: "Automatizaciones", icon: "bolt", ready: false },
  { href: "/app/en-vivo", label: "En vivo", icon: "live", ready: false },
  { href: "/app/brand-kits", label: "Brand kits", icon: "brand", ready: false },
  { href: "/app/conexiones", label: "Conexiones", icon: "link", ready: false },
  { href: "/app/ajustes", label: "Ajustes", icon: "gear", ready: true },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => (data.session ? setEmail(data.session.user.email ?? "") : router.replace("/login")));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { if (!s) router.replace("/login"); });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  if (email === null) return <div className="grid min-h-screen place-items-center text-[var(--muted)]">Cargando…</div>;
  const active = (h: string) => (h === "/app" ? path === "/app" : path.startsWith(h));

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-white/5 bg-[var(--surface)] md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-3 md:block md:px-5 md:py-5">
          <Link href="/app" className="flex items-center gap-2 font-semibold"><span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-[var(--accent)] text-[#101216]">R</span>Ráfaga Studio</Link>
          <span className="rounded bg-[var(--select)]/20 px-2 py-0.5 text-xs text-[var(--select)] md:mt-2 md:inline-block">Beta</span>
        </div>
        <nav aria-label="Principal" className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1 md:overflow-visible md:pb-0">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}
              className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm ${active(n.href) ? "bg-white/10 text-white" : "text-[var(--muted)] hover:bg-white/5 hover:text-white"}`}>
              <Icon n={n.icon} className="h-[18px] w-[18px] shrink-0" /><span>{n.label}</span>
              {!n.ready && <span className="ml-auto hidden rounded bg-white/10 px-1.5 text-[10px] uppercase tracking-wide text-[var(--muted)] md:inline">Pronto</span>}
            </Link>
          ))}
        </nav>
        <div className="hidden border-t border-white/5 p-4 text-xs text-[var(--muted)] md:absolute md:bottom-0 md:block md:w-60">
          <div className="truncate">{email}</div>
          <button className="mt-1 underline" onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>Salir</button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
