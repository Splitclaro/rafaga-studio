import Link from "next/link";
export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-4xl font-semibold">Ráfaga Studio</h1>
      <p className="mt-3 text-[var(--muted)]">Del vídeo largo al momento que importa. Beta en desarrollo: aún sin cuentas ni procesamiento en la nube.</p>
      <div className="mt-8 flex flex-wrap gap-3"><Link className="rounded-lg bg-[var(--accent)] px-5 py-3 font-medium text-white" href="/login">Entrar a la beta</Link><Link className="rounded-lg border border-[var(--muted)] px-5 py-3" href="/editor/demo">Probar el editor de subtítulos</Link></div>
      <Link hidden className="mt-8 inline-block rounded-lg bg-[var(--accent)] px-5 py-3 font-medium text-white" href="/editor/demo">Probar el editor de subtítulos (datos de fixture)</Link>
    </main>
  );
}
