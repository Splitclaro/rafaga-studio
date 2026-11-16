"use client";
// Si una pantalla falla al dibujarse, se explica qué pasó y se puede reintentar sin perder la sesión (antes: pantalla genérica de Next).
import Link from "next/link";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main role="alert" className="mx-auto max-w-lg px-4 py-20 text-center">
      <h1 className="text-2xl">Algo ha fallado en esta pantalla</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">Tus proyectos y archivos no se han tocado. Puedes reintentar o volver al inicio.{error.digest ? ` (código ${error.digest})` : ""}</p>
      <div className="mt-6 flex justify-center gap-2"><button onClick={reset} className="btn btn-primary">Reintentar</button><Link href="/app" className="btn btn-ghost">Ir al inicio</Link></div>
    </main>
  );
}
