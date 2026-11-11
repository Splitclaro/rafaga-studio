"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [["/app/brand-kits", "Recursos de marca"], ["/app/style-studio", "Estilos"], ["/app/ajustes", "Cuenta y uso"], ["/app/equipo", "Equipo"]] as const;
/** Pestañas del bloque «Marca» del diseño maestro: reúne Brand kit, Style Studio, Cuenta y uso y Equipo. */
export default function BrandTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Marca y cuenta" className="mx-auto max-w-[1240px] px-4 pt-6 md:px-10">
      <ul className="flex flex-wrap gap-1 border-b hairline">
        {TABS.map(([h, l]) => { const on = path.startsWith(h); return <li key={h}><Link href={h} aria-current={on ? "page" : undefined} className={`-mb-px block border-b-2 px-4 py-2.5 text-sm font-medium ${on ? "border-[var(--accent)] text-[var(--accent-ink)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"}`}>{l}</Link></li>; })}
      </ul>
    </nav>
  );
}
