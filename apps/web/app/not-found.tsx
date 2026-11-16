import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-20 text-center">
      <h1 className="text-2xl">Esta página no existe</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">Puede que el enlace esté mal escrito o que el proyecto se haya borrado.</p>
      <div className="mt-6"><Link href="/app" className="btn btn-primary">Ir al inicio</Link></div>
    </main>
  );
}
